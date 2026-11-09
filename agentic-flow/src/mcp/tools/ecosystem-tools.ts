/**
 * Ecosystem MCP tools: in-process access to the optional ruvnet packages
 * agentic-flow integrates (aidefence, @ruvector/mincut-wasm, @ruvector/rudag,
 * @ruvnet/sublinear-core, agent-booster, @ruvector/router,
 * ruvector-onnx-embeddings-wasm).
 *
 * Every tool works without its optional package (built-in fallback) and says
 * which engine answered. All are pure computations with no side effects, so
 * the MCP policy admits them under the default `readonly` profile.
 */

import { z } from 'zod';
import { isOptionalInstalled } from '../../integrations/optional.js';
import { scanPromptInjection, promptInjectionEngine, getInjectionPolicy } from '../../integrations/prompt-injection.js';
import { partitionTaskGraph, type TaskDependency } from '../../integrations/task-partition.js';
import { scheduleTaskGraph, type ScheduleTask, type ScheduleDependency } from '../../integrations/task-schedule.js';
import { solveLinearSystem, pageRank, type MatrixInput, type PageRankEdge } from '../../integrations/sublinear.js';
import { onnxWasmModelCached, onnxWasmDownloadAllowed } from '../../integrations/onnx-wasm-embedder.js';

export interface EcosystemTool {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown) => Promise<string>;
}

/** Optional packages and what they power. `probe` is checked without loading it. */
export const ECOSYSTEM_PACKAGES = [
  { pkg: 'aidefence', probe: 'aidefence/dist/detection', powers: 'prompt-injection screening (InputValidator, prompt_injection_scan)' },
  { pkg: 'agent-booster', probe: 'agent-booster', powers: 'in-process code edits (agent_booster_* tools)' },
  { pkg: '@ruvector/router', probe: '@ruvector/router', powers: 'native HNSW index for SemanticRouter' },
  { pkg: '@ruvector/mincut-wasm', probe: '@ruvector/mincut-wasm', powers: 'task-graph partitioning (swarm_partition_tasks)' },
  { pkg: '@ruvector/rudag', probe: '@ruvector/rudag', powers: 'task-graph scheduling: execution waves and critical path (swarm_schedule_tasks)' },
  { pkg: '@ruvnet/sublinear-core', probe: '@ruvnet/sublinear-core', powers: 'linear solves, PageRank and personalized PageRank (sublinear_solve, sublinear_pagerank)' },
  { pkg: 'ruvector-onnx-embeddings-wasm', probe: 'ruvector-onnx-embeddings-wasm', powers: 'all-MiniLM-L6-v2 embeddings (AgentDBFast, EmbeddingService onnx-wasm)' },
] as const;

// The project compiles with strict: false, so zod infers object fields as
// optional; the schemas themselves require them, hence the casts below.
const json = (v: unknown) => JSON.stringify(v, null, 2);

const statusParams = z.object({}).strict();
const partitionParams = z.object({
  tasks: z.array(z.string().min(1).max(200)).max(5000).describe('Task ids; tasks only named in dependencies are added'),
  dependencies: z
    .array(z.object({
      from: z.string().min(1).max(200),
      to: z.string().min(1).max(200),
      weight: z.number().nonnegative().finite().optional().describe('Coupling strength, default 1'),
    }))
    .max(50000),
});
const scheduleParams = z.object({
  tasks: z
    .array(z.union([
      z.string().min(1).max(200),
      z.object({
        id: z.string().min(1).max(200),
        cost: z.number().nonnegative().finite().optional().describe('Additive cost (minutes, tokens, dollars), default 1'),
      }),
    ]))
    .max(5000)
    .describe('Task ids or {id, cost}; tasks only named in dependencies get cost 1'),
  dependencies: z
    .array(z.object({
      from: z.string().min(1).max(200).describe('Runs first'),
      to: z.string().min(1).max(200).describe('Starts after from finishes'),
    }))
    .max(50000),
});
const solveParams = z.object({
  matrix: z
    .union([
      z.array(z.array(z.number().finite())).min(1).max(2000),
      z.object({
        size: z.number().int().positive().max(1_000_000),
        entries: z.array(z.object({ row: z.number().int(), col: z.number().int(), value: z.number().finite() })).max(5_000_000),
      }),
    ])
    .describe('Square matrix: dense rows, or {size, entries:[{row,col,value}]}; diagonally dominant for guaranteed convergence'),
  vector: z.array(z.number().finite()).min(1).describe('Right-hand side b'),
  tolerance: z.number().positive().max(1).optional(),
  maxIterations: z.number().int().positive().max(1_000_000).optional(),
  method: z
    .enum(['auto', 'gauss-seidel', 'conjugate-gradient', 'jacobi', 'neumann'])
    .optional()
    .describe('Default auto: conjugate-gradient for symmetric matrices with a positive diagonal, else gauss-seidel'),
});
const pagerankParams = z.object({
  edges: z.array(z.object({
    from: z.string().min(1).max(200),
    to: z.string().min(1).max(200),
    weight: z.number().nonnegative().finite().optional(),
  })).max(500000),
  nodes: z.array(z.string().min(1).max(200)).max(100000).optional().describe('Extra nodes with no edges'),
  damping: z.number().gt(0).lt(1).optional().describe('Probability of following an edge (1 - restart probability), default 0.85'),
  top: z.number().int().positive().max(10000).optional().describe('Return only the top N (default all)'),
  seeds: z
    .union([
      z.array(z.string().min(1).max(200)).min(1).max(100000),
      z.record(z.string().min(1).max(200), z.number().nonnegative().finite()),
    ])
    .optional()
    .describe('Personalized PageRank: restart at these nodes (equal weight), or {node: weight}'),
  approximate: z
    .boolean()
    .optional()
    .describe('With seeds: local forward push. Work depends on epsilon, not graph size; best with top on large graphs. Returns residualMass (L1 error bound)'),
  epsilon: z.number().positive().max(0.1).optional().describe('Forward-push residual threshold, default 1e-6 (smaller = more accurate)'),
});
const scanParams = z.object({
  text: z.string().max(100000),
  policy: z.enum(['block', 'strict', 'warn']).optional().describe('Override AGENTIC_FLOW_PROMPT_INJECTION for this scan'),
});

export const ECOSYSTEM_TOOLS: EcosystemTool[] = [
  {
    name: 'ecosystem_status',
    description: 'List the optional ruvnet packages agentic-flow integrates, whether each is installed, and what it powers. Every integration has a built-in fallback.',
    parameters: statusParams,
    execute: async (raw) => {
      statusParams.parse(raw ?? {});
      return json({
        packages: ECOSYSTEM_PACKAGES.map(({ pkg, probe, powers }) => ({ package: pkg, installed: isOptionalInstalled(probe), powers })),
        promptInjection: { engine: promptInjectionEngine(), policy: getInjectionPolicy() },
        embeddings: { modelCached: onnxWasmModelCached(), downloadAllowed: onnxWasmDownloadAllowed() },
        install: 'npm install agentic-flow (optional packages install by default; --omit=optional skips them)',
      });
    },
  },
  {
    name: 'swarm_partition_tasks',
    description: 'Split a task-dependency graph into two groups with the least coupling (exact global minimum cut) — the seam to hand work to two agent teams. Uses @ruvector/mincut-wasm, built-in Stoer-Wagner otherwise.',
    parameters: partitionParams,
    execute: async (raw) => {
      const a = partitionParams.parse(raw);
      return json(await partitionTaskGraph(a.tasks, a.dependencies as TaskDependency[]));
    },
  },
  {
    name: 'swarm_schedule_tasks',
    description: 'Schedule a task-dependency DAG for a swarm: execution order, parallel waves (tasks that can go to separate agents at once), earliest start per task, and the critical path (the cost-weighted chain that bounds the run). Rejects cycles. Uses @ruvector/rudag, built-in Kahn sort + longest path otherwise.',
    parameters: scheduleParams,
    execute: async (raw) => {
      const a = scheduleParams.parse(raw);
      return json(await scheduleTaskGraph(a.tasks as Array<string | ScheduleTask>, a.dependencies as ScheduleDependency[]));
    },
  },
  {
    name: 'sublinear_solve',
    description: 'Solve Mx = b for a diagonally dominant or symmetric positive definite matrix. Uses @ruvnet/sublinear-core (Gauss-Seidel / conjugate gradient), verifies the residual max|Mx-b|, and falls back to a built-in Gauss-Seidel. Returns solution, residual, iterations, method and engine.',
    parameters: solveParams,
    execute: async (raw) => {
      const a = solveParams.parse(raw);
      return json(await solveLinearSystem(a.matrix as MatrixInput, a.vector, { tolerance: a.tolerance, maxIterations: a.maxIterations, method: a.method }));
    },
  },
  {
    name: 'sublinear_pagerank',
    description: 'PageRank over a directed graph (agents, files, tasks), or personalized PageRank around seeds (what matters to these nodes). Uses @ruvnet/sublinear-core power iteration, or local forward push with approximate: true; results are verified, built-in Gauss-Seidel fallback. Returns scores, a ranking and the engine.',
    parameters: pagerankParams,
    execute: async (raw) => {
      const a = pagerankParams.parse(raw);
      return json(await pageRank(a.edges as PageRankEdge[], {
        damping: a.damping,
        nodes: a.nodes,
        seeds: a.seeds as string[] | Record<string, number> | undefined,
        approximate: a.approximate,
        epsilon: a.epsilon,
        top: a.top,
      }));
    },
  },
  {
    name: 'prompt_injection_scan',
    description: 'Scan text for prompt-injection attempts (instruction override, role switching, prompt exfiltration, jailbreaks) with aidefence, built-in patterns otherwise. Returns threats and the policy decision (allow/warn/block).',
    parameters: scanParams,
    execute: async (raw) => {
      const a = scanParams.parse(raw);
      return json(scanPromptInjection(a.text, a.policy));
    },
  },
];

export const ECOSYSTEM_TOOL_NAMES = ECOSYSTEM_TOOLS.map((t) => t.name);

export function registerEcosystemTools(server: { addTool: (tool: EcosystemTool) => void }): void {
  for (const tool of ECOSYSTEM_TOOLS) server.addTool(tool);
}
