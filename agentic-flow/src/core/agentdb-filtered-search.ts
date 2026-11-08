/**
 * Metadata-filtered k-NN over an agentdb vector backend (agentdb >= 3.7.0).
 *
 * agentdb's backends filter differently:
 * - rvf (@ruvector/rvf >= 0.4.7) filters natively, by field name, with
 *   eq/ne/lt/le/gt/ge/in/range. The predicate DSL is `$ge`/`$le`, not
 *   `$gte`/`$lte`: those build no filter at all and are silently dropped.
 * - ruvector filters by strict equality only, after the ANN search.
 * - others may ignore `filter`.
 *
 * So equality is always pushed down; ranges are pushed down on rvf and
 * applied here otherwise. Every hit is re-checked locally, which keeps a
 * backend that ignores `filter` correct. If the filtered search throws, or a
 * post-filtered answer comes back short, this falls back to an exhaustive
 * unfiltered search filtered here.
 */

export type FilterScalar = string | number | boolean;

export interface NumericRange {
  min?: number;
  max?: number;
}

export interface MetadataQuery {
  /** Fields that must equal these values */
  equals?: Record<string, FilterScalar>;
  /** Inclusive numeric bounds */
  ranges?: Record<string, NumericRange>;
}

export interface FilteredSearchOptions {
  /** rvf: exact brute-force scan instead of HNSW (other backends ignore it) */
  forceExact?: boolean;
  efSearch?: number;
  threshold?: number;
}

export interface FilteredHit {
  id: string;
  distance: number;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface FilteredSearchResult {
  hits: FilteredHit[];
  /** 'native': the backend's filtered search answered; 'fallback': filtered here */
  path: 'native' | 'fallback';
}

/** Largest k ever requested from the backend by the fallback */
export const MAX_FALLBACK_K = 10_000;

const POST_FILTER_OVERFETCH = 4;

function rangeEntries(q: MetadataQuery): Array<[string, NumericRange]> {
  return Object.entries(q.ranges ?? {}).filter(
    ([, r]) => r && (r.min !== undefined || r.max !== undefined)
  );
}

/** Predicate DSL for agentdb's FilterBuilder / RuVector equality filter */
export function toBackendFilter(q: MetadataQuery, includeRanges: boolean): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...(q.equals ?? {}) };
  if (includeRanges) {
    for (const [field, { min, max }] of rangeEntries(q)) {
      if (min !== undefined && max !== undefined) filter[field] = { $range: [min, max] };
      else if (min !== undefined) filter[field] = { $ge: min };
      else filter[field] = { $le: max };
    }
  }
  return filter;
}

export function matchesMetadataQuery(metadata: Record<string, any> | undefined, q: MetadataQuery): boolean {
  if (!metadata) return false;
  for (const [field, value] of Object.entries(q.equals ?? {})) {
    if (metadata[field] !== value) return false;
  }
  for (const [field, { min, max }] of rangeEntries(q)) {
    const v = metadata[field];
    if (typeof v !== 'number') return false;
    if (min !== undefined && v < min) return false;
    if (max !== undefined && v > max) return false;
  }
  return true;
}

function rawSearch(backend: any, query: Float32Array, k: number, options: Record<string, unknown>): Promise<FilteredHit[]> {
  if (typeof backend.searchAsync === 'function') return backend.searchAsync(query, k, options);
  return Promise.resolve(backend.search(query, k, options));
}

async function backendCount(backend: any): Promise<number | undefined> {
  try {
    const stats = typeof backend.getStatsAsync === 'function'
      ? await backend.getStatsAsync()
      : backend.getStats?.();
    return typeof stats?.count === 'number' ? stats.count : undefined;
  } catch {
    return undefined;
  }
}

/**
 * k nearest neighbours of `query` whose metadata matches `q`, best first.
 */
export async function filteredVectorSearch(
  backend: any,
  query: Float32Array,
  k: number,
  q: MetadataQuery,
  options: FilteredSearchOptions = {}
): Promise<FilteredSearchResult> {
  if (k <= 0) return { hits: [], path: 'native' };
  const nativeRanges = backend?.name === 'rvf';
  const postFiltered = !nativeRanges && rangeEntries(q).length > 0;
  const filter = toBackendFilter(q, nativeRanges);
  const base: Record<string, unknown> = {};
  if (options.forceExact) base.forceExact = true;
  if (options.efSearch !== undefined) base.efSearch = options.efSearch;
  if (options.threshold !== undefined) base.threshold = options.threshold;

  const fetchK = postFiltered ? k * POST_FILTER_OVERFETCH : k;
  try {
    const raw = await rawSearch(backend, query, fetchK, {
      ...base,
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    });
    const hits = raw.filter((h) => matchesMetadataQuery(h.metadata, q));
    // A short answer is final only from rvf's native filter with nothing
    // dropped here; ruvector filters a bounded over-fetch and can miss matches.
    if (hits.length >= k || (nativeRanges && hits.length === raw.length)) {
      return { hits: hits.slice(0, k), path: 'native' };
    }
  } catch {
    // Filter not supported by this backend: filter here instead. Errors that
    // are not about the filter (closed store, bad dimension) recur below.
  }

  const count = await backendCount(backend);
  const allK = Math.min(Math.max(count ?? 0, fetchK * POST_FILTER_OVERFETCH), MAX_FALLBACK_K);
  const raw = await rawSearch(backend, query, allK, base);
  const hits = raw.filter((h) => matchesMetadataQuery(h.metadata, q));
  return { hits: hits.slice(0, k), path: 'fallback' };
}
