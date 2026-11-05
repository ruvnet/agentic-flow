/**
 * Split a task-dependency graph into two groups with the least coupling.
 *
 * A global minimum cut over the (undirected, weighted) dependency graph finds
 * the split that severs the fewest/lightest dependencies — the natural seam for
 * handing work to two agent teams so they block on each other least.
 *
 * Engine: `@ruvector/mincut-wasm` (optionalDependency) when installed; a
 * built-in Stoer-Wagner implementation otherwise (O(n^3), capped at
 * BUILTIN_MAX_TASKS). Both are exact, so they agree on the cut weight.
 *
 * A global min cut can be lopsided (one loosely-attached task vs the rest):
 * that is the correct answer to "where is the weakest seam", not a balance
 * guarantee. Tasks with no dependencies have nothing to cut and are reported
 * in `isolated` rather than forced into a side.
 */

import { importOptional } from './optional.js';

export interface TaskDependency {
  from: string;
  to: string;
  /** Coupling strength, default 1. Must be finite and >= 0. */
  weight?: number;
}

export interface TaskPartition {
  groups: [string[], string[]];
  /** Tasks that have no dependencies at all. */
  isolated: string[];
  /** Sum of weights of the dependencies crossing between the groups. */
  cutWeight: number;
  cutEdges: Array<{ from: string; to: string; weight: number }>;
  engine: 'mincut-wasm' | 'builtin';
}

export const BUILTIN_MAX_TASKS = 400;

interface MinCutModule {
  WasmMinCut: {
    fromEdges(edges: Array<[number, number, number]>): {
      minCutValue(): number;
      partition(): { s: number[]; t: number[] };
      cutEdges(): Array<{ u: number; v: number; weight: number }>;
      free?(): void;
    };
  };
}

function normalize(tasks: string[], deps: TaskDependency[]) {
  const ids = new Map<string, number>();
  const names: string[] = [];
  const add = (t: string) => {
    if (!ids.has(t)) {
      ids.set(t, names.length);
      names.push(t);
    }
    return ids.get(t)!;
  };
  for (const t of tasks) add(String(t));
  const weights = new Map<string, number>();
  for (const d of deps) {
    const w = d.weight ?? 1;
    if (!Number.isFinite(w) || w < 0) throw new Error(`invalid dependency weight ${w} (${d.from} -> ${d.to})`);
    const a = add(String(d.from));
    const b = add(String(d.to));
    if (a === b || w === 0) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    weights.set(key, (weights.get(key) ?? 0) + w);
  }
  const edges: Array<[number, number, number]> = [];
  for (const [key, w] of weights) {
    const [a, b] = key.split(',').map(Number);
    edges.push([a, b, w]);
  }
  return { names, edges };
}

/** Exact global min cut (Stoer-Wagner) over vertices that appear in `edges`. */
function stoerWagner(n: number, edges: Array<[number, number, number]>): { cut: number; side: Set<number> } {
  const W: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const [a, b, w] of edges) {
    W[a][b] += w;
    W[b][a] += w;
  }
  const members: number[][] = Array.from({ length: n }, (_, i) => [i]);
  let active = Array.from({ length: n }, (_, i) => i);
  let best = Infinity;
  let bestSide: number[] = [];
  while (active.length > 1) {
    const added = new Set<number>();
    const conn = new Map<number, number>(active.map((v) => [v, 0]));
    let prev = -1;
    let last = -1;
    for (let step = 0; step < active.length; step++) {
      let pick = -1;
      for (const v of active) {
        if (!added.has(v) && (pick === -1 || conn.get(v)! > conn.get(pick)!)) pick = v;
      }
      added.add(pick);
      prev = last;
      last = pick;
      if (step === active.length - 1) {
        const cutOfPhase = conn.get(pick)!;
        if (cutOfPhase < best) {
          best = cutOfPhase;
          bestSide = [...members[pick]];
        }
      }
      for (const v of active) if (!added.has(v)) conn.set(v, conn.get(v)! + W[pick][v]);
    }
    // merge `last` into `prev`
    for (const v of active) {
      W[prev][v] += W[last][v];
      W[v][prev] = W[prev][v];
    }
    members[prev].push(...members[last]);
    active = active.filter((v) => v !== last);
  }
  return { cut: best === Infinity ? 0 : best, side: new Set(bestSide) };
}

function components(n: number, edges: Array<[number, number, number]>): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  return [...groups.values()];
}

export async function partitionTaskGraph(
  tasks: string[],
  dependencies: TaskDependency[],
  options: { engine?: 'auto' | 'builtin' } = {},
): Promise<TaskPartition> {
  const { names, edges } = normalize(tasks, dependencies);
  const touched = new Set<number>();
  for (const [a, b] of edges) {
    touched.add(a);
    touched.add(b);
  }
  const isolated = names.filter((_, i) => !touched.has(i));
  const toEdges = (list: Array<{ u: number; v: number; weight: number }>) =>
    list.map((e) => ({ from: names[e.u], to: names[e.v], weight: e.weight }));

  if (touched.size < 2) {
    return { groups: [names.filter((_, i) => touched.has(i)), []], isolated, cutWeight: 0, cutEdges: [], engine: 'builtin' };
  }

  if (options.engine !== 'builtin') {
    const mod = await importOptional<MinCutModule>('@ruvector/mincut-wasm');
    if (mod?.WasmMinCut) {
      const g = mod.WasmMinCut.fromEdges(edges);
      try {
        const p = g.partition();
        return {
          groups: [p.s.map((i) => names[i]), p.t.map((i) => names[i])],
          isolated,
          cutWeight: g.minCutValue(),
          cutEdges: toEdges(g.cutEdges()),
          engine: 'mincut-wasm',
        };
      } finally {
        g.free?.();
      }
    }
  }

  // Built-in: disconnected graphs cut at weight 0 between components.
  const comps = components(names.length, edges).filter((c) => c.some((v) => touched.has(v)));
  let side: Set<number>;
  let cut: number;
  if (comps.length > 1) {
    side = new Set(comps[0]);
    cut = 0;
  } else {
    if (touched.size > BUILTIN_MAX_TASKS) {
      throw new Error(
        `built-in min cut is limited to ${BUILTIN_MAX_TASKS} connected tasks; install @ruvector/mincut-wasm for larger graphs`,
      );
    }
    // Re-index the touched vertices densely for Stoer-Wagner.
    const order = [...touched];
    const local = new Map(order.map((v, i) => [v, i]));
    const r = stoerWagner(order.length, edges.map(([a, b, w]) => [local.get(a)!, local.get(b)!, w] as [number, number, number]));
    side = new Set([...r.side].map((i) => order[i]));
    cut = r.cut;
  }
  const s = [...touched].filter((v) => side.has(v));
  const t = [...touched].filter((v) => !side.has(v));
  const crossing = edges
    .filter(([a, b]) => side.has(a) !== side.has(b))
    .map(([u, v, weight]) => ({ u, v, weight }));
  return {
    groups: [s.map((i) => names[i]), t.map((i) => names[i])],
    isolated,
    cutWeight: cut,
    cutEdges: toEdges(crossing),
    engine: 'builtin',
  };
}
