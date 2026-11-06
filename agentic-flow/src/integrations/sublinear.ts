/**
 * Linear solves and PageRank through `@ruvnet/sublinear-core`, verified.
 *
 * @ruvnet/sublinear-core (optionalDependency, zero dependencies, ~220 kB) is
 * the embeddable core of sublinear-time-solver: sparse iterative solvers
 * (Gauss-Seidel, conjugate gradient, Jacobi, Neumann), PageRank, personalized
 * PageRank and local forward push. It reports the residual of the x it
 * returns, but every answer is still checked here against ||Mx - b||_inf, and
 * a built-in Gauss-Seidel solve replaces it when the check fails or the
 * package is not installed.
 *
 * The 5 bundled `sublinear/*` agents name sublinear-time-solver tools; the
 * `sublinear_solve` / `sublinear_pagerank` MCP tools in this package give them
 * a working in-process path without a separate MCP server.
 */

import { importOptional } from './optional.js';

export const SUBLINEAR_CORE = '@ruvnet/sublinear-core';

export interface SparseEntry {
  row: number;
  col: number;
  value: number;
}

export type MatrixInput = number[][] | { size: number; entries: SparseEntry[] };

export type SolveMethod = 'auto' | 'gauss-seidel' | 'conjugate-gradient' | 'jacobi' | 'neumann';

export type SublinearEngine = 'sublinear-core' | 'builtin';

export interface LinearSolveResult {
  solution: number[];
  /** max_i |(Mx - b)_i|, recomputed here from the returned solution. */
  residual: number;
  converged: boolean;
  iterations: number;
  diagonallyDominant: boolean;
  engine: SublinearEngine;
  /** Method that produced the solution. */
  method: Exclude<SolveMethod, 'auto'>;
  /** Set when the library answered but failed verification. */
  libraryRejected?: string;
}

interface Csr {
  n: number;
  rows: Array<Array<[number, number]>>; // per row: [col, value]
  diag: number[];
}

function toCsr(m: MatrixInput): Csr {
  if (Array.isArray(m)) {
    const n = m.length;
    const rows = m.map((row, i) => {
      if (!Array.isArray(row) || row.length !== n) throw new Error(`matrix must be square; row ${i} has ${row?.length}`);
      const out: Array<[number, number]> = [];
      row.forEach((v, j) => {
        if (!Number.isFinite(v)) throw new Error(`matrix[${i}][${j}] is not finite`);
        if (v !== 0) out.push([j, v]);
      });
      return out;
    });
    return { n, rows, diag: m.map((row, i) => row[i]) };
  }
  const n = m.size;
  if (!Number.isInteger(n) || n < 1) throw new Error('size must be a positive integer');
  const acc: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  for (const { row, col, value } of m.entries) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= n || col >= n) {
      throw new Error(`entry (${row}, ${col}) is outside a ${n}x${n} matrix`);
    }
    if (!Number.isFinite(value)) throw new Error(`entry (${row}, ${col}) is not finite`);
    acc[row].set(col, (acc[row].get(col) ?? 0) + value);
  }
  const rows = acc.map((r) => [...r.entries()].filter(([, v]) => v !== 0));
  return { n, rows, diag: acc.map((r, i) => r.get(i) ?? 0) };
}

function residualInf(a: Csr, x: ArrayLike<number>, b: number[]): number {
  let worst = 0;
  for (let i = 0; i < a.n; i++) {
    let s = 0;
    for (const [j, v] of a.rows[i]) s += v * x[j];
    worst = Math.max(worst, Math.abs(s - b[i]));
  }
  return worst;
}

function isDiagonallyDominant(a: Csr): boolean {
  return a.rows.every((row, i) => {
    let off = 0;
    for (const [j, v] of row) if (j !== i) off += Math.abs(v);
    return Math.abs(a.diag[i]) >= off && a.diag[i] !== 0;
  });
}

function gaussSeidel(a: Csr, b: number[], tol: number, maxIterations: number) {
  const x = new Array(a.n).fill(0);
  let it = 0;
  for (; it < maxIterations; it++) {
    for (let i = 0; i < a.n; i++) {
      if (a.diag[i] === 0) throw new Error(`zero diagonal at row ${i}: Gauss-Seidel needs a nonzero diagonal`);
      let s = b[i];
      for (const [j, v] of a.rows[i]) if (j !== i) s -= v * x[j];
      x[i] = s / a.diag[i];
    }
    if (residualInf(a, x, b) <= tol) return { x, iterations: it + 1 };
  }
  return { x, iterations: it };
}

/** The core module, or null when it is not installed. */
export async function loadSublinearCore(): Promise<any | null> {
  const mod = await importOptional<any>(SUBLINEAR_CORE);
  return typeof mod?.solve === 'function' && typeof mod?.pageRank === 'function' ? mod : null;
}

function coreSolve(core: any, a: Csr, b: number[], tol: number, maxIterations: number, method: SolveMethod) {
  const rowIndices: number[] = [];
  const colIndices: number[] = [];
  const values: number[] = [];
  a.rows.forEach((row, i) => {
    for (const [j, v] of row) {
      rowIndices.push(i);
      colIndices.push(j);
      values.push(v);
    }
  });
  const A = core.csrFromCoo({ rows: a.n, cols: a.n, rowIndices, colIndices, values });
  // Core stops on the relative L2 residual ||b - Ax||_2 / ||b||_2. The local
  // gate is an absolute inf-norm bound, and ||r||_inf <= ||r||_2, so asking
  // core for tol / sqrt(n) keeps every converged core answer inside it.
  return core.solve(A, b, { method, tolerance: tol / Math.sqrt(a.n), maxIterations });
}

/**
 * Solve Mx = b. Intended for (row) diagonally dominant or symmetric positive
 * definite M; other matrices are attempted with Gauss-Seidel and reported with
 * `converged: false` if it fails.
 */
export async function solveLinearSystem(
  matrix: MatrixInput,
  b: number[],
  options: { tolerance?: number; maxIterations?: number; method?: SolveMethod; engine?: 'auto' | 'builtin' } = {},
): Promise<LinearSolveResult> {
  const a = toCsr(matrix);
  if (!Array.isArray(b) || b.length !== a.n) throw new Error(`vector length ${b?.length} != matrix size ${a.n}`);
  if (!b.every(Number.isFinite)) throw new Error('vector entries must be finite');
  const tol = options.tolerance ?? 1e-8;
  const maxIterations = Math.min(options.maxIterations ?? 10000, 1_000_000);
  // Absolute inf-norm acceptance scaled to the problem: tol on ||b||_inf ~ 1.
  const scale = Math.max(1, ...b.map(Math.abs));
  const accept = tol * scale * 10;
  const diagonallyDominant = isDiagonallyDominant(a);

  let libraryRejected: string | undefined;
  if (options.engine !== 'builtin') {
    const core = await loadSublinearCore();
    if (core) {
      try {
        const r = coreSolve(core, a, b, tol, maxIterations, options.method ?? 'auto');
        const x: number[] = Array.from(r.x as Float64Array);
        const residual = residualInf(a, x, b);
        if (r.converged && x.every(Number.isFinite) && residual <= accept) {
          return { solution: x, residual, converged: true, iterations: r.iterations, diagonallyDominant, engine: 'sublinear-core', method: r.method };
        }
        libraryRejected = r.converged
          ? `residual ${residual.toExponential(2)} above ${accept.toExponential(2)}`
          : `${r.method} did not converge in ${r.iterations} iterations (relative residual ${Number(r.residual).toExponential(2)})`;
      } catch (err: any) {
        libraryRejected = err?.message ?? String(err);
      }
    }
  }

  const { x, iterations } = gaussSeidel(a, b, accept, maxIterations);
  const residual = residualInf(a, x, b);
  return {
    solution: x,
    residual,
    converged: residual <= accept,
    iterations,
    diagonallyDominant,
    engine: 'builtin',
    method: 'gauss-seidel',
    ...(libraryRejected ? { libraryRejected } : {}),
  };
}

export interface PageRankEdge {
  from: string;
  to: string;
  weight?: number;
}

export interface PageRankOptions {
  /** Probability of following an out-edge (1 - restart probability). Default 0.85. */
  damping?: number;
  /** Extra nodes with no edges. */
  nodes?: string[];
  /** Personalized PageRank: restart at these nodes (equal weight) or by weight. */
  seeds?: string[] | Record<string, number>;
  /**
   * With `seeds`: estimate by local forward push instead of power iteration.
   * Work depends on `epsilon`, not on the graph size; scores of nodes far from
   * the seeds are left at 0 and `residualMass` bounds the total L1 error.
   */
  approximate?: boolean;
  /** Forward-push residual threshold. Default 1e-6. */
  epsilon?: number;
  /** Return only the top N in `ranking` (and `scores`, for approximate runs). */
  top?: number;
  engine?: 'auto' | 'builtin';
}

export interface PageRankResult {
  scores: Record<string, number>;
  ranking: Array<{ node: string; score: number }>;
  engine: SublinearEngine;
  method: 'power-iteration' | 'forward-push' | 'gauss-seidel';
  personalized: boolean;
  /** Linear-system residual (gauss-seidel) or last L1 change (power iteration). */
  residual: number;
  /** forward-push only: unpushed mass, an upper bound on the total L1 error. */
  residualMass?: number;
  /** Set when the library answered but failed verification. */
  libraryRejected?: string;
}

interface IndexedGraph {
  names: string[];
  edges: Array<[number, number, number]>;
  out: Array<Map<number, number>>;
  teleport: number[] | null; // normalized seed distribution, null = uniform
}

function indexGraph(edges: PageRankEdge[], options: PageRankOptions): IndexedGraph {
  const ids = new Map<string, number>();
  const names: string[] = [];
  const add = (s: string) => {
    let i = ids.get(s);
    if (i === undefined) {
      i = names.length;
      ids.set(s, i);
      names.push(s);
    }
    return i;
  };
  for (const n of options.nodes ?? []) add(String(n));
  const indexed: Array<[number, number, number]> = [];
  for (const e of edges) {
    const w = e.weight ?? 1;
    if (!Number.isFinite(w) || w < 0) throw new Error(`invalid edge weight ${w}`);
    indexed.push([add(String(e.from)), add(String(e.to)), w]);
  }
  const out: Array<Map<number, number>> = Array.from({ length: names.length }, () => new Map());
  for (const [a, b, w] of indexed) out[a].set(b, (out[a].get(b) ?? 0) + w);

  let teleport: number[] | null = null;
  if (options.seeds !== undefined) {
    const weights: Array<[string, number]> = Array.isArray(options.seeds)
      ? options.seeds.map((s) => [String(s), 1])
      : Object.entries(options.seeds);
    if (weights.length === 0) throw new Error('seeds must name at least one node');
    teleport = new Array(names.length).fill(0);
    for (const [name, w] of weights) {
      const i = ids.get(name);
      if (i === undefined) throw new Error(`unknown seed node ${name}`);
      if (!Number.isFinite(w) || w < 0) throw new Error(`invalid seed weight ${w} for ${name}`);
      teleport[i] += w;
    }
    const total = teleport.reduce((s, v) => s + v, 0);
    if (!(total > 0)) throw new Error('seed weights must not all be zero');
    teleport = teleport.map((v) => v / total);
  }
  return { names, edges: indexed, out, teleport };
}

function rank(names: string[], scores: Map<number, number> | number[], top?: number) {
  const entries: Array<[number, number]> = scores instanceof Map ? [...scores] : scores.map((s, i) => [i, s]);
  entries.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  return (top ? entries.slice(0, top) : entries).map(([i, score]) => ({ node: names[i], score }));
}

/**
 * Built-in PageRank as a linear system: (I - d·Pᵀ) y = v, scores = y / Σy,
 * with v uniform or the seed distribution. With dangling rows left at zero
 * this equals PageRank whose dangling mass follows the teleport vector, which
 * is also what the core computes.
 */
async function builtinPageRank(g: IndexedGraph, d: number) {
  const n = g.names.length;
  const entries: SparseEntry[] = [];
  for (let i = 0; i < n; i++) entries.push({ row: i, col: i, value: 1 });
  g.out.forEach((links, src) => {
    let total = 0;
    for (const w of links.values()) total += w;
    if (total === 0) return;
    for (const [dst, w] of links) entries.push({ row: dst, col: src, value: -d * (w / total) });
  });
  const v = g.teleport ?? new Array(n).fill(1);
  const res = await solveLinearSystem({ size: n, entries }, v, { tolerance: 1e-10, engine: 'builtin' });
  const sum = res.solution.reduce((s, x) => s + x, 0) || 1;
  return { scores: res.solution.map((x) => x / sum), residual: res.residual };
}

/**
 * PageRank over a directed graph, or personalized PageRank from `seeds`.
 * Scores sum to 1 (approximate runs: to 1 - residualMass).
 */
export async function pageRank(edges: PageRankEdge[], options: PageRankOptions = {}): Promise<PageRankResult> {
  const d = options.damping ?? 0.85;
  if (!(d > 0 && d < 1)) throw new Error('damping must be in (0, 1)');
  if (options.approximate && options.seeds === undefined) {
    throw new Error('approximate (forward push) needs seeds: it estimates personalized PageRank around them');
  }
  const g = indexGraph(edges, options);
  const n = g.names.length;
  const personalized = g.teleport !== null;
  if (n === 0) return { scores: {}, ranking: [], engine: 'builtin', method: 'gauss-seidel', personalized, residual: 0 };

  let libraryRejected: string | undefined;
  const core = options.engine === 'builtin' ? null : await loadSublinearCore();
  if (core) {
    try {
      const graph = core.graphFromEdges(g.edges, { n });
      const seeds = g.teleport ? new Map(g.teleport.flatMap((w, i) => (w > 0 ? [[i, w] as [number, number]] : []))) : null;

      if (options.approximate && seeds) {
        const r = core.forwardPush(graph, seeds, { damping: d, epsilon: options.epsilon ?? 1e-6 });
        let mass = 0;
        for (const s of r.scores.values()) mass += s;
        // Forward push keeps p + r = 1 exactly; check that the books balance.
        if (r.converged && Math.abs(mass + r.residualMass - 1) <= 1e-6) {
          const ranking = rank(g.names, r.scores, options.top);
          const scores: Record<string, number> = {};
          for (const { node, score } of ranking) scores[node] = score;
          return { scores, ranking, engine: 'sublinear-core', method: 'forward-push', personalized, residual: r.residualMass, residualMass: r.residualMass };
        }
        libraryRejected = r.converged ? `forward push mass ${mass + r.residualMass} != 1` : `forward push stopped after ${r.pushes} pushes`;
      } else {
        const opts = { damping: d, tolerance: 1e-12, maxIterations: 10000 };
        const r = seeds ? core.personalizedPageRank(graph, seeds, opts) : core.pageRank(graph, opts);
        const x: number[] = Array.from(r.scores as Float64Array);
        const total = x.reduce((s, v) => s + v, 0);
        if (r.converged && x.every((v) => Number.isFinite(v) && v >= 0) && Math.abs(total - 1) <= 1e-8) {
          const scores: Record<string, number> = {};
          g.names.forEach((name, i) => (scores[name] = x[i]));
          return { scores, ranking: rank(g.names, x, options.top), engine: 'sublinear-core', method: 'power-iteration', personalized, residual: r.delta };
        }
        libraryRejected = r.converged ? `scores sum to ${total}, not 1` : `power iteration did not converge (delta ${r.delta})`;
      }
    } catch (err: any) {
      libraryRejected = err?.message ?? String(err);
    }
  }

  const { scores: x, residual } = await builtinPageRank(g, d);
  const scores: Record<string, number> = {};
  g.names.forEach((name, i) => (scores[name] = x[i]));
  return {
    scores,
    ranking: rank(g.names, x, options.top),
    engine: 'builtin',
    method: 'gauss-seidel',
    personalized,
    residual,
    ...(libraryRejected ? { libraryRejected } : {}),
  };
}
