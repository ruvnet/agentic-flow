/**
 * @ruvector/mincut-wasm and @ruvnet/sublinear-core integrations: real engines
 * answer, and agree with the built-in fallbacks.
 */
import { describe, expect, it } from 'vitest';
import { partitionTaskGraph } from '../../src/integrations/task-partition.js';
import * as core from '@ruvnet/sublinear-core';
import { pageRank, solveLinearSystem } from '../../src/integrations/sublinear.js';

const deps = [
  ['api', 'db', 5], ['api', 'auth', 5], ['db', 'auth', 5], ['auth', 'ui', 1],
  ['ui', 'css', 5], ['ui', 'i18n', 5], ['css', 'i18n', 5],
].map(([from, to, weight]) => ({ from: from as string, to: to as string, weight: weight as number }));
// @ruvector/mincut-wasm declares engines.node >= 22, so npm skips it on Node 20
// and partitioning uses the built-in engine there (CI runs both).
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
const MINCUT_ENGINE = NODE_MAJOR >= 22 ? 'mincut-wasm' : 'builtin';
const tasks = ['api', 'db', 'auth', 'ui', 'css', 'i18n', 'docs'];

describe('task partitioning (@ruvector/mincut-wasm)', () => {
  it(`finds the weakest seam (${MINCUT_ENGINE} on Node ${NODE_MAJOR})`, async () => {
    const p = await partitionTaskGraph(tasks, deps);
    expect(p.engine).toBe(MINCUT_ENGINE);
    expect(p.cutWeight).toBe(1);
    expect(p.cutEdges).toEqual([{ from: 'auth', to: 'ui', weight: 1 }]);
    expect(p.isolated).toEqual(['docs']);
    expect(p.groups.map((g) => [...g].sort())).toEqual(expect.arrayContaining([['api', 'auth', 'db'], ['css', 'i18n', 'ui']]));
  });

  it('matches the built-in Stoer-Wagner fallback', async () => {
    const wasm = await partitionTaskGraph(tasks, deps);
    const builtin = await partitionTaskGraph(tasks, deps, { engine: 'builtin' });
    expect(builtin.engine).toBe('builtin');
    expect(builtin.cutWeight).toBe(wasm.cutWeight);
    expect(builtin.groups.map((g) => [...g].sort()).sort()).toEqual(wasm.groups.map((g) => [...g].sort()).sort());
  });

  it('rejects negative weights', async () => {
    await expect(partitionTaskGraph(['a', 'b'], [{ from: 'a', to: 'b', weight: -1 }])).rejects.toThrow('invalid dependency weight');
  });
});

describe('linear solves and PageRank (@ruvnet/sublinear-core)', () => {
  const M = [[4, -1, 0], [-1, 4, -1], [0, -1, 4]];

  it('solves with the core package and verifies the residual', async () => {
    const r = await solveLinearSystem(M, [1, 2, 3]);
    expect(r.engine).toBe('sublinear-core');
    expect(r.method).toBe('conjugate-gradient'); // symmetric, positive diagonal
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.libraryRejected).toBeUndefined();
    expect(r.solution[0]).toBeCloseTo(13 / 28, 6);
    expect(r.solution[1]).toBeCloseTo(6 / 7, 6);
    expect(r.solution[2]).toBeCloseTo(27 / 28, 6);
    expect(r.residual).toBeLessThan(1e-6);
  });

  it('agrees with calling the core package directly', async () => {
    const direct = core.solve(M, [1, 2, 3], { tolerance: 1e-12 });
    const r = await solveLinearSystem(M, [1, 2, 3]);
    r.solution.forEach((v, i) => expect(v).toBeCloseTo(direct.x[i], 8));
  });

  it('the Gauss-Seidel fallback gives the same answer', async () => {
    const lib = await solveLinearSystem(M, [1, 2, 3]);
    const gs = await solveLinearSystem(M, [1, 2, 3], { engine: 'builtin' });
    expect(gs.engine).toBe('builtin');
    gs.solution.forEach((v, i) => expect(v).toBeCloseTo(lib.solution[i], 6));
  });

  it('accepts a converged core answer on a large non-symmetric system (n = 2000)', async () => {
    const n = 2000;
    const entries = [];
    for (let i = 0; i < n; i++) {
      entries.push({ row: i, col: i, value: 4 });
      if (i > 0) entries.push({ row: i, col: i - 1, value: -1.5 });
      if (i < n - 1) entries.push({ row: i, col: i + 1, value: -0.5 });
    }
    const b = Array.from({ length: n }, (_, i) => Math.sin(i) * 100);
    const r = await solveLinearSystem({ size: n, entries }, b, { tolerance: 1e-8 });
    expect(r.libraryRejected).toBeUndefined();
    expect(r).toMatchObject({ engine: 'sublinear-core', method: 'gauss-seidel', converged: true });
    expect(r.residual).toBeLessThanOrEqual(1e-8 * 100 * 10);
  });

  it('honours an explicit method', async () => {
    const r = await solveLinearSystem(M, [1, 2, 3], { method: 'jacobi' });
    expect(r).toMatchObject({ engine: 'sublinear-core', method: 'jacobi', converged: true });
  });

  it('rejects a non-converging core answer and reports why', async () => {
    const r = await solveLinearSystem([[1, 3], [3, 1]], [1, 1], { maxIterations: 50, method: 'jacobi' });
    expect(r.engine).toBe('builtin');
    expect(r.converged).toBe(false);
    expect(r.libraryRejected).toMatch(/did not converge|residual/);
  });

  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'd', to: 'c' }];

  it('computes PageRank that sums to 1 and matches the fallback', async () => {
    const lib = await pageRank(edges);
    const gs = await pageRank(edges, { engine: 'builtin' });
    expect(lib).toMatchObject({ engine: 'sublinear-core', method: 'power-iteration', personalized: false });
    const total = Object.values(lib.scores).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 8);
    expect(lib.ranking[0].node).toBe('c');
    expect(lib.scores.d).toBeCloseTo(0.15 / 4, 6); // no in-links: teleport mass only
    for (const n of Object.keys(lib.scores)) expect(lib.scores[n]).toBeCloseTo(gs.scores[n], 6);
  });

  it('PageRank with dangling and isolated nodes matches the core package and the fallback', async () => {
    const e = [...edges, { from: 'c', to: 'e', weight: 2 }];
    const lib = await pageRank(e, { nodes: ['z'], damping: 0.7 });
    const gs = await pageRank(e, { nodes: ['z'], damping: 0.7, engine: 'builtin' });
    const g = core.graphFromEdges(e.map((x) => [x.from, x.to, x.weight ?? 1] as [string, string, number]));
    const direct = core.pageRank(g, { damping: 0.7, tolerance: 1e-12, maxIterations: 10000 });
    expect(lib.scores.z).toBeGreaterThan(0);
    for (const n of Object.keys(gs.scores)) expect(lib.scores[n]).toBeCloseTo(gs.scores[n], 6);
    // Without the isolated node the core's own scores differ only by n; compare ordering.
    const coreOrder = core.topK(direct.scores, 5, g).map((x: any) => x.node);
    expect(lib.ranking.filter((r) => r.node !== 'z').map((r) => r.node)).toEqual(coreOrder);
  });

  it('personalized PageRank from seeds matches the fallback', async () => {
    const lib = await pageRank(edges, { seeds: ['d'] });
    const gs = await pageRank(edges, { seeds: ['d'], engine: 'builtin' });
    expect(lib).toMatchObject({ engine: 'sublinear-core', personalized: true });
    for (const n of Object.keys(gs.scores)) expect(lib.scores[n]).toBeCloseTo(gs.scores[n], 6);
    expect(lib.scores.d).toBeCloseTo(0.15, 6); // only restarts reach d
    const weighted = await pageRank(edges, { seeds: { a: 3, d: 1 } });
    const weightedGs = await pageRank(edges, { seeds: { a: 3, d: 1 }, engine: 'builtin' });
    for (const n of Object.keys(weightedGs.scores)) expect(weighted.scores[n]).toBeCloseTo(weightedGs.scores[n], 6);
  });

  it('approximate: forward push finds the same top-k on a large graph', async () => {
    const n = 20000;
    const rand = core.mulberry32(7);
    const big: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) big.push({ from: `n${i}`, to: `n${Math.floor(rand() * n)}` });
    }
    const exact = await pageRank(big, { seeds: ['n0'], top: 10 });
    const approx = await pageRank(big, { seeds: ['n0'], approximate: true, epsilon: 1e-7, top: 10 });
    expect(approx).toMatchObject({ engine: 'sublinear-core', method: 'forward-push', personalized: true });
    expect(approx.ranking).toHaveLength(10);
    expect(Object.keys(approx.scores)).toHaveLength(10);
    expect(approx.residualMass).toBeLessThan(0.05);
    expect(approx.ranking.slice(0, 5).map((r) => r.node)).toEqual(exact.ranking.slice(0, 5).map((r) => r.node));
    approx.ranking.forEach((r) => expect(Math.abs(r.score - exact.scores[r.node])).toBeLessThanOrEqual(approx.residualMass!));
  });

  it('rejects approximate without seeds and unknown seeds', async () => {
    await expect(pageRank(edges, { approximate: true })).rejects.toThrow('needs seeds');
    await expect(pageRank(edges, { seeds: ['nope'] })).rejects.toThrow('unknown seed node nope');
  });

  it('keeps stdout clean (the MCP stdio server owns it)', async () => {
    const writes: string[] = [];
    const original = process.stdout.write;
    (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
      writes.push(String(chunk));
      return (original as any).call(process.stdout, chunk, ...rest);
    };
    try {
      await solveLinearSystem([[3, 1], [1, 3]], [4, 4], { tolerance: 1e-9 });
      await pageRank(edges, { seeds: ['a'], approximate: true });
    } finally {
      process.stdout.write = original;
    }
    expect(writes.join('')).toBe('');
  });
});
