/**
 * Task-graph scheduling (swarm_schedule_tasks) against the real
 * @ruvector/rudag WASM package — no mocks — and the built-in fallback.
 */
import { describe, expect, it } from 'vitest';
import { scheduleTaskGraph } from '../../src/integrations/task-schedule.js';
import { ECOSYSTEM_TOOLS } from '../../src/mcp/tools/ecosystem-tools.js';
import { installMcpPolicy } from '../../src/mcp/mcp-policy.js';

// design(5) and api(3) run in parallel; impl needs both; review needs impl; docs only needs api.
const tasks = [
  { id: 'design', cost: 5 },
  { id: 'api', cost: 3 },
  { id: 'impl', cost: 2 },
  { id: 'review', cost: 1 },
  { id: 'docs', cost: 1 },
];
const deps = [
  { from: 'design', to: 'impl' },
  { from: 'api', to: 'impl' },
  { from: 'impl', to: 'review' },
  { from: 'api', to: 'docs' },
];

function respectsDependencies(order: string[]) {
  const pos = new Map(order.map((t, i) => [t, i]));
  return deps.every((d) => pos.get(d.from)! < pos.get(d.to)!);
}

describe('scheduleTaskGraph', () => {
  for (const engine of ['auto', 'builtin'] as const) {
    it(`${engine}: order, waves, earliest start and critical path`, async () => {
      const s = await scheduleTaskGraph(tasks, deps, { engine });
      expect(s.engine).toBe(engine === 'auto' ? 'rudag' : 'builtin');
      expect(s.order).toHaveLength(5);
      expect(respectsDependencies(s.order)).toBe(true);
      expect(s.waves).toEqual([['design', 'api'], ['impl', 'docs'], ['review']]);
      expect(s.earliestStart).toEqual({ design: 0, api: 0, impl: 5, docs: 3, review: 7 });
      expect(s.criticalPath).toEqual({ tasks: ['design', 'impl', 'review'], cost: 8 });
      expect(s.totalCost).toBe(12);
      expect(s.parallelism).toBeCloseTo(1.5, 10);
    });

    it(`${engine}: rejects a dependency cycle and names it`, async () => {
      await expect(
        scheduleTaskGraph(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }], { engine }),
      ).rejects.toThrow(/dependency cycle: (a -> b -> c -> a|b -> c -> a -> b|c -> a -> b -> c)/);
    });
  }

  it('rudag and builtin agree on a larger random DAG', async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const n = 300;
    const big = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, cost: Math.round(rnd() * 20) + 1 }));
    const bigDeps: Array<{ from: string; to: string }> = [];
    for (let i = 1; i < n; i++) for (let k = 0; k < 3; k++) bigDeps.push({ from: `t${Math.floor(rnd() * i)}`, to: `t${i}` });
    const a = await scheduleTaskGraph(big, bigDeps);
    const b = await scheduleTaskGraph(big, bigDeps, { engine: 'builtin' });
    expect(a.engine).toBe('rudag');
    expect(a.criticalPath.cost).toBe(b.criticalPath.cost);
    expect(a.earliestStart).toEqual(b.earliestStart);
    expect(a.waves).toEqual(b.waves);
  });

  it('handles empty input, isolated tasks, duplicates and default cost', async () => {
    expect(await scheduleTaskGraph([], [])).toMatchObject({ order: [], waves: [], criticalPath: { tasks: [], cost: 0 }, totalCost: 0 });
    const s = await scheduleTaskGraph(['x', 'y'], [{ from: 'x', to: 'z' }, { from: 'x', to: 'z' }]);
    expect(s.waves).toEqual([['x', 'y'], ['z']]);
    expect(s.criticalPath).toEqual({ tasks: ['x', 'z'], cost: 2 });
    await expect(scheduleTaskGraph([{ id: 'bad', cost: -1 }], [])).rejects.toThrow(/invalid cost/);
  });
});

describe('swarm_schedule_tasks MCP tool', () => {
  const tool = ECOSYSTEM_TOOLS.find((t) => t.name === 'swarm_schedule_tasks')!;

  it('is admitted under the readonly profile', () => {
    const names: string[] = [];
    const server = installMcpPolicy({ addTool: (t: { name: string }) => names.push(t.name) }, { profile: 'readonly' });
    server.addTool(tool);
    expect(names).toEqual(['swarm_schedule_tasks']);
  });

  it('answers with the rudag engine', async () => {
    const out = JSON.parse(await tool.execute({ tasks, dependencies: deps }));
    expect(out).toMatchObject({ engine: 'rudag', criticalPath: { tasks: ['design', 'impl', 'review'], cost: 8 } });
  });

  it('validates input', async () => {
    await expect(tool.execute({ tasks: [{ id: 'a', cost: -2 }], dependencies: [] })).rejects.toThrow();
  });
});
