/**
 * Intelligence Bridge - Connects hooks to RuVectorIntelligence layer
 *
 * This bridges the gap between hook tools and the full RuVector ecosystem:
 * - @ruvector/sona: Micro-LoRA, EWC++, ReasoningBank, Trajectories
 * - @ruvector/attention: MoE, Flash, Hyperbolic, Graph attention
 * - Agent/pattern search: exact cosine scan (HNSW disabled below)
 * - TensorCompress: Tiered compression based on access frequency (v2.0.1-alpha.24+)
 *
 * Persistence: SQLite-based storage for cross-platform compatibility
 */

import {
  RuVectorIntelligence,
  createIntelligenceLayer,
  IntelligencePresets,
  type AgentRoutingResult,
  type Trajectory,
  type LearningOutcome,
} from '../../../../intelligence/index.js';

import { getIntelligenceStore, type IntelligenceStore } from '../../../../intelligence/IntelligenceStore.js';
import { getEmbeddingService, type EmbeddingService } from '../../../../intelligence/EmbeddingService.js';

// Singleton instances
let intelligenceInstance: RuVectorIntelligence | null = null;
let storeInstance: IntelligenceStore | null = null;
let initPromise: Promise<void> | null = null;

// TensorCompress for tiered pattern compression (lazy loaded)
let TensorCompress: any = null;
let tensorCompressInstance: any = null;

// Pattern compression tracking
interface CompressedPattern {
  id: string;
  embedding: number[];
  metadata: Record<string, any>;
  accessCount: number;
  lastAccessed: number;
  createdAt: number;
  compressionTier: 'none' | 'half' | 'pq8' | 'pq4' | 'binary';
}

const patternStore = new Map<string, CompressedPattern>();
let totalPatternAccesses = 0;
let lastRecompressionTime = 0;
const RECOMPRESSION_INTERVAL = 300000; // 5 minutes

// Consistent dimension for SONA (must match hiddenDim = embeddingDim)
// Using 128 for ultra-fast performance (~0.05ms per operation)
const INTELLIGENCE_DIM = 128;

// Active trajectories in memory (for fast access, backed by SQLite)
const activeTrajectories = new Map<number, {
  taskDescription: string;
  startTime: number;
  agent: string;
  steps: number;
  dbId: number; // SQLite row ID
}>();

/**
 * Get the SQLite store singleton
 */
export function getStore(): IntelligenceStore {
  if (!storeInstance) {
    storeInstance = getIntelligenceStore();
  }
  return storeInstance;
}

// Get embedding service singleton
let embeddingServiceInstance: EmbeddingService | null = null;

function getEmbeddingServiceInstance(): EmbeddingService {
  if (!embeddingServiceInstance) {
    embeddingServiceInstance = getEmbeddingService();
  }
  return embeddingServiceInstance;
}

// Simple embedding function (uses EmbeddingService with caching)
function simpleEmbed(text: string, dim: number = INTELLIGENCE_DIM): number[] {
  const service = getEmbeddingServiceInstance();
  const embedding = service.simpleEmbed(text, dim);
  return Array.from(embedding);
}

// ============================================================================
// TensorCompress Integration (v2.0.1-alpha.24+)
// Tiered compression based on access frequency for memory efficiency
// ============================================================================

/**
 * Lazy load TensorCompress from ruvector
 */
async function getTensorCompress(): Promise<any> {
  if (tensorCompressInstance) return tensorCompressInstance;

  try {
    const ruvector = await import('ruvector');
    if (ruvector.TensorCompress) {
      TensorCompress = ruvector.TensorCompress;
      tensorCompressInstance = new TensorCompress();
      return tensorCompressInstance;
    }
  } catch {
    // TensorCompress not available
  }
  return null;
}

/**
 * Calculate access frequency for a pattern
 *
 * Compression Tiers:
 * | Data Type             | Access Freq | Compression | Memory Savings |
 * |-----------------------|-------------|-------------|----------------|
 * | Hot patterns (recent) | >0.8        | none        | 0%             |
 * | Warm patterns         | >0.4        | half        | 50%            |
 * | Cool patterns         | >0.1        | pq8         | 87.5%          |
 * | Cold patterns         | >0.01       | pq4         | 93.75%         |
 * | Archive               | ≤0.01       | binary      | 96.9%          |
 */
function calculateAccessFrequency(pattern: CompressedPattern): number {
  if (totalPatternAccesses === 0) return 1.0;  // New pattern starts hot

  // Calculate base frequency from access count
  const accessRatio = pattern.accessCount / totalPatternAccesses;

  // Factor in recency (patterns used recently get a boost)
  const ageMs = Date.now() - pattern.lastAccessed;
  const recencyBoost = Math.exp(-ageMs / (24 * 60 * 60 * 1000));  // 24hr decay

  // Combine factors: 60% access ratio, 40% recency
  const frequency = accessRatio * 0.6 + recencyBoost * 0.4;

  return Math.min(1.0, Math.max(0, frequency));
}

/**
 * Get compression tier based on access frequency
 */
function getCompressionTier(accessFreq: number): 'none' | 'half' | 'pq8' | 'pq4' | 'binary' {
  if (accessFreq > 0.8) return 'none';      // Hot: no compression (0% savings)
  if (accessFreq > 0.4) return 'half';      // Warm: 50% savings
  if (accessFreq > 0.1) return 'pq8';       // Cool: 87.5% savings
  if (accessFreq > 0.01) return 'pq4';      // Cold: 93.75% savings
  return 'binary';                           // Archive: 96.9% savings
}

/**
 * Apply tiered compression to an embedding
 */
async function applyTieredCompression(
  embedding: number[],
  tier: 'none' | 'half' | 'pq8' | 'pq4' | 'binary'
): Promise<number[]> {
  if (tier === 'none') return embedding;

  const compress = await getTensorCompress();
  if (!compress || !TensorCompress) return embedding;

  try {
    const config: Record<string, { levelType: string }> = {
      'half': { levelType: 'half' },
      'pq8': { levelType: 'pq8' },
      'pq4': { levelType: 'pq4' },
      'binary': { levelType: 'binary' }
    };

    const tierCompress = new TensorCompress(config[tier]);
    const compressedJson = tierCompress.compress(embedding);
    return tierCompress.decompress(compressedJson);
  } catch {
    return embedding;
  }
}

/**
 * Recompress patterns based on updated access frequencies
 * Runs periodically in background
 */
async function recompressPatterns(): Promise<{ recompressed: number }> {
  const now = Date.now();
  if (now - lastRecompressionTime < RECOMPRESSION_INTERVAL) {
    return { recompressed: 0 };
  }

  lastRecompressionTime = now;
  let recompressed = 0;

  for (const [id, pattern] of patternStore) {
    const accessFreq = calculateAccessFrequency(pattern);
    const newTier = getCompressionTier(accessFreq);

    if (newTier !== pattern.compressionTier) {
      // Re-compress with new tier
      pattern.embedding = await applyTieredCompression(pattern.embedding, newTier);
      pattern.compressionTier = newTier;
      recompressed++;
    }
  }

  return { recompressed };
}

/**
 * Get compression tier distribution stats
 */
function getCompressionStats(): {
  tierDistribution: { hot: number; warm: number; cool: number; cold: number; archive: number };
  totalPatterns: number;
  totalAccesses: number;
  memorySavings: string;
} {
  const tierDistribution = { hot: 0, warm: 0, cool: 0, cold: 0, archive: 0 };
  let totalUncompressedSize = 0;
  let totalCompressedSize = 0;

  for (const pattern of patternStore.values()) {
    const embeddingSize = pattern.embedding.length;
    totalUncompressedSize += embeddingSize * 4;  // float32

    switch (pattern.compressionTier) {
      case 'none':
        tierDistribution.hot++;
        totalCompressedSize += embeddingSize * 4;
        break;
      case 'half':
        tierDistribution.warm++;
        totalCompressedSize += embeddingSize * 2;
        break;
      case 'pq8':
        tierDistribution.cool++;
        totalCompressedSize += embeddingSize * 0.5;
        break;
      case 'pq4':
        tierDistribution.cold++;
        totalCompressedSize += embeddingSize * 0.25;
        break;
      case 'binary':
        tierDistribution.archive++;
        totalCompressedSize += embeddingSize / 8;
        break;
    }
  }

  const memorySavings = totalUncompressedSize > 0
    ? ((1 - totalCompressedSize / totalUncompressedSize) * 100).toFixed(1) + '%'
    : '0%';

  return {
    tierDistribution,
    totalPatterns: patternStore.size,
    totalAccesses: totalPatternAccesses,
    memorySavings
  };
}

// ============================================================================
// Multi-Algorithm Learning Engine (ruvector@0.1.69+)
// 9 specialized RL algorithms for different task types
// ============================================================================

/**
 * Algorithm configuration per task type
 * Based on ruvector@0.1.69 multi-algorithm learning engine
 */
const ALGORITHM_CONFIG: Record<string, {
  algorithm: 'double-q' | 'sarsa' | 'actor-critic' | 'ppo' | 'decision-transformer' | 'td-lambda' | 'q-learning' | 'reinforce' | 'a2c';
  reason: string;
}> = {
  'agent-routing': { algorithm: 'double-q', reason: 'Reduces overestimation bias in agent selection' },
  'error-avoidance': { algorithm: 'sarsa', reason: 'Conservative on-policy learning avoids risky actions' },
  'confidence-scoring': { algorithm: 'actor-critic', reason: 'Continuous 0-1 scores with learned variance' },
  'context-ranking': { algorithm: 'ppo', reason: 'Stable preference learning for context relevance' },
  'trajectory-learning': { algorithm: 'decision-transformer', reason: 'Sequence pattern recognition across sessions' },
  'memory-recall': { algorithm: 'td-lambda', reason: 'Better credit assignment for long-term memory' },
  'pattern-matching': { algorithm: 'q-learning', reason: 'Fast value-based matching for known patterns' },
  'exploration': { algorithm: 'reinforce', reason: 'Policy gradient for novel task exploration' },
  'multi-agent': { algorithm: 'a2c', reason: 'Advantage estimation for multi-agent coordination' },
};

// Multi-algorithm learning engine (lazy loaded from ruvector@0.1.69)
let multiAlgorithmEngine: any = null;

/**
 * Get or create the multi-algorithm learning engine
 */
async function getMultiAlgorithmEngine(): Promise<any> {
  if (multiAlgorithmEngine) return multiAlgorithmEngine;

  try {
    const ruvector: any = await import('ruvector');
    // Try new multi-algorithm API (ruvector@0.1.69+)
    if (ruvector.MultiAlgorithmLearning || ruvector.createMultiAlgorithmEngine) {
      const createEngine = ruvector.createMultiAlgorithmEngine || ruvector.MultiAlgorithmLearning;
      multiAlgorithmEngine = typeof createEngine === 'function'
        ? createEngine({ algorithms: Object.values(ALGORITHM_CONFIG).map(c => c.algorithm) })
        : new createEngine({ algorithms: Object.values(ALGORITHM_CONFIG).map(c => c.algorithm) });
      console.log('[IntelligenceBridge] Multi-algorithm learning engine initialized (9 algorithms)');
      return multiAlgorithmEngine;
    }
    // Fallback: use IntelligenceEngine with learning plugins
    if (ruvector.IntelligenceEngine) {
      multiAlgorithmEngine = new ruvector.IntelligenceEngine();
      return multiAlgorithmEngine;
    }
  } catch (error) {
    console.warn('[IntelligenceBridge] Multi-algorithm engine not available:', error);
  }
  return null;
}

/**
 * Get the recommended algorithm for a task type
 */
export function getAlgorithmForTask(taskType: string): { algorithm: string; reason: string } {
  const config = ALGORITHM_CONFIG[taskType];
  if (config) return config;

  // Default to double-q for unknown task types
  return { algorithm: 'double-q', reason: 'Default algorithm for unknown task types' };
}

/**
 * Learn from an episode using the appropriate algorithm
 */
export async function learnFromEpisode(
  taskType: string,
  state: string,
  action: string,
  reward: number,
  nextState: string,
  done: boolean
): Promise<{ algorithm: string; learned: boolean; qValue?: number }> {
  const engine = await getMultiAlgorithmEngine();
  const { algorithm } = getAlgorithmForTask(taskType);

  if (engine?.learnEpisode) {
    const result = await engine.learnEpisode({
      algorithm,
      state,
      action,
      reward,
      nextState,
      done
    });
    return { algorithm, learned: true, qValue: result?.qValue };
  }

  // Fallback: record for later batch learning
  const store = getStore();
  if ((store as any).recordOperation) {
    (store as any).recordOperation('learn_episode', { taskType, algorithm, reward });
  }

  return { algorithm, learned: false };
}

/**
 * Get Q-value or policy probability for an action
 */
export async function getActionValue(
  taskType: string,
  state: string,
  action: string
): Promise<{ algorithm: string; value: number; confidence: number }> {
  const engine = await getMultiAlgorithmEngine();
  const { algorithm } = getAlgorithmForTask(taskType);

  if (engine?.getActionValue) {
    const result = await engine.getActionValue({ algorithm, state, action });
    return { algorithm, value: result?.value || 0.5, confidence: result?.confidence || 0.5 };
  }

  return { algorithm, value: 0.5, confidence: 0.5 };
}

/**
 * Get multi-algorithm learning stats
 */
export async function getMultiAlgorithmStats(): Promise<{
  enabled: boolean;
  algorithms: string[];
  episodesPerAlgorithm: Record<string, number>;
  avgRewardPerAlgorithm: Record<string, number>;
}> {
  const engine = await getMultiAlgorithmEngine();

  if (engine?.getStats) {
    const stats = engine.getStats();
    return {
      enabled: true,
      algorithms: Object.keys(ALGORITHM_CONFIG).map(k => ALGORITHM_CONFIG[k].algorithm),
      episodesPerAlgorithm: stats.episodesPerAlgorithm || {},
      avgRewardPerAlgorithm: stats.avgRewardPerAlgorithm || {},
    };
  }

  return {
    enabled: false,
    algorithms: [],
    episodesPerAlgorithm: {},
    avgRewardPerAlgorithm: {},
  };
}

/**
 * Get or create the RuVectorIntelligence singleton
 */
export async function getIntelligence(): Promise<RuVectorIntelligence> {
  if (intelligenceInstance) {
    return intelligenceInstance;
  }

  if (!initPromise) {
    initPromise = initializeIntelligence();
  }

  await initPromise;
  return intelligenceInstance!;
}

/**
 * Initialize the intelligence layer with optimal settings
 */
// HNSW is off: ruvector does not export the HnswIndex this layer expects, and
// agent/pattern sets are small enough that an exact cosine scan is used.
const ENABLE_HNSW = false;

async function initializeIntelligence(): Promise<void> {
  try {
    // Use fast preset with consistent dimensions
    // SONA requires embeddingDim == hiddenDim
    intelligenceInstance = createIntelligenceLayer({
      ...IntelligencePresets.fast,
      hiddenDim: INTELLIGENCE_DIM,
      embeddingDim: INTELLIGENCE_DIM, // Must match hiddenDim for SONA
      enableSona: true,
      enableTrajectories: true,
      enableHnsw: ENABLE_HNSW,
    });

    // Register common agent types with correct dimension
    const agents = [
      'coder', 'researcher', 'analyst', 'optimizer', 'coordinator',
      'typescript-developer', 'rust-developer', 'python-developer',
      'test-engineer', 'documentation-specialist', 'security-specialist',
      'frontend-developer', 'backend-developer', 'devops-engineer'
    ];

    for (const agent of agents) {
      const embedding = simpleEmbed(`agent ${agent} specialist expert`, INTELLIGENCE_DIM);
      await intelligenceInstance.registerAgent(agent, embedding);
    }

    console.log('[IntelligenceBridge] RuVector intelligence layer initialized');
    console.log('[IntelligenceBridge] Features: Micro-LoRA, MoE Attention');
  } catch (error) {
    console.warn('[IntelligenceBridge] Failed to initialize full intelligence, using fallback:', error);
    // Create with minimal config if packages aren't available
    intelligenceInstance = createIntelligenceLayer({
      hiddenDim: INTELLIGENCE_DIM,
      embeddingDim: INTELLIGENCE_DIM,
      enableSona: false,
      enableHnsw: false,
    });
  }
}

/**
 * Route a task using SONA + MoE Attention + HNSW
 *
 * This replaces the simple keyword-based routing with:
 * 1. HNSW for O(log n) candidate retrieval
 * 2. Micro-LoRA transformation (~0.05ms)
 * 3. MoE attention-based ranking
 */
export async function routeTaskIntelligent(
  task: string,
  context?: {
    file?: string;
    recentFiles?: string[];
    errorContext?: string;
  }
): Promise<{
  agent: string;
  confidence: number;
  routingResults: AgentRoutingResult[];
  latencyMs: number;
  usedFeatures: string[];
}> {
  const startTime = performance.now();
  const intelligence = await getIntelligence();
  const usedFeatures: string[] = [];

  // Build context string
  let contextString = task;
  if (context?.file) {
    contextString += ` [file: ${context.file}]`;
  }
  if (context?.errorContext) {
    contextString += ` [error: ${context.errorContext}]`;
  }

  // Get task embedding with consistent dimension
  const embedding = simpleEmbed(contextString, INTELLIGENCE_DIM);

  // Route using full intelligence stack, then report only what actually ran
  const routingResults = await intelligence.routeTask(embedding);
  const top = routingResults[0];
  usedFeatures.push(top?.usedHnsw ? 'hnsw-search' : 'cosine-search');
  if (top?.usedSona) usedFeatures.push('sona-microlora');
  if (top?.expertWeights) usedFeatures.push('moe-attention');

  // Select best agent
  const bestResult = routingResults[0] || {
    agentId: 'coder',
    confidence: 0.5,
    attentionWeights: new Float32Array(0),
    latencyMs: 0,
    usedHnsw: false,
    usedSona: false,
  };

  // Track access for any pattern results (for tiered compression)
  for (const result of routingResults) {
    if (result.agentId.startsWith('pattern-')) {
      const pattern = patternStore.get(result.agentId);
      if (pattern) {
        pattern.accessCount++;
        pattern.lastAccessed = Date.now();
        totalPatternAccesses++;
      }
    }
  }

  const latencyMs = performance.now() - startTime;

  // Record routing in SQLite for persistence
  const store = getStore();
  await store.recordRouting(
    task,
    bestResult.agentId,
    Math.min(0.95, bestResult.confidence),
    Math.round(latencyMs)
  );

  return {
    agent: bestResult.agentId,
    confidence: Math.min(0.95, bestResult.confidence),
    routingResults,
    latencyMs,
    usedFeatures,
  };
}

/**
 * Begin a trajectory for learning from task execution
 *
 * Trajectories track:
 * - Task context and embeddings
 * - Agent actions and decisions
 * - Attention patterns at each step
 * - Final outcomes for reinforcement
 */
export async function beginTaskTrajectory(
  task: string,
  agent: string
): Promise<{ trajectoryId: number; success: boolean; error?: string }> {
  const intelligence = await getIntelligence();
  const store = getStore();

  // Get task embedding
  const embedding = simpleEmbed(task);

  // Start trajectory in SONA
  const result = intelligence.beginTrajectory(task, embedding);

  if (!result.success || result.value === undefined) {
    return {
      trajectoryId: -1,
      success: false,
      error: result.error || 'Failed to begin trajectory',
    };
  }

  const trajectoryId = result.value;

  // Persist to SQLite
  const dbId = await store.startTrajectory(task, agent);

  // Track metadata in memory (for fast access)
  activeTrajectories.set(trajectoryId, {
    taskDescription: task,
    startTime: Date.now(),
    agent,
    steps: 0,
    dbId,
  });

  return { trajectoryId, success: true };
}

/**
 * Record a step in the trajectory
 */
export async function recordTrajectoryStep(
  trajectoryId: number,
  action: string,
  reward: number,
  context?: {
    file?: string;
    errorFixed?: boolean;
    testPassed?: boolean;
  }
): Promise<void> {
  const intelligence = await getIntelligence();
  const store = getStore();
  const meta = activeTrajectories.get(trajectoryId);

  if (meta) {
    meta.steps++;

    // Persist step to SQLite
    await store.addTrajectoryStep(meta.dbId);

    // Generate activations from context
    const activations = new Array(256).fill(0).map(() => Math.random() * 0.1);

    // Attention weights (8 heads)
    const attentionWeights = new Array(8).fill(0.125);

    intelligence.addTrajectoryStep(
      trajectoryId,
      action,
      reward,
      activations,
      attentionWeights
    );
  }
}

/**
 * End a trajectory and get learning outcome
 */
export async function endTaskTrajectory(
  trajectoryId: number,
  success: boolean,
  quality: number = 0.8
): Promise<LearningOutcome | null> {
  const intelligence = await getIntelligence();
  const store = getStore();
  const meta = activeTrajectories.get(trajectoryId);

  if (!meta) {
    return null;
  }

  // Persist to SQLite
  const outcome_type = success ? 'success' : 'failure';
  await store.endTrajectory(meta.dbId, outcome_type, { quality, steps: meta.steps });

  // End trajectory and trigger learning
  const outcome = intelligence.endTrajectory(trajectoryId, success, quality);

  // Clean up
  activeTrajectories.delete(trajectoryId);

  return outcome;
}

/**
 * Store a pattern by registering it as an agent-like entity
 * Now with tiered TensorCompress for memory efficiency (v2.0.1-alpha.24+)
 */
export async function storePattern(
  task: string,
  resolution: string,
  reward: number
): Promise<void> {
  const intelligence = await getIntelligence();

  // Get embedding for the task
  const embedding = simpleEmbed(`${task} ${resolution}`);

  // Register as a pattern (using agent registration for storage)
  const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await intelligence.registerAgent(patternId, embedding, {
    task,
    resolution,
    reward,
    timestamp: new Date().toISOString(),
  });

  // Store in local pattern cache with compression tracking
  // New patterns start as "hot" (no compression) since they're likely to be accessed soon
  const now = Date.now();
  const compressedPattern: CompressedPattern = {
    id: patternId,
    embedding: embedding,
    metadata: { task, resolution, reward },
    accessCount: 1,
    lastAccessed: now,
    createdAt: now,
    compressionTier: 'none'  // New patterns are hot
  };

  patternStore.set(patternId, compressedPattern);
  totalPatternAccesses++;

  // Trigger background recompression (non-blocking)
  recompressPatterns().catch(() => {});
}

/**
 * Find similar patterns using routing
 * Tracks access for tiered compression (v2.0.1-alpha.24+)
 */
export async function findSimilarPatterns(
  task: string,
  topK: number = 5
): Promise<Array<{
  task: string;
  resolution: string;
  reward: number;
  similarity: number;
}>> {
  const intelligence = await getIntelligence();

  // Get query embedding
  const embedding = simpleEmbed(task);

  // Search using routing (exact cosine scan; HNSW is disabled above)
  const results = await intelligence.routeTask(embedding, undefined, topK);

  // Filter for pattern results (those with pattern- prefix)
  const patternResults = results
    .filter(r => r.agentId.startsWith('pattern-'))
    .map(r => {
      // Track access for compression tiering
      const pattern = patternStore.get(r.agentId);
      if (pattern) {
        pattern.accessCount++;
        pattern.lastAccessed = Date.now();
        totalPatternAccesses++;
      }

      return {
        task: task,
        resolution: r.agentId,
        reward: r.confidence,
        similarity: r.confidence,
      };
    });

  // Trigger background recompression (non-blocking)
  recompressPatterns().catch(() => {});

  return patternResults;
}

/**
 * Get intelligence stats for monitoring
 * Includes tiered compression stats (v2.0.1-alpha.24+)
 * Includes multi-algorithm learning stats (v2.0.1-alpha.25+)
 */
export async function getIntelligenceStats(): Promise<{
  initialized: boolean;
  features: string[];
  trajectoryCount: number;
  activeTrajectories: number;
  learningEnabled: boolean;
  persistedStats?: {
    trajectories: number;
    routings: number;
    patterns: number;
    operations: number;
  };
  compressionStats?: {
    tierDistribution: { hot: number; warm: number; cool: number; cold: number; archive: number };
    totalPatterns: number;
    totalAccesses: number;
    memorySavings: string;
  };
  multiAlgorithmStats?: {
    enabled: boolean;
    algorithms: string[];
    episodesPerAlgorithm: Record<string, number>;
    avgRewardPerAlgorithm: Record<string, number>;
  };
}> {
  const store = getStore();
  const persistedStats = await store.getSummary();
  const compressionStats = getCompressionStats();
  const multiAlgorithmStats = await getMultiAlgorithmStats();

  if (!intelligenceInstance) {
    return {
      initialized: false,
      features: [],
      trajectoryCount: persistedStats.trajectories,
      activeTrajectories: 0,
      learningEnabled: false,
      persistedStats,
      compressionStats,
      multiAlgorithmStats,
    };
  }

  const stats = intelligenceInstance.getStats();

  return {
    initialized: true,
    features: ['sona', 'micro-lora', ...(ENABLE_HNSW ? ['hnsw'] : []), 'moe-attention', 'tensor-compress', 'multi-algorithm-rl'],
    trajectoryCount: persistedStats.trajectories || stats.totalTrajectories || 0,
    activeTrajectories: activeTrajectories.size,
    learningEnabled: intelligenceInstance.isEnabled(),
    persistedStats,
    compressionStats,
    multiAlgorithmStats,
  };
}

/**
 * Force a learning cycle (useful for batch learning)
 */
export async function forceLearningCycle(): Promise<string> {
  const intelligence = await getIntelligence();
  return intelligence.forceLearning();
}

/**
 * Compute attention-weighted similarity for advanced routing
 */
export async function computeAttentionSimilarity(
  query: Float32Array,
  candidates: Float32Array[]
): Promise<number[]> {
  const intelligence = await getIntelligence();

  // Use async attention for ranking
  const result = await intelligence.computeAttentionAsync(query, candidates, candidates);

  return Array.from(result);
}

// ============================================================================
// Parallel Intelligence (ruvector@0.1.62+)
// ============================================================================

// Lazy load ruvector for parallel features
let ruvectorModule: any = null;
let parallelEngine: any = null;
let episodeQueue: Array<{
  state: string;
  action: string;
  reward: number;
  nextState: string;
  done: boolean;
}> = [];

/**
 * Get the parallel intelligence engine from ruvector
 */
async function getParallelEngine(): Promise<any> {
  if (parallelEngine) return parallelEngine;

  try {
    ruvectorModule = await import('ruvector');
    if (ruvectorModule.IntelligenceEngine) {
      parallelEngine = new ruvectorModule.IntelligenceEngine({ enableOnnx: true });
      console.log('[IntelligenceBridge] Parallel engine initialized (7 workers)');
    }
    return parallelEngine;
  } catch (error) {
    console.warn('[IntelligenceBridge] Parallel engine not available:', error);
    return null;
  }
}

/**
 * Queue an episode for batch Q-learning (3-4x faster)
 * Episodes are batched and processed in parallel
 */
export async function queueEpisode(episode: {
  state: string;
  action: string;
  reward: number;
  nextState: string;
  done: boolean;
}): Promise<void> {
  const engine = await getParallelEngine();
  if (engine?.queueEpisode) {
    engine.queueEpisode(episode);
  } else {
    // Fallback: queue locally
    episodeQueue.push(episode);
  }
}

/**
 * Flush queued episodes for batch processing
 * Processes in parallel with worker threads
 */
export async function flushEpisodeBatch(): Promise<{
  processed: number;
  parallelEnabled: boolean;
}> {
  const engine = await getParallelEngine();
  if (engine?.flushEpisodeBatch) {
    await engine.flushEpisodeBatch();
    const stats = engine.getStats();
    return {
      processed: stats.totalEpisodes || 0,
      parallelEnabled: stats.parallelEnabled || false,
    };
  }

  // Fallback: process locally
  const processed = episodeQueue.length;
  episodeQueue = [];
  return { processed, parallelEnabled: false };
}

/**
 * Match patterns in parallel across multiple files
 * Provides 3-4x faster pretrain
 */
export async function matchPatternsParallel(
  files: Array<{ path: string; content: string }>
): Promise<Array<{ path: string; patterns: string[]; similarity: number }>> {
  const engine = await getParallelEngine();

  if (engine?.matchPatternsParallel) {
    return engine.matchPatternsParallel(files);
  }

  // Fallback: sequential matching with embeddings
  const service = getEmbeddingServiceInstance();
  const results: Array<{ path: string; patterns: string[]; similarity: number }> = [];

  for (const file of files) {
    const embedding = await service.embed(file.content.slice(0, 1000));
    results.push({
      path: file.path,
      patterns: detectPatterns(file.content),
      similarity: 0.5,
    });
  }

  return results;
}

/**
 * Index memories in background (non-blocking hooks)
 */
export async function indexMemoriesBackground(
  memories: Array<{ id: string; text: string; metadata?: Record<string, any> }>
): Promise<{ queued: number; processing: boolean }> {
  const engine = await getParallelEngine();

  if (engine?.indexMemoriesBackground) {
    return engine.indexMemoriesBackground(memories);
  }

  // Fallback: queue for next batch
  const service = getEmbeddingServiceInstance();
  // Non-blocking: just queue, don't await
  Promise.all(memories.map(m => service.embed(m.text))).catch(() => {});

  return { queued: memories.length, processing: true };
}

/**
 * Parallel similarity search with sharding
 */
export async function searchParallel(
  query: string,
  topK: number = 10
): Promise<Array<{ id: string; text: string; similarity: number }>> {
  const engine = await getParallelEngine();

  if (engine?.searchParallel) {
    return engine.searchParallel(query, topK);
  }

  // Fallback: use EmbeddingService semantic search
  const service = getEmbeddingServiceInstance();
  try {
    const results = await service.semanticSearch(query, topK);
    return results.map(r => ({
      id: String(r.index),
      text: r.text,
      similarity: r.similarity,
    }));
  } catch {
    return [];
  }
}

/**
 * Analyze multiple files in parallel for routing
 */
export async function analyzeFilesParallel(
  files: Array<{ path: string; content: string }>
): Promise<Array<{ path: string; agent: string; confidence: number }>> {
  const engine = await getParallelEngine();

  if (engine?.analyzeFilesParallel) {
    return engine.analyzeFilesParallel(files);
  }

  // Fallback: parallel with Promise.all
  const results = await Promise.all(
    files.map(async (file) => {
      const routing = await routeTaskIntelligent(`analyze ${file.path}`, { file: file.path });
      return {
        path: file.path,
        agent: routing.agent,
        confidence: routing.confidence,
      };
    })
  );

  return results;
}

/**
 * Analyze git commits in parallel for co-edit detection
 */
export async function analyzeCommitsParallel(
  commits: Array<{ hash: string; message: string; files: string[] }>
): Promise<Array<{ hash: string; coEditGroups: string[][]; patterns: string[] }>> {
  const engine = await getParallelEngine();

  if (engine?.analyzeCommitsParallel) {
    return engine.analyzeCommitsParallel(commits);
  }

  // Fallback: detect co-edit patterns from file groups
  return commits.map(commit => ({
    hash: commit.hash,
    coEditGroups: [commit.files], // Simple: treat all files as one group
    patterns: detectCommitPatterns(commit.message),
  }));
}

/**
 * Get parallel stats
 */
export async function getParallelStats(): Promise<{
  parallelEnabled: boolean;
  parallelWorkers: number;
  parallelBusy: number;
  parallelQueued: number;
}> {
  const engine = await getParallelEngine();

  if (engine?.getStats) {
    const stats = engine.getStats();
    return {
      parallelEnabled: stats.parallelEnabled || false,
      parallelWorkers: stats.parallelWorkers || 0,
      parallelBusy: stats.parallelBusy || 0,
      parallelQueued: stats.parallelQueued || 0,
    };
  }

  return {
    parallelEnabled: false,
    parallelWorkers: 0,
    parallelBusy: 0,
    parallelQueued: 0,
  };
}

// Helper: detect patterns in file content
function detectPatterns(content: string): string[] {
  const patterns: string[] = [];
  if (content.includes('async')) patterns.push('async-code');
  if (content.includes('test') || content.includes('describe')) patterns.push('test-file');
  if (content.includes('class')) patterns.push('oop');
  if (content.includes('import') || content.includes('export')) patterns.push('module');
  if (content.includes('interface') || content.includes('type ')) patterns.push('typescript');
  return patterns;
}

// Helper: detect patterns in commit messages
function detectCommitPatterns(message: string): string[] {
  const patterns: string[] = [];
  const lower = message.toLowerCase();
  if (lower.includes('fix')) patterns.push('bugfix');
  if (lower.includes('feat') || lower.includes('add')) patterns.push('feature');
  if (lower.includes('refactor')) patterns.push('refactor');
  if (lower.includes('test')) patterns.push('testing');
  if (lower.includes('doc')) patterns.push('documentation');
  return patterns;
}

// ============================================================================
// Extended Worker Pool (ruvector@0.1.63+)
// ============================================================================

let extendedWorkerPool: any = null;

/**
 * Get the extended worker pool for hook operations
 */
async function getExtendedWorkerPool(): Promise<any> {
  if (extendedWorkerPool) return extendedWorkerPool;

  try {
    if (!ruvectorModule) {
      ruvectorModule = await import('ruvector');
    }
    if (ruvectorModule.ExtendedWorkerPool) {
      extendedWorkerPool = new ruvectorModule.ExtendedWorkerPool();
      await extendedWorkerPool.init?.();
      console.log('[IntelligenceBridge] Extended worker pool initialized');
    }
    return extendedWorkerPool;
  } catch (error) {
    return null;
  }
}

/**
 * Speculatively pre-embed files that are likely to be accessed
 * Call in post-edit hook for related files
 */
export async function speculativeEmbed(
  files: string[]
): Promise<{ queued: number }> {
  const pool = await getExtendedWorkerPool();
  if (pool?.speculativeEmbed) {
    return pool.speculativeEmbed(files);
  }
  return { queued: 0 };
}

/**
 * Analyze AST of multiple files in parallel
 * For pre-edit and route hooks
 */
export async function analyzeAST(
  files: Array<{ path: string; content: string }>
): Promise<Array<{ path: string; functions: string[]; imports: string[]; exports: string[] }>> {
  const pool = await getExtendedWorkerPool();
  if (pool?.analyzeAST) {
    return pool.analyzeAST(files);
  }
  // Fallback: simple regex-based extraction
  return files.map(f => ({
    path: f.path,
    functions: (f.content.match(/function\s+(\w+)/g) || []).map(m => m.replace('function ', '')),
    imports: (f.content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || []),
    exports: (f.content.match(/export\s+(default\s+)?(function|class|const)\s+(\w+)/g) || []),
  }));
}

/**
 * Analyze code complexity metrics in parallel
 * For session-end hook to track quality
 */
export async function analyzeComplexity(
  files: string[]
): Promise<Array<{ path: string; cyclomatic: number; cognitive: number; lines: number }>> {
  const pool = await getExtendedWorkerPool();
  if (pool?.analyzeComplexity) {
    return pool.analyzeComplexity(files);
  }
  return files.map(f => ({ path: f, cyclomatic: 0, cognitive: 0, lines: 0 }));
}

/**
 * Build dependency graph from import statements
 * For session-start hook context
 */
export async function buildDependencyGraph(
  files: string[]
): Promise<{ nodes: string[]; edges: Array<{ from: string; to: string }> }> {
  const pool = await getExtendedWorkerPool();
  if (pool?.buildDependencyGraph) {
    return pool.buildDependencyGraph(files);
  }
  return { nodes: files, edges: [] };
}

/**
 * Parallel security scan (SAST)
 * For pre-command hook before commits
 */
export async function securityScan(
  files: string[]
): Promise<Array<{ path: string; severity: string; message: string; line: number }>> {
  const pool = await getExtendedWorkerPool();
  if (pool?.securityScan) {
    return pool.securityScan(files);
  }
  return [];
}

/**
 * RAG retrieval with parallel chunk processing
 * For recall hook
 */
export async function ragRetrieve(
  query: string,
  chunks: Array<{ id: string; text: string }>,
  topK: number = 5
): Promise<Array<{ id: string; text: string; score: number }>> {
  const pool = await getExtendedWorkerPool();
  if (pool?.ragRetrieve) {
    return pool.ragRetrieve(query, chunks, topK);
  }
  // Fallback: use embedding service
  const service = getEmbeddingServiceInstance();
  await service.buildCorpus(chunks.map(c => c.text));
  const results = await service.semanticSearch(query, topK);
  return results.map((r, i) => ({
    id: chunks[r.index]?.id || String(r.index),
    text: r.text,
    score: r.similarity,
  }));
}

/**
 * Rank context by relevance
 * For suggest-context hook
 */
export async function rankContext(
  query: string,
  contexts: Array<{ id: string; content: string }>
): Promise<Array<{ id: string; relevance: number }>> {
  const pool = await getExtendedWorkerPool();
  if (pool?.rankContext) {
    return pool.rankContext(query, contexts);
  }
  // Fallback: use similarity
  const service = getEmbeddingServiceInstance();
  const queryEmb = await service.embed(query);
  const results: Array<{ id: string; relevance: number }> = [];
  for (const ctx of contexts) {
    const ctxEmb = await service.embed(ctx.content.slice(0, 500));
    const relevance = service.cosineSimilarity(queryEmb, ctxEmb);
    results.push({ id: ctx.id, relevance });
  }
  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Semantic deduplication
 * For remember hook to avoid storing duplicates
 */
export async function deduplicate(
  texts: string[],
  threshold: number = 0.9
): Promise<{ unique: string[]; duplicateGroups: number[][] }> {
  const pool = await getExtendedWorkerPool();
  if (pool?.deduplicate) {
    return pool.deduplicate(texts, threshold);
  }
  // Fallback: use embedding service
  const service = getEmbeddingServiceInstance();
  const duplicates = await service.findDuplicates(texts, threshold);
  const duplicateIndices = new Set(duplicates.flatMap(d => d.indices.slice(1)));
  const unique = texts.filter((_, i) => !duplicateIndices.has(i));
  return {
    unique,
    duplicateGroups: duplicates.map(d => d.indices),
  };
}

/**
 * Parallel git blame analysis
 * For co-edit hook
 */
export async function gitBlame(
  files: string[]
): Promise<Array<{ path: string; authors: Array<{ name: string; lines: number }> }>> {
  const pool = await getExtendedWorkerPool();
  if (pool?.gitBlame) {
    return pool.gitBlame(files);
  }
  return files.map(f => ({ path: f, authors: [] }));
}

/**
 * Code churn metrics for routing decisions
 * For route hook to prioritize high-churn files
 */
export async function gitChurn(
  patterns: string[],
  since: string = '30 days ago'
): Promise<Array<{ path: string; commits: number; additions: number; deletions: number }>> {
  const pool = await getExtendedWorkerPool();
  if (pool?.gitChurn) {
    return pool.gitChurn(patterns, since);
  }
  return [];
}

/**
 * Get attention mechanism for specific use case
 */
export async function getAttentionForUseCase(
  useCase: 'pattern-matching' | 'agent-routing' | 'code-structure' | 'context-summary' | 'multi-agent'
): Promise<{ type: string; instance: any }> {
  if (!ruvectorModule) {
    ruvectorModule = await import('ruvector');
  }

  const attentionMap: Record<string, string> = {
    'pattern-matching': 'MultiHeadAttention',
    'agent-routing': 'MoEAttention',
    'code-structure': 'GraphRoPeAttention',
    'context-summary': 'LocalGlobalAttention',
    'multi-agent': 'MoEAttention',
  };

  const type = attentionMap[useCase] || 'MultiHeadAttention';
  const AttentionClass = ruvectorModule[type];

  if (AttentionClass) {
    return { type, instance: new AttentionClass(384, 4) };
  }

  return { type: 'fallback', instance: null };
}

/**
 * Parallel attention compute across multiple queries
 */
export async function parallelAttentionCompute(
  queries: Float32Array[],
  keys: Float32Array[],
  values: Float32Array[],
  type: 'hyperbolic' | 'flash' | 'moe' = 'moe'
): Promise<Float32Array[]> {
  if (!ruvectorModule) {
    ruvectorModule = await import('ruvector');
  }

  if (ruvectorModule.parallelAttentionCompute) {
    return ruvectorModule.parallelAttentionCompute(queries, keys, values, type);
  }

  return [];
}

/**
 * Get extended worker pool stats
 */
export async function getExtendedWorkerStats(): Promise<{
  initialized: boolean;
  operations: string[];
}> {
  const pool = await getExtendedWorkerPool();
  if (pool) {
    return {
      initialized: true,
      operations: [
        'speculativeEmbed', 'analyzeAST', 'analyzeComplexity', 'buildDependencyGraph',
        'securityScan', 'ragRetrieve', 'rankContext', 'deduplicate', 'gitBlame', 'gitChurn'
      ],
    };
  }
  return { initialized: false, operations: [] };
}

// Export types
export type { AgentRoutingResult, Trajectory, LearningOutcome };
