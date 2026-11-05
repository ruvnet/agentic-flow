/**
 * @ruvector/mincut-wasm and sublinear-time-solver integrations: real engines
 * answer, and agree with the built-in fallbacks.
 */
import { describe, expect, it } from 'vitest';
import { partitionTaskGraph } from '../../src/integrations/task-partition.js';
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

describe('linear solves and PageRank (sublinear-time-solver)', () => {
  const M = [[4, -1, 0], [-1, 4, -1], [0, -1, 4]];

  it('solves with the library and verifies the residual', async () => {
    const r = await solveLinearSystem(M, [1, 2, 3]);
    expect(r.engine).toBe('sublinear-time-solver');
    expect(r.converged).toBe(true);
    expect(r.solution[0]).toBeCloseTo(13 / 28, 6);
    expect(r.solution[1]).toBeCloseTo(6 / 7, 6);
    expect(r.solution[2]).toBeCloseTo(27 / 28, 6);
    expect(r.residual).toBeLessThan(1e-6);
  });

  it('the Gauss-Seidel fallback gives the same answer', async () => {
    const lib = await solveLinearSystem(M, [1, 2, 3]);
    const gs = await solveLinearSystem(M, [1, 2, 3], { engine: 'builtin' });
    expect(gs.engine).toBe('builtin');
    gs.solution.forEach((v, i) => expect(v).toBeCloseTo(lib.solution[i], 6));
  });

  it('computes PageRank that sums to 1 and matches the fallback', async () => {
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'd', to: 'c' }];
    const lib = await pageRank(edges);
    const gs = await pageRank(edges, { engine: 'builtin' });
    expect(lib.engine).toBe('sublinear-time-solver');
    const total = Object.values(lib.scores).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 8);
    expect(lib.ranking[0].node).toBe('c');
    expect(lib.scores.d).toBeCloseTo(0.15 / 4, 6); // no in-links: teleport mass only
    for (const n of Object.keys(lib.scores)) expect(lib.scores[n]).toBeCloseTo(gs.scores[n], 6);
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
    } finally {
      process.stdout.write = original;
    }
    expect(writes.join('')).not.toMatch(/JavaScript mode|WASM/);
  });
});
