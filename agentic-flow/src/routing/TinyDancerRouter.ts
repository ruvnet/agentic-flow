/**
 * TinyDancer Router - FastGRNN-based Neural Agent Routing
 *
 * Status: experimental and not wired into any agentic-flow call path or
 * package export.
 *
 * What it actually does today: weighted cosine-similarity routing over the
 * registered agent embeddings, with reward-based weight updates
 * (recordOutcome) and a score-gap uncertainty estimate.
 *
 * The native path below targets an older, unpublished @ruvector/tiny-dancer
 * API (Router({embeddingDim}), CircuitBreaker, isAvailable). The published
 * package (0.1.x) exposes Router({modelPath}) with a built-in circuit breaker
 * (circuitBreakerStatus()) and requires a trained FastGRNN model. Without one,
 * native construction fails and every call uses the cosine fallback. There
 * is no circuit breaker in this wrapper.
 */

import { logger } from '../utils/logger.js';

// TinyDancer module state
let tinyDancerModule: TinyDancerModule | null = null;
let initialized = false;

/**
 * TinyDancer module interface (from @ruvector/tiny-dancer)
 */
interface TinyDancerModule {
  // Router class
  Router: new (config?: RouterConfig) => TinyDancerRouterInstance;
  // Utility functions
  isAvailable: () => boolean;
  getVersion: () => string;
  // Circuit breaker
  CircuitBreaker: new (config?: CircuitBreakerConfig) => CircuitBreakerInstance;
}

interface RouterConfig {
  modelPath?: string;
  embeddingDim?: number;
  hiddenSize?: number;
  numAgents?: number;
  temperature?: number;
  enableUncertainty?: boolean;
}

interface TinyDancerRouterInstance {
  route(embedding: Float32Array): Promise<RouteResult>;
  routeBatch(embeddings: Float32Array[]): Promise<RouteResult[]>;
  getUncertainty(embedding: Float32Array): Promise<number>;
  updateWeights(agentId: string, reward: number): void;
  hotReload(modelPath: string): Promise<void>;
  getMetrics(): RouterMetrics;
  shutdown(): Promise<void>;
}

interface CircuitBreakerConfig {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  halfOpenRequests?: number;
}

interface CircuitBreakerInstance {
  execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T>;
  getState(): 'closed' | 'open' | 'half-open';
  reset(): void;
  getMetrics(): { failures: number; successes: number; state: string };
}

export interface RouteResult {
  agentId: string;
  confidence: number;
  uncertainty?: number;
  alternatives?: Array<{ agentId: string; confidence: number }>;
  latencyMs: number;
}

export interface RouterMetrics {
  totalRoutes: number;
  avgLatencyMs: number;
  uncertaintyDistribution: { low: number; medium: number; high: number };
  agentDistribution: Map<string, number>;
}

export interface TinyDancerConfig {
  /** Embedding dimension (default: 384 for all-MiniLM-L6-v2) */
  embeddingDim?: number;
  /** Number of agents to route to */
  numAgents?: number;
  /** Temperature for softmax (lower = more confident) */
  temperature?: number;
  /** Enable uncertainty estimation */
  enableUncertainty?: boolean;
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold?: number;
  /** Fallback agent when circuit opens */
  fallbackAgent?: string;
}

/**
 * Initialize TinyDancer module
 */
export async function initTinyDancer(): Promise<boolean> {
  if (initialized) return tinyDancerModule !== null;

  try {
    const mod = await import('@ruvector/tiny-dancer');
    tinyDancerModule = mod as unknown as TinyDancerModule;
    initialized = true;

    if (tinyDancerModule.isAvailable?.()) {
      logger.info('TinyDancer initialized', {
        version: tinyDancerModule.getVersion?.() || 'unknown',
        features: ['FastGRNN', 'CircuitBreaker', 'Uncertainty'],
      });
      return true;
    }

    logger.debug('TinyDancer available but not fully functional');
    return true;
  } catch (error) {
    logger.debug('TinyDancer not available, using fallback routing', { error });
    initialized = true;
    return false;
  }
}

/**
 * Check if TinyDancer is available
 */
export function isTinyDancerAvailable(): boolean {
  return tinyDancerModule !== null && (tinyDancerModule.isAvailable?.() ?? false);
}

/**
 * TinyDancer Router - Neural agent routing with circuit breaker
 */
export class TinyDancerRouter {
  private config: Required<TinyDancerConfig>;
  private nativeRouter: TinyDancerRouterInstance | null = null;
  private circuitBreaker: CircuitBreakerInstance | null = null;

  // Fallback state (when TinyDancer unavailable)
  private agentWeights: Map<string, number> = new Map();
  private routingHistory: Array<{ agentId: string; success: boolean; timestamp: number }> = [];

  // Metrics
  private totalRoutes = 0;
  private totalLatencyMs = 0;
  private uncertaintyCounts = { low: 0, medium: 0, high: 0 };

  // Agent registry
  private agents: Map<string, { embedding: Float32Array; capabilities: string[] }> = new Map();

  constructor(config?: TinyDancerConfig) {
    this.config = {
      embeddingDim: config?.embeddingDim ?? 384,
      numAgents: config?.numAgents ?? 10,
      temperature: config?.temperature ?? 1.0,
      enableUncertainty: config?.enableUncertainty ?? true,
      circuitBreakerThreshold: config?.circuitBreakerThreshold ?? 5,
      fallbackAgent: config?.fallbackAgent ?? 'general',
    };

    this.initializeNative();
  }

  /**
   * Initialize native TinyDancer router
   */
  private async initializeNative(): Promise<void> {
    if (!initialized) {
      await initTinyDancer();
    }

    if (tinyDancerModule) {
      try {
        // Create native router
        this.nativeRouter = new tinyDancerModule.Router({
          embeddingDim: this.config.embeddingDim,
          numAgents: this.config.numAgents,
          temperature: this.config.temperature,
          enableUncertainty: this.config.enableUncertainty,
        });

        // Create circuit breaker
        this.circuitBreaker = new tinyDancerModule.CircuitBreaker({
          failureThreshold: this.config.circuitBreakerThreshold,
          successThreshold: 3,
          timeout: 30000,
          halfOpenRequests: 1,
        });

        logger.debug('TinyDancer native router initialized');
      } catch (error) {
        logger.warn('Failed to create native TinyDancer router', { error });
      }
    }
  }

  /**
   * Register an agent for routing
   */
  registerAgent(agentId: string, embedding: Float32Array | number[], capabilities: string[]): void {
    const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
    this.agents.set(agentId, { embedding: vec, capabilities });
    this.agentWeights.set(agentId, 1.0);
  }

  /**
   * Route task to best agent
   *
   * Uses FastGRNN neural routing if available, falls back to
   * cosine similarity matching otherwise.
   *
   * @param taskEmbedding - Embedding of the task description
   * @returns Route result with selected agent and confidence
   */
  async route(taskEmbedding: Float32Array | number[]): Promise<RouteResult> {
    const startTime = performance.now();
    const vec = taskEmbedding instanceof Float32Array ? taskEmbedding : new Float32Array(taskEmbedding);

    let result: RouteResult;

    // Try native router with circuit breaker
    if (this.nativeRouter && this.circuitBreaker) {
      try {
        result = await this.circuitBreaker.execute(
          async () => this.nativeRouter!.route(vec),
          () => this.fallbackRoute(vec) // Fallback when circuit opens
        );
      } catch (error) {
        logger.warn('Native routing failed, using fallback', { error });
        result = this.fallbackRoute(vec);
      }
    } else {
      result = this.fallbackRoute(vec);
    }

    // Update metrics
    this.totalRoutes++;
    const latency = performance.now() - startTime;
    this.totalLatencyMs += latency;
    result.latencyMs = latency;

    // Track uncertainty distribution
    if (result.uncertainty !== undefined) {
      if (result.uncertainty < 0.3) this.uncertaintyCounts.low++;
      else if (result.uncertainty < 0.7) this.uncertaintyCounts.medium++;
      else this.uncertaintyCounts.high++;
    }

    return result;
  }

  /**
   * Route multiple tasks in batch (parallel processing)
   */
  async routeBatch(taskEmbeddings: Float32Array[]): Promise<RouteResult[]> {
    if (this.nativeRouter) {
      try {
        return await this.nativeRouter.routeBatch(taskEmbeddings);
      } catch (error) {
        logger.warn('Batch routing failed, falling back to sequential', { error });
      }
    }

    // Sequential fallback
    return Promise.all(taskEmbeddings.map((e) => this.route(e)));
  }

  /**
   * Get uncertainty estimate for a task
   */
  async getUncertainty(taskEmbedding: Float32Array): Promise<number> {
    if (this.nativeRouter) {
      try {
        return await this.nativeRouter.getUncertainty(taskEmbedding);
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback: estimate uncertainty from agent similarity spread
    const similarities = this.computeSimilarities(taskEmbedding);
    if (similarities.length < 2) return 0.5;

    // High variance in similarities = low uncertainty
    const mean = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    const variance = similarities.reduce((a, s) => a + Math.pow(s - mean, 2), 0) / similarities.length;

    // Convert variance to uncertainty (low variance = high uncertainty)
    return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 2));
  }

  /**
   * Record routing outcome for learning
   */
  recordOutcome(agentId: string, success: boolean, reward: number = success ? 1 : -1): void {
    // Update native router weights
    if (this.nativeRouter) {
      try {
        this.nativeRouter.updateWeights(agentId, reward);
      } catch {
        // Fall through to fallback
      }
    }

    // Update fallback weights
    const currentWeight = this.agentWeights.get(agentId) ?? 1.0;
    const learningRate = 0.1;
    const newWeight = currentWeight + learningRate * reward;
    this.agentWeights.set(agentId, Math.max(0.1, Math.min(10, newWeight)));

    // Track history (keep last 100)
    this.routingHistory.push({ agentId, success, timestamp: Date.now() });
    if (this.routingHistory.length > 100) {
      this.routingHistory.shift();
    }
  }

  /**
   * Hot-reload model without restart
   */
  async hotReload(modelPath: string): Promise<void> {
    if (this.nativeRouter) {
      await this.nativeRouter.hotReload(modelPath);
      logger.info('TinyDancer model hot-reloaded', { modelPath });
    }
  }

  /**
   * Get routing metrics
   */
  getMetrics(): RouterMetrics {
    if (this.nativeRouter) {
      try {
        return this.nativeRouter.getMetrics();
      } catch {
        // Fall through to computed metrics
      }
    }

    // Compute agent distribution from history
    const agentDistribution = new Map<string, number>();
    for (const entry of this.routingHistory) {
      agentDistribution.set(entry.agentId, (agentDistribution.get(entry.agentId) ?? 0) + 1);
    }

    return {
      totalRoutes: this.totalRoutes,
      avgLatencyMs: this.totalRoutes > 0 ? this.totalLatencyMs / this.totalRoutes : 0,
      uncertaintyDistribution: { ...this.uncertaintyCounts },
      agentDistribution,
    };
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): 'closed' | 'open' | 'half-open' | 'unknown' {
    if (this.circuitBreaker) {
      return this.circuitBreaker.getState();
    }
    return 'unknown';
  }

  /**
   * Reset circuit breaker
   */
  resetCircuit(): void {
    if (this.circuitBreaker) {
      this.circuitBreaker.reset();
    }
  }

  /**
   * Check if using native TinyDancer
   */
  isNative(): boolean {
    return this.nativeRouter !== null;
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    if (this.nativeRouter) {
      await this.nativeRouter.shutdown();
    }
    this.agents.clear();
    this.agentWeights.clear();
    this.routingHistory = [];
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  /**
   * Fallback routing using cosine similarity
   */
  private fallbackRoute(taskEmbedding: Float32Array): RouteResult {
    if (this.agents.size === 0) {
      return {
        agentId: this.config.fallbackAgent,
        confidence: 0.5,
        uncertainty: 0.5,
        latencyMs: 0,
      };
    }

    // Compute weighted similarities
    const scores: Array<{ agentId: string; score: number }> = [];

    for (const [agentId, data] of this.agents) {
      const similarity = this.cosineSimilarity(taskEmbedding, data.embedding);
      const weight = this.agentWeights.get(agentId) ?? 1.0;
      scores.push({
        agentId,
        score: similarity * weight,
      });
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Apply temperature for softmax-like selection
    const topScore = scores[0].score;
    const temperature = this.config.temperature;

    // Compute softmax probabilities
    const expScores = scores.map((s) => Math.exp((s.score - topScore) / temperature));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const probs = expScores.map((e) => e / sumExp);

    // Select based on probability (deterministic for top-1)
    const selected = scores[0];
    const confidence = probs[0];

    // Estimate uncertainty from score distribution
    const uncertainty = this.estimateUncertaintyFromScores(scores.map((s) => s.score));

    return {
      agentId: selected.agentId,
      confidence,
      uncertainty,
      alternatives: scores.slice(1, 4).map((s, i) => ({
        agentId: s.agentId,
        confidence: probs[i + 1],
      })),
      latencyMs: 0,
    };
  }

  /**
   * Compute similarities to all agents
   */
  private computeSimilarities(taskEmbedding: Float32Array): number[] {
    const similarities: number[] = [];
    for (const [, data] of this.agents) {
      similarities.push(this.cosineSimilarity(taskEmbedding, data.embedding));
    }
    return similarities;
  }

  /**
   * Estimate uncertainty from score distribution
   */
  private estimateUncertaintyFromScores(scores: number[]): number {
    if (scores.length < 2) return 0.5;

    // Uncertainty is high when scores are similar
    const maxScore = Math.max(...scores);
    const secondMaxScore = scores.filter((s) => s !== maxScore).reduce((a, b) => Math.max(a, b), 0);

    // Large gap = low uncertainty
    const gap = maxScore - secondMaxScore;
    return Math.max(0, Math.min(1, 1 - gap * 2));
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

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dot / denominator;
  }
}

/**
 * Singleton instance for global access
 */
let globalRouter: TinyDancerRouter | null = null;

/**
 * Get global TinyDancer router instance
 */
export function getTinyDancerRouter(config?: TinyDancerConfig): TinyDancerRouter {
  if (!globalRouter) {
    globalRouter = new TinyDancerRouter(config);
  }
  return globalRouter;
}

/**
 * Reset global router (for testing)
 */
export async function resetTinyDancerRouter(): Promise<void> {
  if (globalRouter) {
    await globalRouter.shutdown();
    globalRouter = null;
  }
}

export default {
  TinyDancerRouter,
  getTinyDancerRouter,
  resetTinyDancerRouter,
  initTinyDancer,
  isTinyDancerAvailable,
};
