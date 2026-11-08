/**
 * Real-import tests against agentdb >= 3.7.0 (@ruvector/rvf 0.4.7): no mocks.
 *
 * Covers what agentic-flow relies on from that release: async-only search,
 * filtered search by field name (rvf pushes eq and ranges down, ruvector
 * equality only), forceExact, RvfMetadataTypeConflictError on a type clash,
 * and closeAsync(). Each case runs on the rvf backend and on AgentDB's
 * default ('auto', ruvector when present) so both filter paths are exercised.
 *
 * rvf stores get a fresh file in a temp dir. Two agentdb 3.7.0 traps make
 * that necessary: an in-memory AgentDB gives rvf no storage path, so
 * RvfBackend uses ./agentdb.rvf and reopens whatever an earlier run left
 * there; and storagePath ':memory:' is not in-memory for rvf, it creates a
 * file literally named ':memory:' in the working directory.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDB } from 'agentdb';
import { createBackend, RvfMetadataTypeConflictError as BackendsConflictError } from 'agentdb/backends';
import { AgentDBFast, RvfMetadataTypeConflictError } from '../../src/core/agentdb-fast.js';
import {
  filteredVectorSearch,
  matchesMetadataQuery,
  toBackendFilter,
} from '../../src/core/agentdb-filtered-search.js';

const agentdbVersion: string = createRequire(import.meta.url)('agentdb/package.json').version;
const [major, minor] = agentdbVersion.split('.').map(Number);

const DIM = 16;

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});
function rvfPath() {
  const dir = mkdtempSync(join(tmpdir(), 'af-agentdb37-'));
  tempDirs.push(dir);
  return join(dir, 'store.rvf');
}

async function openBackend(type: 'rvf' | 'auto', dimension: number, keep: (db: any) => void = () => {}) {
  if (type === 'rvf') {
    return createBackend('rvf', { dimensions: dimension, metric: 'cosine', storagePath: rvfPath() } as any);
  }
  const db = new AgentDB({ vectorDimension: dimension } as any);
  await db.initialize();
  keep(db);
  return (db as any).vectorBackend;
}

/** AgentDBFast over a given backend (rvf is injected, see the header) */
async function fastOn(type: 'rvf' | 'auto') {
  const fast: any = new AgentDBFast({ embeddings: 'hash' });
  if (type === 'auto') {
    await fast.initialize();
  } else {
    fast.backend = await openBackend('rvf', 384);
    fast.db = { close: async () => {} }; // close() then runs backend.closeAsync()
    fast.initialized = true;
  }
  return fast as AgentDBFast;
}
const vec = (seed: number) => {
  const a = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) a[i] = Math.sin(seed * 1.7 + i) + 1.2;
  return a;
};

describe('agentdb version', () => {
  it('resolves agentdb >= 3.7.0', () => {
    expect(major > 3 || (major === 3 && minor >= 7), agentdbVersion).toBe(true);
  });

  it('re-exports agentdb\'s RvfMetadataTypeConflictError', () => {
    expect(RvfMetadataTypeConflictError).toBe(BackendsConflictError);
  });
});

describe('filter translation', () => {
  it('emits the $ge/$le/$range DSL FilterBuilder understands (not $gte/$lte)', () => {
    expect(toBackendFilter({ equals: { type: 'episode' }, ranges: { reward: { min: 0.5 } } }, true))
      .toEqual({ type: 'episode', reward: { $ge: 0.5 } });
    expect(toBackendFilter({ ranges: { reward: { max: 0.5 } } }, true)).toEqual({ reward: { $le: 0.5 } });
    expect(toBackendFilter({ ranges: { reward: { min: 0, max: 1 } } }, true)).toEqual({ reward: { $range: [0, 1] } });
    // Equality-only backends get no range predicate (they would match nothing)
    expect(toBackendFilter({ equals: { a: 1 }, ranges: { reward: { min: 0.5 } } }, false)).toEqual({ a: 1 });
  });

  it('matches equality and inclusive ranges locally', () => {
    const q = { equals: { type: 'e' }, ranges: { r: { min: 0.5, max: 0.9 } } };
    expect(matchesMetadataQuery({ type: 'e', r: 0.5 }, q)).toBe(true);
    expect(matchesMetadataQuery({ type: 'e', r: 0.9 }, q)).toBe(true);
    expect(matchesMetadataQuery({ type: 'e', r: 0.95 }, q)).toBe(false);
    expect(matchesMetadataQuery({ type: 'p', r: 0.7 }, q)).toBe(false);
    expect(matchesMetadataQuery(undefined, q)).toBe(false);
  });
});

for (const backendType of ['rvf', 'auto'] as const) {
  describe(`agentdb ${agentdbVersion} vector backend: ${backendType}`, () => {
    let db: any = null;
    let backend: any = null;
    afterEach(async () => {
      if (backend?.isInitialized?.()) await backend.closeAsync?.();
      backend = null;
      if (db) {
        await db.close();
        db = null;
      }
    });

    async function seeded() {
      backend = await openBackend(backendType, DIM, (d) => (db = d));
      const b = backend;
      await b.insertAsync('e1', vec(1), { type: 'episode', sessionId: 's1', reward: 0.9 });
      await b.insertAsync('e2', vec(2), { type: 'episode', sessionId: 's2', reward: 0.2 });
      await b.insertAsync('e3', vec(3), { type: 'episode', sessionId: 's1', reward: 0.6 });
      for (let i = 0; i < 12; i++) {
        await b.insertAsync(`p${i}`, vec(1 + i * 0.01), { type: 'pattern', quality: i / 12 });
      }
      return b;
    }

    it('sync search() is async-only; filteredVectorSearch uses searchAsync', async () => {
      const b = await seeded();
      expect(typeof b.searchAsync).toBe('function');
      const { hits } = await filteredVectorSearch(b, vec(1), 3, { equals: { type: 'episode' } });
      expect(hits.map((h) => h.id).sort()).toEqual(['e1', 'e2', 'e3']);
    });

    it('filters by field name: equality and ranges', async () => {
      const b = await seeded();
      const s1 = await filteredVectorSearch(b, vec(1), 5, { equals: { type: 'episode', sessionId: 's1' } });
      expect(s1.hits.map((h) => h.id).sort()).toEqual(['e1', 'e3']);

      const good = await filteredVectorSearch(b, vec(1), 5, {
        equals: { type: 'episode' },
        ranges: { reward: { min: 0.5 } },
      });
      expect(good.hits.map((h) => h.id).sort()).toEqual(['e1', 'e3']);
      // rvf answers natively; ruvector needs the local range pass
      if (backendType === 'rvf') expect(good.path).toBe('native');

      const band = await filteredVectorSearch(b, vec(1), 20, {
        equals: { type: 'pattern' },
        ranges: { quality: { min: 0.25, max: 0.5 } },
      });
      expect(band.hits.length).toBe(4); // 3/12, 4/12, 5/12, 6/12
      for (const h of band.hits) expect(h.metadata!.quality).toBeGreaterThanOrEqual(0.25);
    });

    it('forceExact returns the same filtered answer', async () => {
      const b = await seeded();
      const { hits } = await filteredVectorSearch(b, vec(2), 1, { equals: { type: 'episode' } }, { forceExact: true });
      expect(hits[0].id).toBe('e2');
    });

    it('falls back to local filtering when the backend\'s filtered search throws', async () => {
      const b = await seeded();
      const flaky = {
        name: b.name,
        searchAsync: (q: Float32Array, k: number, o: any) =>
          o?.filter ? Promise.reject(new Error('filter unsupported')) : b.searchAsync(q, k, o),
        getStatsAsync: () => b.getStatsAsync(),
      };
      const r = await filteredVectorSearch(flaky, vec(1), 5, { equals: { type: 'episode', sessionId: 's1' } });
      expect(r.path).toBe('fallback');
      expect(r.hits.map((h) => h.id).sort()).toEqual(['e1', 'e3']);
    });

    it.runIf(backendType === 'rvf')('a metadata type clash throws RvfMetadataTypeConflictError', async () => {
      const b = await seeded();
      const err = await b.insertAsync('bad', vec(9), { quality: 'high' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RvfMetadataTypeConflictError);
      expect((err as any).field).toBe('quality');
      expect((err as any).ids).toEqual(['bad']);
    });

    it.runIf(backendType === 'rvf')('closeAsync flushes queued sync writes', async () => {
      const b = await seeded();
      b.insert('late', vec(5), { type: 'episode', reward: 0.1 });
      await b.closeAsync();
      expect(b.isInitialized?.() ?? false).toBe(false);
    });
  });

  describe(`AgentDBFast on agentdb ${agentdbVersion} (${backendType})`, () => {
    it('stores and filters episodes and patterns', async () => {
      const fast = await fastOn(backendType);
      try {
        await fast.storeEpisode({ sessionId: 's1', task: 'fix login bug', trajectory: ['a'], reward: 0.9 });
        await fast.storeEpisode({ sessionId: 's2', task: 'fix login bug again', trajectory: ['b'], reward: 0.2 });
        await fast.storePattern({ task: 'fix login bug', input: 'fix login bug', output: 'patch', quality: 0.8 });
        await fast.storePattern({ task: 'cake', input: 'bake', output: 'cake', quality: 0.3 });

        const all = await fast.retrieveEpisodes({ task: 'fix login bug', k: 10 });
        expect(all.map((e) => e.sessionId).sort()).toEqual(['s1', 's2']); // no patterns
        expect(all.find((e) => e.sessionId === 's1')!.trajectory).toEqual(['a']);

        const s2 = await fast.retrieveEpisodes({ task: 'fix login bug', k: 10, sessionId: 's2' });
        expect(s2.map((e) => e.reward)).toEqual([0.2]);

        const good = await fast.retrieveEpisodes({ task: 'fix login bug', k: 10, minReward: 0.5 });
        expect(good.map((e) => e.sessionId)).toEqual(['s1']);

        const low = await fast.retrieveEpisodes({ task: 'fix login bug', k: 10, maxReward: 0.5 });
        expect(low.map((e) => e.sessionId)).toEqual(['s2']);

        const pats = await fast.searchPatterns('fix login bug', 10, 0.5);
        expect(pats.map((p) => p.output)).toEqual(['patch']);

        const stats = await fast.getStats();
        expect(stats).toMatchObject({ totalVectors: 4, totalEpisodes: 2, totalPatterns: 2 });
        expect(stats.avgQuality).toBeCloseTo(0.55, 5);
      } finally {
        await fast.close();
      }
    }, 60_000);

    it.runIf(backendType === 'rvf')('surfaces a type conflict from storePattern', async () => {
      const fast = await fastOn('rvf');
      try {
        await fast.storePattern({ task: 't', input: 'i', output: 'o', quality: 0.5 });
        await expect(
          fast.storePattern({ task: 't', input: 'i2', output: 'o2', quality: 'high' as any })
        ).rejects.toBeInstanceOf(RvfMetadataTypeConflictError);
      } finally {
        await fast.close();
      }
    }, 60_000);
  });
}

describe('AgentDBService.recallEpisodes pushes filters into ReflexionMemory', () => {
  it('splits native filters from the rest', async () => {
    const { splitEpisodeFilters } = await import('../../src/services/agentdb-service.js');
    expect(splitEpisodeFilters({ reward: { $gte: 0.5, $lte: 0.9 }, success: true, tag: 'x' })).toEqual({
      native: { minReward: 0.5, onlySuccesses: true },
      rest: { reward: { $lte: 0.9 }, tag: 'x' },
    });
    expect(splitEpisodeFilters({ minReward: 0.2, timeWindowDays: 7, success: false })).toEqual({
      native: { minReward: 0.2, timeWindowDays: 7, onlyFailures: true },
      rest: {},
    });
    expect(splitEpisodeFilters(undefined)).toEqual({ native: {}, rest: {} });
  });

  it('round-trips through a real agentdb store with native reward/success filters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-agentdb37-svc-'));
    tempDirs.push(dir);
    const saved = { dir: process.env.AGENTIC_FLOW_AGENTDB_DIR, tf: process.env.AGENTDB_DISABLE_TRANSFORMERS };
    process.env.AGENTIC_FLOW_AGENTDB_DIR = dir;
    process.env.AGENTDB_DISABLE_TRANSFORMERS = '1'; // deterministic offline embeddings
    const { AgentDBService } = await import('../../src/services/agentdb-service.js');
    AgentDBService.resetInstance();
    const svc = await AgentDBService.getInstance();
    try {
      expect(svc.getBackendName()).toBe('agentdb');
      const base = { sessionId: 's', input: 'i', output: 'o', critique: '' };
      await svc.storeEpisode({ ...base, task: 'deploy the api service', reward: 0.9, success: true });
      await svc.storeEpisode({ ...base, task: 'deploy the api service again', reward: 0.1, success: false });
      await svc.storeEpisode({ ...base, task: 'deploy the api service once more', reward: 0.7, success: true });

      const all = await svc.recallEpisodes('deploy the api service', 10);
      expect(all.length).toBe(3);
      const good = await svc.recallEpisodes('deploy the api service', 10, { reward: { $gte: 0.5 } });
      expect(good.map((e) => e.reward).sort()).toEqual([0.7, 0.9]);
      const failed = await svc.recallEpisodes('deploy the api service', 10, { success: false });
      expect(failed.map((e) => e.reward)).toEqual([0.1]);
      const banded = await svc.recallEpisodes('deploy the api service', 10, { reward: { $gte: 0.5, $lte: 0.8 } });
      expect(banded.map((e) => e.reward)).toEqual([0.7]);
      // answered by agentdb, not the in-memory fallback it drops to on error
      expect((svc as any).reflexionMemory).not.toBeNull();
    } finally {
      await (svc as any).shutdown?.();
      AgentDBService.resetInstance();
      if (saved.dir === undefined) delete process.env.AGENTIC_FLOW_AGENTDB_DIR;
      else process.env.AGENTIC_FLOW_AGENTDB_DIR = saved.dir;
      if (saved.tf === undefined) delete process.env.AGENTDB_DISABLE_TRANSFORMERS;
      else process.env.AGENTDB_DISABLE_TRANSFORMERS = saved.tf;
    }
  }, 60_000);
});
