/**
 * Schedule a task-dependency graph: what can run now, what runs in parallel,
 * and which chain of tasks bounds the total time.
 *
 * Input is a DAG where `{ from, to }` means `from` must finish before `to`
 * starts, and each task has a cost (estimated duration, tokens, dollars — any
 * additive unit). Output:
 *   - `order`: a dependency-respecting execution order;
 *   - `waves`: tasks grouped by dependency depth (input order within a wave), so
 *     every task in a wave can be handed to a separate agent at the same time;
 *   - `criticalPath`: the most expensive dependency chain. Its cost is the
 *     makespan with unlimited agents, and speeding up anything off this path
 *     does not shorten the run.
 *
 * Engine: `@ruvector/rudag` (optionalDependency, Rust/WASM topological sort and
 * critical path) when installed; a built-in Kahn sort + longest-path DP
 * otherwise. Both reject cycles and agree on the critical-path cost.
 *
 * Complements `partitionTaskGraph` (task-partition.ts): partition answers
 * "where to split work between two teams", scheduling answers "in what order,
 * how parallel, and what is the bottleneck".
 */

import { importOptional } from './optional.js';

export interface ScheduleTask {
  id: string;
  /** Additive cost of the task (time, tokens, ...). Default 1. Finite, >= 0. */
  cost?: number;
}

export interface ScheduleDependency {
  /** Must finish before `to` starts. */
  from: string;
  to: string;
}

export interface TaskSchedule {
  order: string[];
  waves: string[][];
  criticalPath: { tasks: string[]; cost: number };
  /** Earliest start per task with unlimited parallel agents. */
  earliestStart: Record<string, number>;
  /** Sum of all task costs (the makespan with one agent). */
  totalCost: number;
  /** totalCost / criticalPath.cost: the speed-up ceiling from parallel agents. */
  parallelism: number;
  engine: 'rudag' | 'builtin';
}

/** rudag's WASM DAG takes integer operator codes; 255 is its user-defined slot. */
const RUDAG_CUSTOM_OPERATOR = 255;

interface RuDagInstance {
  init(): Promise<RuDagInstance>;
  addNode(operator: number, cost: number): number;
  addEdge(from: number, to: number): boolean;
  topoSort(): number[];
  criticalPath(): { path: number[]; cost: number };
  dispose(): void;
}
interface RuDagModule {
  RuDag: new (options: { storage: null; autoSave: false }) => RuDagInstance;
}

function normalize(tasks: Array<string | ScheduleTask>, deps: ScheduleDependency[]) {
  const index = new Map<string, number>();
  const names: string[] = [];
  const costs: number[] = [];
  const add = (id: string, cost?: number) => {
    const key = String(id);
    let i = index.get(key);
    if (i === undefined) {
      i = names.length;
      index.set(key, i);
      names.push(key);
      costs.push(1);
    }
    if (cost !== undefined) {
      if (!Number.isFinite(cost) || cost < 0) throw new Error(`invalid cost ${cost} for task ${key}`);
      costs[i] = cost;
    }
    return i;
  };
  for (const t of tasks) {
    if (typeof t === 'string') add(t);
    else add(t.id, t.cost);
  }
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const d of deps) {
    const a = add(d.from);
    const b = add(d.to);
    if (a === b) throw new Error(`dependency cycle: ${names[a]} -> ${names[a]}`);
    const key = `${a},${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return { names, costs, edges };
}

/** Find one cycle among `remaining` vertices (all of which lie on or lead into a cycle). */
function findCycle(n: number, edges: Array<[number, number]>, remaining: Set<number>): number[] {
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) if (remaining.has(a) && remaining.has(b)) out[a].push(b);
  const state = new Map<number, 1 | 2>();
  const stack: number[] = [];
  const visit = (v: number): number[] | null => {
    state.set(v, 1);
    stack.push(v);
    for (const w of out[v]) {
      if (state.get(w) === 1) return [...stack.slice(stack.indexOf(w)), w];
      if (!state.has(w)) {
        const c = visit(w);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(v, 2);
    return null;
  };
  for (const v of remaining) {
    if (!state.has(v)) {
      const c = visit(v);
      if (c) return c;
    }
  }
  return [];
}

function builtinOrder(n: number, edges: Array<[number, number]>): number[] {
  const indeg = new Array(n).fill(0);
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    out[a].push(b);
    indeg[b]++;
  }
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  const order: number[] = [];
  for (let h = 0; h < queue.length; h++) {
    const v = queue[h];
    order.push(v);
    for (const w of out[v]) if (--indeg[w] === 0) queue.push(w);
  }
  return order;
}

/** Longest (most expensive) path over a topological order; path cost counts node costs. */
function longestPath(order: number[], costs: number[], edges: Array<[number, number]>) {
  const preds: number[][] = costs.map(() => []);
  for (const [a, b] of edges) preds[b].push(a);
  const finish = new Array(costs.length).fill(0);
  const via = new Array(costs.length).fill(-1);
  for (const v of order) {
    let best = 0;
    let bestU = -1;
    for (const u of preds[v]) {
      if (bestU === -1 || finish[u] > best) {
        best = finish[u];
        bestU = u;
      }
    }
    via[v] = bestU;
    finish[v] = best + costs[v];
  }
  let end = -1;
  for (const v of order) if (end === -1 || finish[v] > finish[end]) end = v;
  const path: number[] = [];
  for (let v = end; v !== -1; v = via[v]) path.unshift(v);
  return { path, cost: end === -1 ? 0 : finish[end] };
}

export async function scheduleTaskGraph(
  tasks: Array<string | ScheduleTask>,
  dependencies: ScheduleDependency[],
  options: { engine?: 'auto' | 'builtin' } = {},
): Promise<TaskSchedule> {
  const { names, costs, edges } = normalize(tasks, dependencies);
  const n = names.length;
  let order: number[] | null = null;
  let critical: { path: number[]; cost: number } | null = null;
  let engine: TaskSchedule['engine'] = 'builtin';

  if (n > 0 && options.engine !== 'builtin') {
    const mod = await importOptional<RuDagModule>('@ruvector/rudag');
    if (mod?.RuDag) {
      // storage: null keeps rudag off IndexedDB/the filesystem; one instance per call.
      const dag = await new mod.RuDag({ storage: null, autoSave: false }).init();
      try {
        const ids = costs.map((c) => dag.addNode(RUDAG_CUSTOM_OPERATOR, c));
        let acyclic = true;
        for (const [a, b] of edges) {
          // rudag refuses an edge that would close a cycle.
          if (!dag.addEdge(ids[a], ids[b])) {
            acyclic = false;
            break;
          }
        }
        if (acyclic) {
          const back = new Map(ids.map((id, i) => [id, i]));
          order = dag.topoSort().map((id) => back.get(id)!);
          const cp = dag.criticalPath();
          critical = { path: cp.path.map((id) => back.get(id)!), cost: cp.cost };
          engine = 'rudag';
        }
      } finally {
        dag.dispose();
      }
    }
  }

  if (!order) {
    order = builtinOrder(n, edges);
    if (order.length < n) {
      const placed = new Set(order);
      const remaining = new Set(names.map((_, i) => i).filter((i) => !placed.has(i)));
      const cycle = findCycle(n, edges, remaining);
      throw new Error(`dependency cycle: ${cycle.map((i) => names[i]).join(' -> ')}`);
    }
    critical = longestPath(order, costs, edges);
    engine = 'builtin';
  }

  // Earliest start and waves: the same for either engine, given a valid order.
  const preds: number[][] = names.map(() => []);
  for (const [a, b] of edges) preds[b].push(a);
  const start = new Array(n).fill(0);
  const level = new Array(n).fill(0);
  for (const v of order) {
    for (const u of preds[v]) {
      start[v] = Math.max(start[v], start[u] + costs[u]);
      level[v] = Math.max(level[v], level[u] + 1);
    }
  }
  // Within a wave, tasks keep their input order, so both engines return identical waves.
  const waves: string[][] = [];
  for (let v = 0; v < n; v++) (waves[level[v]] ??= []).push(names[v]);

  const totalCost = costs.reduce((s, c) => s + c, 0);
  const cpCost = critical!.cost;
  return {
    order: order.map((i) => names[i]),
    waves,
    criticalPath: { tasks: critical!.path.map((i) => names[i]), cost: cpCost },
    earliestStart: Object.fromEntries(order.map((i) => [names[i], start[i]])),
    totalCost,
    parallelism: cpCost > 0 ? totalCost / cpCost : n > 0 ? n : 0,
    engine,
  };
}
