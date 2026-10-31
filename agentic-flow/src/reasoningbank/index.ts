/**
 * ReasoningBank - Closed-loop memory system for AI agents
 * Based on arXiv:2509.25140 (Google DeepMind)
 *
 * @since v1.7.0 - Integrated AgentDB for optimal performance
 */

// Apply AgentDB runtime patch before any AgentDB imports
import '../utils/agentdb-runtime-patch.js';

// New hybrid backend (recommended for new code)
export { HybridReasoningBank } from './HybridBackend.js';
export { HybridReasoningBank as ReasoningBank } from './HybridBackend.js';  // Alias for backwards compat
export { AdvancedMemorySystem } from './AdvancedMemory.js';
export type { PatternData, RetrievalOptions, CausalInsight } from './HybridBackend.js';
export type { FailureAnalysis, SkillComposition } from './AdvancedMemory.js';

// Re-export AgentDB controllers for advanced usage
export {
  ReflexionMemory,
  SkillLibrary,
  CausalMemoryGraph,
  CausalRecall,
  NightlyLearner,
  EmbeddingService
} from 'agentdb';

// Original ReasoningBank implementations (backwards compatibility)
export { retrieveMemories, formatMemoriesForPrompt } from './core/retrieve.js';
export type { RetrievedMemory } from './core/retrieve.js';

export { judgeTrajectory } from './core/judge.js';
export type { Verdict } from './core/judge.js';

export { distillMemories } from './core/distill.js';
export type { DistilledMemory } from './core/distill.js';

export { consolidate, shouldConsolidate } from './core/consolidate.js';
export type { ConsolidationResult } from './core/consolidate.js';

export { mattsParallel, mattsSequential } from './core/matts.js';
export type { MattsResult } from './core/matts.js';

export {
  computeEmbedding,
  clearEmbeddingCache,
  isSemanticEmbedding,
  getEmbeddingKind,
  resetEmbeddingBackend,
} from './utils/embeddings.js';
export type { EmbeddingKind } from './utils/embeddings.js';
export { mmrSelection, cosineSimilarity } from './utils/mmr.js';
export { scrubPII, containsPII, scrubMemory } from './utils/pii-scrubber.js';
export { loadConfig } from './utils/config.js';

// Re-export database utilities
import * as db from './db/queries.js';
export { db };
export type {
  ReasoningMemory,
  PatternEmbedding,
  PatternLink,
  TaskTrajectory,
  MattsRun,
  ConsolidationRun,
  Trajectory,
  TrajectoryStep
} from './db/schema.js';

// Original functions (backwards compatibility)
import { loadConfig } from './utils/config.js';
import { retrieveMemories } from './core/retrieve.js';
import { judgeTrajectory } from './core/judge.js';
import { distillMemories } from './core/distill.js';
import { shouldConsolidate as shouldCons, consolidate as cons } from './core/consolidate.js';

export async function initialize(): Promise<void> {
  const config = loadConfig();
  console.error('[ReasoningBank] Initializing...');
  console.error('[ReasoningBank] Enabled: true (initializing...)');
  console.error(`[ReasoningBank] Database: ${process.env.CLAUDE_FLOW_DB_PATH || '.swarm/memory.db'}`);
  console.error(`[ReasoningBank] Embeddings: ${config.embeddings.provider}`);
  console.error(`[ReasoningBank] Retrieval k: ${config.retrieve.k}`);

  try {
    await db.runMigrations();
    console.error(`[ReasoningBank] Database migrated successfully`);
  } catch (error) {
    console.error('[ReasoningBank] Migration error:', error);
    throw new Error('ReasoningBank initialization failed: could not run migrations');
  }

  try {
    const dbConn = db.getDb();
    const tables = dbConn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pattern%'").all();
    console.error(`[ReasoningBank] Database OK: ${tables.length} tables found`);
  } catch (error) {
    console.error('[ReasoningBank] Database error:', error);
    throw new Error('ReasoningBank initialization failed: database not accessible');
  }

  console.error('[ReasoningBank] Initialization complete');
}

export async function runTask(options: {
  taskId: string;
  agentId: string;
  query: string;
  domain?: string;
  executeFn: (memories: any[]) => Promise<any>;
}): Promise<{
  verdict: any;
  usedMemories: any[];
  newMemories: string[];
  consolidated: boolean;
}> {
  console.error(`[ReasoningBank] Running task: ${options.taskId}`);
  const memories = await retrieveMemories(options.query, {
    domain: options.domain,
    agent: options.agentId
  });
  console.error(`[ReasoningBank] Retrieved ${memories.length} memories`);
  const trajectory = await options.executeFn(memories);
  const verdict = await judgeTrajectory(trajectory, options.query);
  console.error(`[ReasoningBank] Verdict: ${verdict.label} (${verdict.confidence})`);
  // Close the loop: the memories this task used share its outcome.
  db.applyOutcomeToMemories(
    memories.map(m => m.id),
    verdict.label === 'Success',
    verdict.confidence
  );
  const newMemories = await distillMemories(trajectory, verdict, options.query, {
    taskId: options.taskId,
    agentId: options.agentId,
    domain: options.domain
  });
  console.error(`[ReasoningBank] Distilled ${newMemories.length} new memories`);
  let consolidated = false;
  if (shouldCons()) {
    console.error('[ReasoningBank] Running consolidation...');
    await cons();
    consolidated = true;
  }
  return { verdict, usedMemories: memories, newMemories, consolidated };
}

export const VERSION = '1.7.1';
export const PAPER_URL = 'https://arxiv.org/html/2509.25140v1';
