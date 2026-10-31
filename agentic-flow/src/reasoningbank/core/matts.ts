/**
 * MaTTS: Memory-aware Test-Time Scaling
 * Algorithm 5 from ReasoningBank paper
 *
 * Two modes:
 * - Parallel: k independent rollouts with self-contrast aggregation
 * - Sequential: r iterative refinements with check-and-correct
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ulid } from 'ulid';
import { loadConfig } from '../utils/config.js';
import { retrieveMemories } from './retrieve.js';
import { judgeTrajectory } from './judge.js';
import { distillMemories } from './distill.js';
import { ModelRouter } from '../../router/router.js';
import * as db from '../db/queries.js';
import type { Trajectory } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize ModelRouter once
let routerInstance: ModelRouter | null = null;
function getRouter(): ModelRouter {
  if (!routerInstance) {
    routerInstance = new ModelRouter();
  }
  return routerInstance;
}

export interface MattsResult {
  runId: string;
  mode: 'parallel' | 'sequential';
  k: number;
  trajectories: Array<{
    id: string;
    verdict: { label: string; confidence: number };
    trajectory: Trajectory;
  }>;
  aggregatedMemories: string[];
  successRate: number;
  duration: number;
}

/**
 * Run MaTTS in parallel mode
 * Execute k independent rollouts and aggregate via self-contrast
 */
export async function mattsParallel(
  taskFn: () => Promise<Trajectory>,
  query: string,
  options: { k?: number; taskId?: string; agentId?: string; domain?: string } = {}
): Promise<MattsResult> {
  const config = loadConfig();
  const k = options.k || config.matts.parallel_k;
  const runId = ulid();
  const startTime = Date.now();

  console.error(`[INFO] Starting MaTTS parallel mode with k=${k}`);

  // Store MaTTS run
  db.storeMattsRun({
    run_id: runId,
    task_id: options.taskId || 'matts-' + runId,
    mode: 'parallel',
    k,
    status: 'running',
    summary: undefined
  });

  const trajectories: MattsResult['trajectories'] = [];

  // Execute k independent rollouts
  for (let i = 0; i < k; i++) {
    console.error(`[INFO] MaTTS parallel rollout ${i + 1}/${k}`);

    try {
      const trajectory = await taskFn();
      const verdict = await judgeTrajectory(trajectory, query);

      trajectories.push({
        id: ulid(),
        verdict,
        trajectory
      });

      // Store trajectory
      db.storeTrajectory({
        task_id: options.taskId || 'matts-' + runId,
        agent_id: options.agentId || 'matts-agent',
        query,
        trajectory_json: JSON.stringify(trajectory),
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        judge_label: verdict.label,
        judge_conf: verdict.confidence,
        judge_reasons: JSON.stringify(verdict.reasons),
        matts_run_id: runId
      });
    } catch (error) {
      console.error(`[ERROR] MaTTS rollout ${i + 1} failed:`, error);
    }
  }

  // Aggregate memories via self-contrast
  const aggregatedMemories = await aggregateMemories(trajectories, query, options);

  const successRate = trajectories.filter(t => t.verdict.label === 'Success').length / trajectories.length;
  const duration = Date.now() - startTime;

  console.error(`[INFO] MaTTS parallel complete: ${trajectories.length} trajectories, ${successRate * 100}% success in ${duration}ms`);

  db.logMetric('rb.matts.parallel.duration_ms', duration);
  db.logMetric('rb.matts.parallel.success_rate', successRate);
  db.logMetric('rb.matts.parallel.memories', aggregatedMemories.length);

  return {
    runId,
    mode: 'parallel',
    k,
    trajectories,
    aggregatedMemories,
    successRate,
    duration
  };
}

/**
 * Run MaTTS in sequential mode
 * Iterative refinement with check-and-correct
 */
export async function mattsSequential(
  taskFn: (memories: any[]) => Promise<Trajectory>,
  query: string,
  options: { r?: number; taskId?: string; agentId?: string; domain?: string } = {}
): Promise<MattsResult> {
  const config = loadConfig();
  const r = options.r || config.matts.sequential_r || config.matts.sequential_k;
  const runId = ulid();
  const startTime = Date.now();

  console.error(`[INFO] Starting MaTTS sequential mode with r=${r}`);

  db.storeMattsRun({
    run_id: runId,
    task_id: options.taskId || 'matts-seq-' + runId,
    mode: 'sequential',
    k: r,
    status: 'running',
    summary: undefined
  });

  const trajectories: MattsResult['trajectories'] = [];
  let previousMemories: any[] = [];

  // Iterative refinement
  for (let i = 0; i < r; i++) {
    console.error(`[INFO] MaTTS sequential iteration ${i + 1}/${r}`);

    try {
      // Retrieve relevant memories (including from previous iterations)
      const memories = await retrieveMemories(query, {
        domain: options.domain
      });

      // Execute with memories
      const trajectory = await taskFn([...memories, ...previousMemories]);
      const verdict = await judgeTrajectory(trajectory, query);

      trajectories.push({
        id: ulid(),
        verdict,
        trajectory
      });

      // If success and stop_on_success is true, break early
      if (verdict.label === 'Success' && (config.matts.sequential_stop_on_success ?? true)) {
        console.error(`[INFO] Success achieved at iteration ${i + 1}, stopping early`);
        break;
      }

      // Distill memories from this iteration
      const newMemories = await distillMemories(trajectory, verdict, query, options);
      previousMemories = [...previousMemories, ...newMemories];

      // Store trajectory
      db.storeTrajectory({
        task_id: options.taskId || 'matts-seq-' + runId,
        agent_id: options.agentId || 'matts-agent',
        query,
        trajectory_json: JSON.stringify(trajectory),
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        judge_label: verdict.label,
        judge_conf: verdict.confidence,
        judge_reasons: JSON.stringify(verdict.reasons),
        matts_run_id: runId
      });
    } catch (error) {
      console.error(`[ERROR] MaTTS iteration ${i + 1} failed:`, error);
    }
  }

  const successRate = trajectories.filter(t => t.verdict.label === 'Success').length / trajectories.length;
  const duration = Date.now() - startTime;

  console.error(`[INFO] MaTTS sequential complete: ${trajectories.length} iterations, ${successRate * 100}% success in ${duration}ms`);

  db.logMetric('rb.matts.sequential.duration_ms', duration);
  db.logMetric('rb.matts.sequential.success_rate', successRate);

  return {
    runId,
    mode: 'sequential',
    k: r,
    trajectories,
    aggregatedMemories: previousMemories,
    successRate,
    duration
  };
}

/**
 * Aggregate memories from multiple trajectories using self-contrast
 */
async function aggregateMemories(
  trajectories: MattsResult['trajectories'],
  query: string,
  options: any
): Promise<string[]> {
  console.error('[INFO] Aggregating memories via self-contrast');

  // Load aggregation prompt
  const promptPath = join(__dirname, '../prompts', 'matts-aggregate.json');
  const promptTemplate = JSON.parse(readFileSync(promptPath, 'utf-8'));

  // Format trajectories for comparison
  const trajectoryTexts = trajectories.map((t, i) => ({
    id: t.id,
    label: t.verdict.label,
    confidence: t.verdict.confidence,
    steps: JSON.stringify(t.trajectory.steps || [], null, 2)
  }));

  // Check if we have any API key configured
  const hasApiKey = process.env.OPENROUTER_API_KEY ||
                    process.env.ANTHROPIC_API_KEY ||
                    process.env.GOOGLE_GEMINI_API_KEY;

  if (!hasApiKey) {
    console.warn('[WARN] No API key set, skipping aggregation');
    return [];
  }

  try {
    const prompt = promptTemplate.template
      .replace('{{k}}', String(trajectories.length))
      .replace('{{task_query}}', query)
      .replace('{{trajectories}}', JSON.stringify(trajectoryTexts, null, 2));

    // Use ModelRouter for multi-provider support
    const router = getRouter();
    const response = await router.chat({
      model: promptTemplate.model,
      messages: [
        { role: 'system', content: promptTemplate.system },
        { role: 'user', content: prompt }
      ],
      temperature: promptTemplate.temperature,
      maxTokens: promptTemplate.max_tokens
    }, 'reasoningbank-matts-aggregate');

    // Extract content from router response
    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse and store aggregated memories
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const memories = parsed.memories || [];

      // Store with boosted confidence
      const memoryIds: string[] = [];
      for (const mem of memories) {
        const verdict = { label: 'Success' as const, confidence: 0.9, reasons: [] };
        const ids = await distillMemories(
          { steps: [] },
          verdict,
          query,
          options
        );
        memoryIds.push(...ids);
      }

      return memoryIds;
    }
  } catch (error) {
    console.error('[ERROR] Memory aggregation failed:', error);
  }

  return [];
}
