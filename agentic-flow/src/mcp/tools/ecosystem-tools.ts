/**
 * Ecosystem MCP tools: in-process access to the optional ruvnet packages
 * agentic-flow integrates (aidefence, @ruvector/mincut-wasm,
 * sublinear-time-solver, agent-booster, @ruvector/router,
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
import { solveLinearSystem, pageRank, type MatrixInput } from '../../integrations/sublinear.js';
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
  { pkg: 'sublinear-time-solver', probe: 'sublinear-time-solver', powers: 'linear solves and PageRank (sublinear_solve, sublinear_pagerank)' },
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
});
const pagerankParams = z.object({
  edges: z.array(z.object({
    from: z.string().min(1).max(200),
    to: z.string().min(1).max(200),
    weight: z.number().nonnegative().finite().optional(),
  })).max(500000),
  nodes: z.array(z.string().min(1).max(200)).max(100000).optional().describe('Extra nodes with no edges'),
  damping: z.number().gt(0).lt(1).optional(),
  top: z.number().int().positive().max(10000).optional().describe('Return only the top N (default all)'),
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
    name: 'sublinear_solve',
    description: 'Solve Mx = b for a (diagonally dominant) matrix. Uses sublinear-time-solver forward-push, verifies the residual, and falls back to Gauss-Seidel. Returns solution, residual and engine.',
    parameters: solveParams,
    execute: async (raw) => {
      const a = solveParams.parse(raw);
      return json(await solveLinearSystem(a.matrix as MatrixInput, a.vector, { tolerance: a.tolerance, maxIterations: a.maxIterations }));
    },
  },
  {
    name: 'sublinear_pagerank',
    description: 'PageRank over a directed graph (agents, files, tasks) via a verified sublinear-time-solver linear solve, Gauss-Seidel fallback. Returns normalised scores and a ranking.',
    parameters: pagerankParams,
    execute: async (raw) => {
      const a = pagerankParams.parse(raw);
      const r = await pageRank(a.edges as TaskDependency[], { damping: a.damping, nodes: a.nodes });
      return json({ ...r, ranking: a.top ? r.ranking.slice(0, a.top) : r.ranking });
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
