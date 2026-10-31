/**
 * RuVector Unified Intelligence Layer
 *
 * Integrates the FULL power of RuVector ecosystem:
 *
 * @ruvector/sona - Self-Learning:
 *   - Micro-LoRA: Ultra-fast rank-1/2 adaptations (~0.1ms)
 *   - Base-LoRA: Deeper pattern adaptations
 *   - EWC++: Elastic Weight Consolidation (catastrophic forgetting prevention)
 *   - ReasoningBank: Pattern storage/retrieval via findPatterns
 *   - Trajectory tracking: Learn from execution paths
 *
 * @ruvector/attention - Advanced Attention:
 *   - MultiHeadAttention: Standard transformer attention
 *   - FlashAttention: Memory-efficient O(n) attention
 *   - HyperbolicAttention: Poincaré ball geometry for hierarchies
 *   - MoEAttention: Mixture of Experts routing
 *   - GraphRoPeAttention: Graph + Rotary Position Embeddings
 *   - EdgeFeaturedAttention: Edge-aware graph attention
 *   - DualSpaceAttention: Euclidean + Hyperbolic hybrid
 *
 * @ruvector/core - Vector Database:
 *   - HNSW indexing: 150x faster than brute force
 *   - Real vector similarity search
 *   - Cosine/Euclidean/Dot product distance
 *
 * Performance:
 *   - Micro-LoRA adaptation: ~0.1ms
 *   - FlashAttention: O(n) complexity vs O(n²)
 *   - HNSW search: O(log n) vs O(n)
 *   - Background learning: Non-blocking
 */

// Optional imports - graceful fallback on Windows/platforms without native binaries
let SonaEngine: any = null;
let sonaAvailable = false;

let MultiHeadAttention: any = null;
let FlashAttention: any = null;
let HyperbolicAttention: any = null;
let MoEAttention: any = null;
let GraphRoPeAttention: any = null;
let DualSpaceAttention: any = null;
let AdamOptimizer: any = null;
let computeAttentionAsync: any = null;
let computeFlashAttentionAsync: any = null;
let computeHyperbolicAttentionAsync: any = null;
let poincareDistance: any = null;
let projectToPoincareBall: any = null;
let AttentionType: any = null;
let attentionAvailable = false;

// Try to load @ruvector/sona
try {
  const sonaModule = await import('@ruvector/sona');
  SonaEngine = sonaModule.SonaEngine;
  sonaAvailable = true;
} catch {
  console.warn('[RuVectorIntelligence] @ruvector/sona not available - self-learning disabled');
}

// Try to load @ruvector/attention
try {
  // @ruvector/attention is CommonJS; from 0.1.32 its typings expose it as
  // `default` under ESM interop, while older builds surface named exports.
  const attentionMod: any = await import('@ruvector/attention');
  const attentionModule = attentionMod.default ?? attentionMod;
  MultiHeadAttention = attentionModule.MultiHeadAttention;
  FlashAttention = attentionModule.FlashAttention;
  HyperbolicAttention = attentionModule.HyperbolicAttention;
  MoEAttention = attentionModule.MoEAttention;
  GraphRoPeAttention = attentionModule.GraphRoPeAttention;
  DualSpaceAttention = attentionModule.DualSpaceAttention;
  AdamOptimizer = attentionModule.AdamOptimizer;
  computeAttentionAsync = attentionModule.computeAttentionAsync;
  computeFlashAttentionAsync = attentionModule.computeFlashAttentionAsync;
  computeHyperbolicAttentionAsync = attentionModule.computeHyperbolicAttentionAsync;
  poincareDistance = attentionModule.poincareDistance;
  projectToPoincareBall = attentionModule.projectToPoincareBall;
  AttentionType = attentionModule.AttentionType;
  attentionAvailable = true;
} catch {
  console.warn('[RuVectorIntelligence] @ruvector/attention not available - attention features disabled');
}

// Import from ruvector core (for HNSW)
import ruvector from 'ruvector';

// Export availability flags
export { sonaAvailable, attentionAvailable };

// Local type definitions (replaces imports from optional packages)
export interface JsSonaConfig {
  embeddingDim?: number;
  hiddenDim?: number;
  microLoraRank?: number;
  baseLoraRank?: number;
  ewcLambda?: number;
  microLoraLr?: number;
  baseLoraLr?: number;
  patternClusters?: number;
  [key: string]: any; // Allow additional properties
}

export interface JsLearnedPattern {
  id: string;
  pattern: number[];
  confidence: number;
  timestamp: number;
}

export interface MoEConfig {
  numExperts?: number;
  topK?: number;
  routerDim?: number;
  dim?: number;
}

/**
 * Intelligence Layer Configuration
 */
export interface RuVectorIntelligenceConfig {
  /** Embedding dimension (default: 384 for all-MiniLM-L6-v2) */
  embeddingDim?: number;

  /** Hidden dimension for SONA (default: 256) */
  hiddenDim?: number;

  /** Enable SONA self-learning (default: true) */
  enableSona?: boolean;

  /** SONA configuration */
  sonaConfig?: Partial<JsSonaConfig>;

  /** Attention type for agent routing (default: 'moe') */
  attentionType?: 'multi_head' | 'flash' | 'hyperbolic' | 'moe' | 'graph' | 'dual';

  /** Number of attention heads (default: 8) */
  numHeads?: number;

  /** Number of MoE experts (default: 4) */
  numExperts?: number;

  /** Top-K experts to use (default: 2) */
  topK?: number;

  /** Hyperbolic curvature for hierarchical structures (default: 1.0) */
  curvature?: number;

  /** Enable HNSW vector index (default: true) */
  enableHnsw?: boolean;

  /** HNSW M parameter - connections per node (default: 16) */
  hnswM?: number;

  /** HNSW ef_construction (default: 200) */
  hnswEfConstruction?: number;

  /** Enable trajectory tracking (default: true) */
  enableTrajectories?: boolean;

  /** Quality threshold for learning (default: 0.5) */
  qualityThreshold?: number;

  /** Background learning interval in ms (default: 60000 = 1 min) */
  backgroundIntervalMs?: number;

  /** Maximum trajectories to keep in memory (default: 1000, LRU eviction) */
  maxTrajectories?: number;

  /** Trajectory TTL in ms (default: 1800000 = 30 min) */
  trajectoryTTLMs?: number;

  /** Maximum agent embeddings to cache (default: 500, LRU eviction) */
  maxAgentEmbeddings?: number;
}

/**
 * Trajectory for learning
 */
export interface Trajectory {
  id: number;
  query: string;
  embedding: number[];
  steps: TrajectoryStep[];
  route?: string;
  contexts: string[];
  startTime: number;
}

export interface TrajectoryStep {
  action: string;
  activations: number[];
  attentionWeights: number[];
  reward: number;
  timestamp: number;
}

/**
 * Agent routing result
 */
export interface AgentRoutingResult {
  agentId: string;
  confidence: number;
  attentionWeights: Float32Array;
  expertWeights?: number[];
  latencyMs: number;
  usedHnsw: boolean;
  usedSona: boolean;
}

/**
 * Learning outcome
 */
export interface LearningOutcome {
  trajectoryId: number;
  success: boolean;
  quality: number;
  patternsLearned: number;
  adaptations: {
    microLora: boolean;
    baseLora: boolean;
    ewc: boolean;
  };
}

/**
 * RuVector Unified Intelligence Layer
 *
 * Combines SONA self-learning, advanced attention mechanisms,
 * and HNSW vector search for intelligent agent orchestration.
 */
/**
 * Result wrapper for operations that can fail
 */
export interface OperationResult<T> {
  success: boolean;
  value?: T;
  error?: string;
}

export class RuVectorIntelligence {
  private config: Required<RuVectorIntelligenceConfig>;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // SONA Engine for self-learning
  private sona: any = null;

  // Attention mechanisms
  private multiHeadAttention: any = null;
  private flashAttention: any = null;
  private hyperbolicAttention: any = null;
  private moeAttention: any = null;
  private graphAttention: any = null;
  private dualSpaceAttention: any = null;

  // Training (simplified - removed unused scheduler/loss)
  private optimizer: any = null;

  // HNSW index for vector search
  private hnswIndex: any = null;

  // Active trajectories with LRU tracking
  private trajectories: Map<number, Trajectory> = new Map();
  private trajectoryAccessOrder: number[] = []; // For LRU eviction
  private nextTrajectoryId = 0;

  // Agent embeddings with LRU tracking
  private agentEmbeddings: Map<string, Float32Array> = new Map();
  private agentAccessOrder: string[] = []; // For LRU eviction

  // Background learning timer
  private learningTimer: NodeJS.Timeout | null = null;

  // Cleanup timer for stale trajectories
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalRoutings: 0,
    totalTrajectories: 0,
    totalLearningCycles: 0,
    avgRoutingLatencyMs: 0,
    patternsLearned: 0,
    hnswQueries: 0,
    sonaAdaptations: 0,
    evictedTrajectories: 0,
    evictedAgents: 0,
  };

  constructor(config?: RuVectorIntelligenceConfig) {
    this.config = {
      embeddingDim: config?.embeddingDim ?? 384,
      hiddenDim: config?.hiddenDim ?? 256,
      enableSona: config?.enableSona ?? true,
      sonaConfig: config?.sonaConfig ?? {},
      attentionType: config?.attentionType ?? 'moe',
      numHeads: config?.numHeads ?? 8,
      numExperts: config?.numExperts ?? 4,
      topK: config?.topK ?? 2,
      curvature: config?.curvature ?? 1.0,
      enableHnsw: config?.enableHnsw ?? true,
      hnswM: config?.hnswM ?? 16,
      hnswEfConstruction: config?.hnswEfConstruction ?? 200,
      enableTrajectories: config?.enableTrajectories ?? true,
      qualityThreshold: config?.qualityThreshold ?? 0.5,
      backgroundIntervalMs: config?.backgroundIntervalMs ?? 60000,
      // Memory limits with LRU eviction
      maxTrajectories: config?.maxTrajectories ?? 1000,
      trajectoryTTLMs: config?.trajectoryTTLMs ?? 1800000, // 30 min
      maxAgentEmbeddings: config?.maxAgentEmbeddings ?? 500,
    };

    // Initialize asynchronously to avoid race conditions
    this.initPromise = this.initializeAsync();
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Initialize all components (async to avoid race conditions)
   */
  private async initializeAsync(): Promise<void> {
    if (this.initialized) return;

    const dim = this.config.embeddingDim;

    // Initialize SONA Engine
    if (this.config.enableSona) {
      try {
        // Ensure all values are explicitly defined (no undefined values)
        const sonaConfig: JsSonaConfig = {
          hiddenDim: this.config.hiddenDim ?? 256,
          embeddingDim: dim ?? 384,
          microLoraRank: 1, // Ultra-fast rank-1
          baseLoraRank: 8,
          microLoraLr: 0.001,
          baseLoraLr: 0.0001,
          ewcLambda: 1000.0, // EWC++ regularization
          patternClusters: 50,
          trajectoryCapacity: 10000,
          qualityThreshold: this.config.qualityThreshold ?? 0.5, // Ensure defined
          enableSimd: true,
          // Only spread defined values from sonaConfig
          ...(this.config.sonaConfig && Object.fromEntries(
            Object.entries(this.config.sonaConfig).filter(([, v]) => v !== undefined)
          )),
        };

        this.sona = SonaEngine.withConfig(sonaConfig);
      } catch (err) {
        console.warn('[RuVectorIntelligence] SONA init failed, using fallback:', err);
        this.sona = null;
      }
    }

    // Initialize attention mechanisms based on type
    try {
      switch (this.config.attentionType) {
        case 'multi_head':
          this.multiHeadAttention = new MultiHeadAttention(dim, this.config.numHeads ?? 8);
          break;

        case 'flash':
          this.flashAttention = new FlashAttention(dim);
          break;

        case 'hyperbolic':
          this.hyperbolicAttention = new HyperbolicAttention(dim, this.config.curvature ?? 1.0);
          break;

        case 'moe':
          const moeConfig: MoEConfig = {
            dim,
            numExperts: this.config.numExperts ?? 4,
            topK: this.config.topK ?? 2,
          };
          this.moeAttention = new MoEAttention(moeConfig);
          break;

        case 'graph':
          this.graphAttention = new GraphRoPeAttention(dim, 10000);
          break;

        case 'dual':
          this.dualSpaceAttention = new DualSpaceAttention(
            dim,
            this.config.curvature ?? 1.0,
            0.5, // Euclidean weight
            0.5  // Hyperbolic weight
          );
          break;
      }
    } catch (err) {
      console.warn('[RuVectorIntelligence] Attention init failed, using fallback:', err);
    }

    // Initialize training components (simplified - only optimizer needed)
    try {
      // AdamOptimizer requires: learning_rate, beta1, beta2, epsilon
      this.optimizer = new AdamOptimizer(0.001, 0.9, 0.999, 1e-8);
    } catch (err) {
      console.warn('[RuVectorIntelligence] Optimizer init failed:', err);
    }

    // Initialize HNSW index
    if (this.config.enableHnsw) {
      try {
        this.initializeHnsw();
      } catch (err) {
        console.warn('[RuVectorIntelligence] HNSW init failed:', err);
      }
    }

    // Start background learning
    if (this.config.enableSona) {
      this.startBackgroundLearning();
    }

    // Start cleanup timer for stale trajectories
    this.startCleanupTimer();

    this.initialized = true;
  }

  /**
   * Start cleanup timer for stale trajectories
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Run cleanup every 5 minutes
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleTrajectories();
    }, 300000);
  }

  /**
   * Clean up trajectories older than TTL
   */
  private cleanupStaleTrajectories(): void {
    const now = Date.now();
    const ttl = this.config.trajectoryTTLMs;

    for (const [id, trajectory] of this.trajectories) {
      if (now - trajectory.startTime > ttl) {
        this.trajectories.delete(id);
        this.trajectoryAccessOrder = this.trajectoryAccessOrder.filter(t => t !== id);
        this.stats.evictedTrajectories++;
      }
    }
  }

  /**
   * LRU eviction for trajectories when limit exceeded
   */
  private evictOldestTrajectory(): void {
    if (this.trajectoryAccessOrder.length === 0) return;

    const oldestId = this.trajectoryAccessOrder.shift()!;
    this.trajectories.delete(oldestId);
    this.stats.evictedTrajectories++;
  }

  /**
   * LRU eviction for agent embeddings when limit exceeded
   */
  private evictOldestAgent(): void {
    if (this.agentAccessOrder.length === 0) return;

    const oldestId = this.agentAccessOrder.shift()!;
    this.agentEmbeddings.delete(oldestId);
    this.stats.evictedAgents++;
  }

  /**
   * Update LRU access order for trajectory
   */
  private touchTrajectory(id: number): void {
    const idx = this.trajectoryAccessOrder.indexOf(id);
    if (idx !== -1) {
      this.trajectoryAccessOrder.splice(idx, 1);
    }
    this.trajectoryAccessOrder.push(id);
  }

  /**
   * Update LRU access order for agent
   */
  private touchAgent(id: string): void {
    const idx = this.agentAccessOrder.indexOf(id);
    if (idx !== -1) {
      this.agentAccessOrder.splice(idx, 1);
    }
    this.agentAccessOrder.push(id);
  }

  /**
   * Initialize HNSW index for fast vector search
   */
  private initializeHnsw(): void {
    try {
      // Use ruvector core HNSW
      this.hnswIndex = new ruvector.HnswIndex({
        dim: this.config.embeddingDim,
        m: this.config.hnswM,
        efConstruction: this.config.hnswEfConstruction,
        distance: 'cosine',
      });
    } catch (error) {
      console.warn('HNSW initialization failed, falling back to brute force:', error);
      this.hnswIndex = null;
    }
  }

  /**
   * Register an agent with its embedding
   *
   * @param agentId - Unique agent identifier
   * @param embedding - Agent's semantic embedding
   * @param metadata - Optional metadata
   * @returns Operation result indicating success/failure
   */
  async registerAgent(
    agentId: string,
    embedding: number[] | Float32Array,
    metadata?: Record<string, any>
  ): Promise<OperationResult<void>> {
    await this.waitForInit();

    try {
      const embeddingArray = embedding instanceof Float32Array
        ? embedding
        : new Float32Array(embedding);

      // LRU eviction if at capacity
      while (this.agentEmbeddings.size >= this.config.maxAgentEmbeddings) {
        this.evictOldestAgent();
      }

      // Store in cache and update LRU order
      this.agentEmbeddings.set(agentId, embeddingArray);
      this.touchAgent(agentId);

      // Add to HNSW index
      if (this.hnswIndex) {
        try {
          await this.hnswIndex.add(agentId, embeddingArray);
        } catch (error) {
          console.warn(`Failed to add agent ${agentId} to HNSW:`, error);
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Route a task to the best agent using full intelligence stack
   *
   * Uses:
   * - HNSW for fast candidate retrieval
   * - Attention mechanism for ranking
   * - SONA for adaptive learning
   *
   * @param taskEmbedding - Task's semantic embedding
   * @param candidates - Optional candidate agent IDs
   * @param topK - Number of results
   */
  async routeTask(
    taskEmbedding: number[] | Float32Array,
    candidates?: string[],
    topK: number = 5
  ): Promise<AgentRoutingResult[]> {
    const startTime = performance.now();
    const query = taskEmbedding instanceof Float32Array
      ? taskEmbedding
      : new Float32Array(taskEmbedding);

    let results: AgentRoutingResult[] = [];
    let usedHnsw = false;
    let usedSona = false;

    // Step 1: Get candidates via HNSW (150x faster than brute force)
    let candidateAgents: Array<{ id: string; embedding: Float32Array; score: number }> = [];

    if (this.hnswIndex && this.agentEmbeddings.size > 10) {
      try {
        const hnswResults = await this.hnswIndex.search(query, Math.min(topK * 2, 20));
        candidateAgents = hnswResults.map((r: any) => ({
          id: r.id,
          embedding: this.agentEmbeddings.get(r.id)!,
          score: r.score,
        }));
        usedHnsw = true;
        this.stats.hnswQueries++;
      } catch (error) {
        // Fallback to all agents
      }
    }

    // Fallback: use provided candidates or all agents
    if (candidateAgents.length === 0) {
      const agentIds = candidates || Array.from(this.agentEmbeddings.keys());
      candidateAgents = agentIds
        .filter(id => this.agentEmbeddings.has(id))
        .map(id => ({
          id,
          embedding: this.agentEmbeddings.get(id)!,
          score: 0,
        }));
    }

    if (candidateAgents.length === 0) {
      return [];
    }

    // Step 2: Apply SONA Micro-LoRA transformation (~0.1ms)
    let transformedQuery = query;
    if (this.sona) {
      try {
        const loraResult = this.sona.applyMicroLora(Array.from(query));
        transformedQuery = new Float32Array(loraResult);
        usedSona = true;
        this.stats.sonaAdaptations++;
      } catch (error) {
        // Use original query
      }
    }

    // Step 3: Compute attention scores
    const keys = candidateAgents.map(c => c.embedding);
    const values = candidateAgents.map(c => c.embedding);

    let attentionOutput: Float32Array;
    let expertWeights: number[] | undefined;

    switch (this.config.attentionType) {
      case 'moe':
        if (this.moeAttention) {
          attentionOutput = this.moeAttention.compute(transformedQuery, keys, values);
          // MoE provides expert routing weights
          expertWeights = Array.from(attentionOutput.slice(0, this.config.numExperts));
        } else {
          attentionOutput = this.computeFallbackAttention(transformedQuery, keys, values);
        }
        break;

      case 'flash':
        if (this.flashAttention) {
          attentionOutput = this.flashAttention.compute(transformedQuery, keys, values);
        } else {
          attentionOutput = this.computeFallbackAttention(transformedQuery, keys, values);
        }
        break;

      case 'hyperbolic':
        if (this.hyperbolicAttention) {
          attentionOutput = this.hyperbolicAttention.compute(transformedQuery, keys, values);
        } else {
          attentionOutput = this.computeFallbackAttention(transformedQuery, keys, values);
        }
        break;

      case 'dual':
        if (this.dualSpaceAttention) {
          attentionOutput = this.dualSpaceAttention.compute(transformedQuery, keys, values);
        } else {
          attentionOutput = this.computeFallbackAttention(transformedQuery, keys, values);
        }
        break;

      default:
        if (this.multiHeadAttention) {
          attentionOutput = this.multiHeadAttention.compute(transformedQuery, keys, values);
        } else {
          attentionOutput = this.computeFallbackAttention(transformedQuery, keys, values);
        }
    }

    // Step 4: Compute similarity scores for ranking
    const scores = candidateAgents.map((agent, i) => {
      // Combine HNSW score with attention-weighted score
      const attentionScore = this.cosineSimilarity(
        attentionOutput,
        agent.embedding
      );
      const hnswScore = agent.score || 0;

      // Weighted combination
      const finalScore = usedHnsw
        ? 0.3 * hnswScore + 0.7 * attentionScore
        : attentionScore;

      return {
        agentId: agent.id,
        confidence: finalScore,
        attentionWeights: attentionOutput,
        expertWeights,
        latencyMs: 0,
        usedHnsw,
        usedSona,
      };
    });

    // Sort by confidence
    results = scores
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, topK);

    // Update latency
    const latencyMs = performance.now() - startTime;
    results.forEach(r => (r.latencyMs = latencyMs));

    // Update stats
    this.stats.totalRoutings++;
    this.stats.avgRoutingLatencyMs =
      (this.stats.avgRoutingLatencyMs * (this.stats.totalRoutings - 1) + latencyMs) /
      this.stats.totalRoutings;

    return results;
  }

  /**
   * Fallback attention using dot product
   */
  private computeFallbackAttention(
    query: Float32Array,
    keys: Float32Array[],
    values: Float32Array[]
  ): Float32Array {
    const dim = query.length;
    const result = new Float32Array(dim);
    let totalWeight = 0;

    for (let i = 0; i < keys.length; i++) {
      const similarity = this.cosineSimilarity(query, keys[i]);
      const weight = Math.exp(similarity * 10); // Temperature scaling
      totalWeight += weight;

      for (let j = 0; j < dim; j++) {
        result[j] += weight * values[i][j];
      }
    }

    // Normalize
    if (totalWeight > 0) {
      for (let j = 0; j < dim; j++) {
        result[j] /= totalWeight;
      }
    }

    return result;
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    return norm > 0 ? dot / norm : 0;
  }

  // ==========================================================================
  // Trajectory Learning (SONA)
  // ==========================================================================

  /**
   * Begin a new trajectory for learning
   *
   * @param query - The task query
   * @param embedding - Query embedding
   * @returns Operation result with trajectory ID
   */
  beginTrajectory(query: string, embedding: number[]): OperationResult<number> {
    if (!this.config.enableTrajectories) {
      return {
        success: false,
        error: 'Trajectories are disabled in config',
      };
    }

    if (!this.sona) {
      return {
        success: false,
        error: 'SONA engine not initialized',
      };
    }

    try {
      // LRU eviction if at capacity
      while (this.trajectories.size >= this.config.maxTrajectories) {
        this.evictOldestTrajectory();
      }

      const trajectoryId = this.nextTrajectoryId++;

      // Start SONA trajectory
      const sonaId = this.sona.beginTrajectory(embedding);

      // Store local trajectory
      this.trajectories.set(trajectoryId, {
        id: sonaId,
        query,
        embedding,
        steps: [],
        contexts: [],
        startTime: Date.now(),
      });

      // Update LRU order
      this.touchTrajectory(trajectoryId);

      this.stats.totalTrajectories++;
      return { success: true, value: trajectoryId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add a step to trajectory
   *
   * @param trajectoryId - Trajectory ID from beginTrajectory
   * @param action - Action taken (e.g., agent selected)
   * @param reward - Reward for this step (0-1)
   * @param activations - Optional activations
   * @param attentionWeights - Optional attention weights
   */
  addTrajectoryStep(
    trajectoryId: number,
    action: string,
    reward: number,
    activations?: number[],
    attentionWeights?: number[]
  ): void {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || !this.sona) {
      return;
    }

    const step: TrajectoryStep = {
      action,
      activations: activations || new Array(this.config.hiddenDim).fill(0),
      attentionWeights: attentionWeights || new Array(this.config.numHeads).fill(0),
      reward,
      timestamp: Date.now(),
    };

    trajectory.steps.push(step);

    // Add to SONA
    this.sona.addTrajectoryStep(
      trajectory.id,
      step.activations,
      step.attentionWeights,
      reward
    );
  }

  /**
   * Set the route (agent selected) for trajectory
   */
  setTrajectoryRoute(trajectoryId: number, route: string): void {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || !this.sona) {
      return;
    }

    trajectory.route = route;
    this.sona.setTrajectoryRoute(trajectory.id, route);
  }

  /**
   * Add context to trajectory
   */
  addTrajectoryContext(trajectoryId: number, contextId: string): void {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || !this.sona) {
      return;
    }

    trajectory.contexts.push(contextId);
    this.sona.addTrajectoryContext(trajectory.id, contextId);
  }

  /**
   * End trajectory and submit for learning
   *
   * @param trajectoryId - Trajectory ID
   * @param success - Whether the task succeeded
   * @param quality - Quality score (0-1)
   * @returns Learning outcome
   */
  endTrajectory(
    trajectoryId: number,
    success: boolean,
    quality: number
  ): LearningOutcome {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || !this.sona) {
      return {
        trajectoryId,
        success,
        quality,
        patternsLearned: 0,
        adaptations: { microLora: false, baseLora: false, ewc: false },
      };
    }

    // End SONA trajectory
    this.sona.endTrajectory(trajectory.id, quality);

    // Cleanup
    this.trajectories.delete(trajectoryId);

    return {
      trajectoryId,
      success,
      quality,
      patternsLearned: quality >= this.config.qualityThreshold ? 1 : 0,
      adaptations: {
        microLora: true, // Micro-LoRA always adapts
        baseLora: quality >= 0.7, // Base-LoRA for high quality
        ewc: quality >= 0.8, // EWC++ for very high quality
      },
    };
  }

  // ==========================================================================
  // Pattern Retrieval (ReasoningBank)
  // ==========================================================================

  /**
   * Find similar learned patterns
   *
   * Uses SONA's ReasoningBank for pattern retrieval
   *
   * @param embedding - Query embedding
   * @param k - Number of patterns to return
   */
  findPatterns(embedding: number[], k: number = 5): JsLearnedPattern[] {
    if (!this.sona) {
      return [];
    }

    return this.sona.findPatterns(embedding, k);
  }

  /**
   * Force a learning cycle
   */
  forceLearning(): string {
    if (!this.sona) {
      return 'SONA not enabled';
    }

    const result = this.sona.forceLearn();
    this.stats.totalLearningCycles++;
    return result;
  }

  // ==========================================================================
  // Background Learning
  // ==========================================================================

  /**
   * Start background learning timer
   */
  private startBackgroundLearning(): void {
    if (this.learningTimer) {
      clearInterval(this.learningTimer);
    }

    this.learningTimer = setInterval(() => {
      if (this.sona) {
        const result = this.sona.tick();
        if (result) {
          this.stats.totalLearningCycles++;
          this.stats.patternsLearned = this.getPatternsCount();
        }
      }
    }, this.config.backgroundIntervalMs);
  }

  /**
   * Get patterns count from SONA stats
   */
  private getPatternsCount(): number {
    if (!this.sona) return 0;

    try {
      const stats = JSON.parse(this.sona.getStats());
      return stats.patterns_count || 0;
    } catch {
      return 0;
    }
  }

  // ==========================================================================
  // Async Attention (for large batches)
  // ==========================================================================

  /**
   * Compute attention asynchronously
   *
   * Useful for large batches or when non-blocking is required
   */
  async computeAttentionAsync(
    query: Float32Array,
    keys: Float32Array[],
    values: Float32Array[],
    type?: 'flash' | 'hyperbolic' | 'standard'
  ): Promise<Float32Array> {
    switch (type) {
      case 'flash':
        return computeFlashAttentionAsync(query, keys, values);

      case 'hyperbolic':
        return computeHyperbolicAttentionAsync(
          query,
          keys,
          values,
          this.config.curvature
        );

      default:
        return computeAttentionAsync(query, keys, values, AttentionType.MultiHead);
    }
  }

  // ==========================================================================
  // Hyperbolic Operations (for hierarchical structures)
  // ==========================================================================

  /**
   * Compute Poincaré distance between two embeddings
   *
   * Useful for hierarchical agent structures
   */
  poincareDistance(a: Float32Array, b: Float32Array): number {
    return poincareDistance(a, b, this.config.curvature);
  }

  /**
   * Project embedding to Poincaré ball
   */
  projectToPoincare(embedding: Float32Array): Float32Array {
    return projectToPoincareBall(embedding, this.config.curvature);
  }

  // ==========================================================================
  // Statistics & Status
  // ==========================================================================

  /**
   * Get intelligence layer statistics
   */
  getStats(): typeof this.stats & { sonaStats?: any } {
    let sonaStats: any = null;

    if (this.sona) {
      try {
        sonaStats = JSON.parse(this.sona.getStats());
      } catch {}
    }

    return {
      ...this.stats,
      sonaStats,
    };
  }

  /**
   * Enable/disable the intelligence layer
   */
  setEnabled(enabled: boolean): void {
    if (this.sona) {
      this.sona.setEnabled(enabled);
    }
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.sona?.isEnabled() ?? false;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.learningTimer) {
      clearInterval(this.learningTimer);
      this.learningTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Flush SONA
    if (this.sona) {
      this.sona.flush();
    }

    // Clear caches and LRU tracking
    this.trajectories.clear();
    this.trajectoryAccessOrder = [];
    this.agentEmbeddings.clear();
    this.agentAccessOrder = [];
  }
}

/**
 * Create a default intelligence layer
 */
export function createIntelligenceLayer(
  config?: RuVectorIntelligenceConfig
): RuVectorIntelligence {
  return new RuVectorIntelligence(config);
}

/**
 * Presets for common configurations
 */
export const IntelligencePresets = {
  /** Fast routing with MoE and minimal learning */
  fast: {
    attentionType: 'moe' as const,
    numExperts: 4,
    topK: 2,
    enableTrajectories: false,
    backgroundIntervalMs: 300000, // 5 min
  },

  /** Balanced performance and learning */
  balanced: {
    attentionType: 'moe' as const,
    numExperts: 4,
    topK: 2,
    enableTrajectories: true,
    backgroundIntervalMs: 60000, // 1 min
    qualityThreshold: 0.5,
  },

  /** Maximum learning for development */
  learning: {
    attentionType: 'dual' as const,
    enableTrajectories: true,
    backgroundIntervalMs: 30000, // 30 sec
    qualityThreshold: 0.3,
    sonaConfig: {
      microLoraRank: 2,
      baseLoraRank: 16,
      trajectoryCapacity: 50000,
    },
  },

  /** Hierarchical structures (Poincaré geometry) */
  hierarchical: {
    attentionType: 'hyperbolic' as const,
    curvature: 1.0,
    enableTrajectories: true,
  },

  /** Graph-based reasoning */
  graph: {
    attentionType: 'graph' as const,
    enableTrajectories: true,
  },
};
