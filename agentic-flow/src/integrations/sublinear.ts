/**
 * Linear solves and PageRank through `sublinear-time-solver`, verified.
 *
 * sublinear-time-solver (optionalDependency, ~120 MB installed with its own
 * deps) solves diagonally dominant systems with push / random-walk methods.
 * Measured against 1.7.2: `forward-push` is accurate, but the default
 * `neumann` method returned a wrong answer with `converged: false` and
 * `random-walk` threw, and the package logs banners with `console.log`. So:
 * - only `forward-push` is used;
 * - every answer is checked against the residual ||Mx - b||_inf here, and a
 *   built-in Gauss-Seidel solve replaces it when the check fails;
 * - the import, construction and solve run with console output sent to stderr
 *   (the MCP stdio server owns stdout).
 *
 * The 5 bundled `sublinear/*` agents name sublinear-time-solver tools; the
 * `sublinear_solve` / `sublinear_pagerank` MCP tools in this package give them
 * a working in-process path without a separate MCP server.
 */

import { importOptional, withStdoutToStderr } from './optional.js';

export interface SparseEntry {
  row: number;
  col: number;
  value: number;
}

export type MatrixInput = number[][] | { size: number; entries: SparseEntry[] };

export interface LinearSolveResult {
  solution: number[];
  /** max_i |(Mx - b)_i| */
  residual: number;
  converged: boolean;
  iterations: number;
  diagonallyDominant: boolean;
  engine: 'sublinear-time-solver' | 'builtin';
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

function residualInf(a: Csr, x: number[], b: number[]): number {
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

const solverCache = new Map<string, any>();

async function librarySolve(a: Csr, b: number[], tol: number, maxIterations: number): Promise<number[] | null> {
  return withStdoutToStderr(async () => {
    const mod = await importOptional<any>('sublinear-time-solver/core', { quietStdout: true });
    const Solver = mod?.SublinearSolver;
    if (typeof Solver !== 'function') return null;
    const key = `${tol}|${maxIterations}`;
    let solver = solverCache.get(key);
    if (!solver) {
      solver = new Solver({ method: 'forward-push', epsilon: tol, maxIterations });
      // The constructor starts WASM probing asynchronously and logs when it
      // finishes; let that settle while console output is still redirected.
      await solver.initializeWasm?.().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 0));
      if (solverCache.size > 8) solverCache.clear();
      solverCache.set(key, solver);
    }
    const values: number[] = [];
    const rowIndices: number[] = [];
    const colIndices: number[] = [];
    a.rows.forEach((row, i) => {
      for (const [j, v] of row) {
        values.push(v);
        rowIndices.push(i);
        colIndices.push(j);
      }
    });
    const res = await solver.solve({ rows: a.n, cols: a.n, values, rowIndices, colIndices, format: 'coo' }, b);
    return Array.isArray(res?.solution) ? res.solution.map(Number) : null;
  });
}

/**
 * Solve Mx = b. Intended for (row) diagonally dominant M; other matrices are
 * attempted with Gauss-Seidel and reported with `converged: false` if it fails.
 */
export async function solveLinearSystem(
  matrix: MatrixInput,
  b: number[],
  options: { tolerance?: number; maxIterations?: number; engine?: 'auto' | 'builtin' } = {},
): Promise<LinearSolveResult> {
  const a = toCsr(matrix);
  if (!Array.isArray(b) || b.length !== a.n) throw new Error(`vector length ${b?.length} != matrix size ${a.n}`);
  if (!b.every(Number.isFinite)) throw new Error('vector entries must be finite');
  const tol = options.tolerance ?? 1e-8;
  const maxIterations = Math.min(options.maxIterations ?? 10000, 1_000_000);
  // Residual tolerance scaled to the problem: absolute tol on ||b||_inf ~ 1.
  const scale = Math.max(1, ...b.map(Math.abs));
  const accept = tol * scale * 10;
  const diagonallyDominant = isDiagonallyDominant(a);

  let libraryRejected: string | undefined;
  if (options.engine !== 'builtin') {
    try {
      const x = await librarySolve(a, b, tol, maxIterations);
      if (x && x.length === a.n && x.every(Number.isFinite)) {
        const r = residualInf(a, x, b);
        if (r <= accept) {
          return { solution: x, residual: r, converged: true, iterations: 0, diagonallyDominant, engine: 'sublinear-time-solver' };
        }
        libraryRejected = `residual ${r.toExponential(2)} above ${accept.toExponential(2)}`;
      }
    } catch (err: any) {
      libraryRejected = err?.message ?? String(err);
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
    ...(libraryRejected ? { libraryRejected } : {}),
  };
}

export interface PageRankResult {
  scores: Record<string, number>;
  ranking: Array<{ node: string; score: number }>;
  engine: LinearSolveResult['engine'];
  residual: number;
}

/**
 * PageRank over a directed graph as a linear system:
 * (I - d·Pᵀ) y = 1, then scores = y / Σy. With dangling rows left at zero this
 * equals PageRank with uniform teleport from dangling nodes.
 */
export async function pageRank(
  edges: Array<{ from: string; to: string; weight?: number }>,
  options: { damping?: number; nodes?: string[]; engine?: 'auto' | 'builtin' } = {},
): Promise<PageRankResult> {
  const d = options.damping ?? 0.85;
  if (!(d > 0 && d < 1)) throw new Error('damping must be in (0, 1)');
  const ids = new Map<string, number>();
  const names: string[] = [];
  const add = (s: string) => {
    if (!ids.has(s)) {
      ids.set(s, names.length);
      names.push(s);
    }
    return ids.get(s)!;
  };
  for (const n of options.nodes ?? []) add(String(n));
  const out: Array<Map<number, number>> = [];
  for (const e of edges) {
    const w = e.weight ?? 1;
    if (!Number.isFinite(w) || w < 0) throw new Error(`invalid edge weight ${w}`);
    const a = add(String(e.from));
    const b = add(String(e.to));
    while (out.length < names.length) out.push(new Map());
    out[a].set(b, (out[a].get(b) ?? 0) + w);
  }
  while (out.length < names.length) out.push(new Map());
  const n = names.length;
  if (n === 0) return { scores: {}, ranking: [], engine: 'builtin', residual: 0 };

  // M = I - d * P^T, P row-normalised out-links.
  const entries: SparseEntry[] = [];
  for (let i = 0; i < n; i++) entries.push({ row: i, col: i, value: 1 });
  out.forEach((links, src) => {
    let total = 0;
    for (const w of links.values()) total += w;
    if (total === 0) return;
    for (const [dst, w] of links) entries.push({ row: dst, col: src, value: -d * (w / total) });
  });
  const res = await solveLinearSystem({ size: n, entries }, new Array(n).fill(1), {
    tolerance: 1e-10,
    engine: options.engine,
  });
  const sum = res.solution.reduce((s, v) => s + v, 0) || 1;
  const scores: Record<string, number> = {};
  names.forEach((name, i) => (scores[name] = res.solution[i] / sum));
  const ranking = names
    .map((node) => ({ node, score: scores[node] }))
    .sort((x, y) => y.score - x.score);
  return { scores, ranking, engine: res.engine, residual: res.residual };
}
