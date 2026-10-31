/**
 * SONA Service - Self-Optimizing Neural Architecture
 *
 * Production implementation based on vibecast test-ruvector-sona patterns
 * Achieves +55.3% quality improvement with optimal configuration
 *
 * Key Performance Metrics:
 * - 2211 ops/sec throughput
 * - 18.07ms total overhead (40 layers)
 * - 0.452ms per-layer cost
 * - Sub-millisecond token latency
 *
 * Based on: https://github.com/ruvnet/vibecast/tree/claude/test-ruvector-sona-01Raj3Q3P4qjff4JGVipJhvz
 */

import { EventEmitter } from 'events';
import { pathToFileURL } from 'url';
import { requireSonaEngine } from './sona-loader.js';

/**
 * SONA Configuration Profiles
 */
export type SONAProfile = 'real-time' | 'batch' | 'research' | 'edge' | 'balanced' | 'custom';

export interface SONAConfig {
  profile?: SONAProfile;

  // Model dimensions
  hiddenDim: number;          // Must match model dimensions (e.g., 3072 for Phi-4)
  embeddingDim: number;       // Embedding dimension (e.g., 1536 for OpenAI)

  // LoRA configuration
  microLoraRank: number;      // Rank-2 is faster than rank-1 (SIMD optimization)
  baseLoraRank: number;       // Base LoRA rank (4, 8, 16)
  microLoraLr: number;        // Learning rate: 0.002 is sweet spot
  baseLoraLr: number;         // Base learning rate

  // EWC++ (Elastic Weight Consolidation)
  ewcLambda: number;          // 2000-2500 prevents catastrophic forgetting

  // Pattern clustering
  patternClusters: number;    // 100 clusters: breakpoint for latency (3.0ms → 1.3ms)

  // Trajectory management
  trajectoryCapacity: number; // Trigger forceLearn() at 80% utilization
  backgroundIntervalMs: number;
  qualityThreshold: number;   // 0.2-0.4 for optimal learning

  // Performance
  enableSimd: boolean;        // +10% performance acceleration
}

export interface TrajectoryMetadata {
  id: string;
  embedding: number[];
  route?: string;            // LLM model used (e.g., 'claude-sonnet-4-5')
  contexts: string[];        // Context IDs
  steps: TrajectoryStep[];
  startTime: number;
  endTime?: number;
  qualityScore?: number;
}

export interface TrajectoryStep {
  activations: number[];
  attentionWeights: number[];
  reward: number;
  timestamp: number;
}

export interface PatternMatch {
  id: string;
  centroid: number[];
  clusterSize: number;
  avgQuality: number;
  patternType: string;
  similarity: number;
}

/**
 * SONA Service - Main orchestration class
 */
export class SONAService extends EventEmitter {
  private engine: any; // SonaEngine from the optional @ruvector/sona
  private config: SONAConfig;
  private trajectories: Map<string, TrajectoryMetadata>;
  private stats: {
    totalTrajectories: number;
    activeTrajectories: number;
    completedTrajectories: number;
    totalLearningCycles: number;
    avgQualityScore: number;
    totalOpsProcessed: number;
  };

  constructor(config?: Partial<SONAConfig>) {
    super();

    // Apply profile or custom config
    this.config = this.resolveConfig(config);

    // Initialize SONA engine (throws SonaUnavailableError without @ruvector/sona)
    this.engine = requireSonaEngine().withConfig({
      hiddenDim: this.config.hiddenDim,
      embeddingDim: this.config.embeddingDim,
      microLoraRank: this.config.microLoraRank,
      baseLoraRank: this.config.baseLoraRank,
      microLoraLr: this.config.microLoraLr,
      baseLoraLr: this.config.baseLoraLr,
      ewcLambda: this.config.ewcLambda,
      patternClusters: this.config.patternClusters,
      trajectoryCapacity: this.config.trajectoryCapacity,
      backgroundIntervalMs: this.config.backgroundIntervalMs,
      qualityThreshold: this.config.qualityThreshold,
      enableSimd: this.config.enableSimd
    });

    this.trajectories = new Map();
    this.stats = {
      totalTrajectories: 0,
      activeTrajectories: 0,
      completedTrajectories: 0,
      totalLearningCycles: 0,
      avgQualityScore: 0,
      totalOpsProcessed: 0
    };

    this.emit('sona:initialized', { config: this.config });
  }

  /**
   * Resolve configuration from profile or custom settings
   */
  private resolveConfig(config?: Partial<SONAConfig>): SONAConfig {
    const profile = config?.profile || 'balanced';

    // Profile-based configurations (from vibecast KEY_FINDINGS.md)
    const profiles: Record<SONAProfile, Partial<SONAConfig>> = {
      // Real-Time: Rank-2, 25 clusters, 0.7 threshold → 2200 ops/sec, <0.5ms
      'real-time': {
        hiddenDim: 3072,
        embeddingDim: 1536,
        microLoraRank: 2,
        baseLoraRank: 4,
        microLoraLr: 0.001,
        baseLoraLr: 0.0001,
        ewcLambda: 1000,
        patternClusters: 25,
        trajectoryCapacity: 1000,
        backgroundIntervalMs: 3600000,
        qualityThreshold: 0.7,
        enableSimd: true
      },

      // Batch Processing: Rank-2, rank-8, 5000 capacity
      'batch': {
        hiddenDim: 3072,
        embeddingDim: 1536,
        microLoraRank: 2,
        baseLoraRank: 8,
        microLoraLr: 0.002,
        baseLoraLr: 0.0001,
        ewcLambda: 2000,
        patternClusters: 50,
        trajectoryCapacity: 5000,
        backgroundIntervalMs: 1800000,
        qualityThreshold: 0.4,
        enableSimd: true
      },

      // Research/Fine-Tuning: Rank-2 micro, rank-16 base, LR 0.002, threshold 0.2
      // Maximum Quality: +55% improvement
      'research': {
        hiddenDim: 3072,
        embeddingDim: 1536,
        microLoraRank: 2,
        baseLoraRank: 16,
        microLoraLr: 0.002,  // Sweet spot for quality gains
        baseLoraLr: 0.0001,
        ewcLambda: 2500,
        patternClusters: 100,
        trajectoryCapacity: 10000,
        backgroundIntervalMs: 900000,
        qualityThreshold: 0.2,  // Learn from more data
        enableSimd: true
      },

      // Edge/Mobile: Rank-1, 200 capacity, 15 clusters → <5MB memory
      'edge': {
        hiddenDim: 768,
        embeddingDim: 384,
        microLoraRank: 1,
        baseLoraRank: 2,
        microLoraLr: 0.001,
        baseLoraLr: 0.0001,
        ewcLambda: 1000,
        patternClusters: 15,
        trajectoryCapacity: 200,
        backgroundIntervalMs: 7200000,
        qualityThreshold: 0.5,
        enableSimd: false
      },

      // Balanced: Rank-2, rank-8, 0.4 threshold → 18ms, +25% quality
      'balanced': {
        hiddenDim: 3072,
        embeddingDim: 1536,
        microLoraRank: 2,
        baseLoraRank: 8,
        microLoraLr: 0.002,
        baseLoraLr: 0.0001,
        ewcLambda: 2000,
        patternClusters: 50,
        trajectoryCapacity: 5000,
        backgroundIntervalMs: 1800000,
        qualityThreshold: 0.4,
        enableSimd: true
      },

      // Custom: User-provided configuration
      'custom': {}
    };

    const profileConfig = profiles[profile];

    return {
      hiddenDim: 3072,
      embeddingDim: 1536,
      microLoraRank: 2,
      baseLoraRank: 8,
      microLoraLr: 0.002,
      baseLoraLr: 0.0001,
      ewcLambda: 2000,
      patternClusters: 50,
      trajectoryCapacity: 5000,
      backgroundIntervalMs: 1800000,
      qualityThreshold: 0.4,
      enableSimd: true,
      ...profileConfig,
      ...config
    };
  }

  /**
   * Begin a new trajectory
   */
  beginTrajectory(embedding: number[], route?: string): string {
    const numericId = this.engine.beginTrajectory(embedding);
    const id = String(numericId);

    const metadata: TrajectoryMetadata = {
      id,
      embedding,
      route,
      contexts: [],
      steps: [],
      startTime: Date.now()
    };

    this.trajectories.set(id, metadata);
    this.stats.totalTrajectories++;
    this.stats.activeTrajectories++;

    if (route) {
      this.engine.setTrajectoryRoute(numericId, route);
    }

    this.emit('trajectory:begin', { id, route });

    return id;
  }

  /**
   * Add a step to an active trajectory
   */
  addTrajectoryStep(
    trajectoryId: string,
    activations: number[],
    attentionWeights: number[],
    reward: number
  ): void {
    const metadata = this.trajectories.get(trajectoryId);
    if (!metadata) {
      throw new Error(`Trajectory ${trajectoryId} not found`);
    }

    this.engine.addTrajectoryStep(Number(trajectoryId), activations, attentionWeights, reward);

    metadata.steps.push({
      activations,
      attentionWeights,
      reward,
      timestamp: Date.now()
    });

    this.emit('trajectory:step', { trajectoryId, step: metadata.steps.length });
  }

  /**
   * Add context to a trajectory
   */
  addTrajectoryContext(trajectoryId: string, contextId: string): void {
    const metadata = this.trajectories.get(trajectoryId);
    if (!metadata) {
      throw new Error(`Trajectory ${trajectoryId} not found`);
    }

    this.engine.addTrajectoryContext(Number(trajectoryId), contextId);
    metadata.contexts.push(contextId);

    this.emit('trajectory:context', { trajectoryId, contextId });
  }

  /**
   * End a trajectory with quality score
   */
  endTrajectory(trajectoryId: string, qualityScore: number): void {
    const metadata = this.trajectories.get(trajectoryId);
    if (!metadata) {
      throw new Error(`Trajectory ${trajectoryId} not found`);
    }

    this.engine.endTrajectory(Number(trajectoryId), qualityScore);

    metadata.endTime = Date.now();
    metadata.qualityScore = qualityScore;

    this.stats.activeTrajectories--;
    this.stats.completedTrajectories++;
    this.stats.avgQualityScore =
      (this.stats.avgQualityScore * (this.stats.completedTrajectories - 1) + qualityScore) /
      this.stats.completedTrajectories;

    this.emit('trajectory:end', {
      trajectoryId,
      qualityScore,
      duration: metadata.endTime - metadata.startTime,
      steps: metadata.steps.length
    });

    // Check if we should trigger learning
    this.checkLearningTrigger();
  }

  /**
   * Apply Micro-LoRA to input
   */
  applyMicroLora(input: number[]): number[] {
    const output = this.engine.applyMicroLora(input);
    this.stats.totalOpsProcessed++;
    return output;
  }

  /**
   * Apply Base-LoRA to layer
   */
  applyBaseLora(layerIndex: number, input: number[]): number[] {
    const output = this.engine.applyBaseLora(layerIndex, input);
    this.stats.totalOpsProcessed++;
    return output;
  }

  /**
   * Find similar patterns
   */
  findPatterns(query: number[], k: number = 3): PatternMatch[] {
    // Route with k=3 patterns for 761 decisions/sec throughput (from KEY_FINDINGS)
    const patterns = this.engine.findPatterns(query, k);

    return patterns.map(p => ({
      id: p.id,
      centroid: p.centroid,
      clusterSize: p.clusterSize,
      avgQuality: p.avgQuality,
      patternType: p.patternType,
      similarity: this.calculateSimilarity(query, p.centroid)
    }));
  }

  /**
   * Calculate cosine similarity between vectors
   */
  private calculateSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magA * magB);
  }

  /**
   * Force learning cycle
   */
  forceLearn(): { success: boolean; patternsLearned: number } {
    const status = this.engine.forceLearn();
    this.stats.totalLearningCycles++;

    this.emit('learning:cycle', { status });

    return {
      success: true,
      patternsLearned: this.engine.getStats().split('\n').length
    };
  }

  /**
   * Check if learning should be triggered
   * Trigger forceLearn() when 80% of trajectory capacity is full
   */
  private checkLearningTrigger(): void {
    const utilizationThreshold = 0.8;
    const currentUtilization = this.stats.activeTrajectories / this.config.trajectoryCapacity;

    if (currentUtilization >= utilizationThreshold) {
      this.emit('learning:trigger', {
        utilization: currentUtilization,
        threshold: utilizationThreshold
      });
      this.forceLearn();
    }
  }

  /**
   * Tick for scheduled learning
   */
  tick(): void {
    this.engine.tick();
  }

  /**
   * Get engine statistics
   */
  getEngineStats(): string {
    return this.engine.getStats();
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      config: this.config,
      engineEnabled: this.engine.isEnabled(),
      trajectoryUtilization: this.stats.activeTrajectories / this.config.trajectoryCapacity,
      avgTrajectoryDuration: this.calculateAvgTrajectoryDuration(),
      opsPerSecond: this.calculateOpsPerSecond()
    };
  }

  /**
   * Calculate average trajectory duration
   */
  private calculateAvgTrajectoryDuration(): number {
    let totalDuration = 0;
    let count = 0;

    for (const trajectory of this.trajectories.values()) {
      if (trajectory.endTime) {
        totalDuration += trajectory.endTime - trajectory.startTime;
        count++;
      }
    }

    return count > 0 ? totalDuration / count : 0;
  }

  /**
   * Calculate operations per second
   */
  private calculateOpsPerSecond(): number {
    // Simple estimation based on total ops and service uptime
    // In production, use a sliding window
    return this.stats.totalOpsProcessed / ((Date.now() - this.stats.totalTrajectories) / 1000);
  }

  /**
   * Enable/disable engine
   */
  setEnabled(enabled: boolean): void {
    this.engine.setEnabled(enabled);
    this.emit('engine:enabled', { enabled });
  }

  /**
   * Check if engine is enabled
   */
  isEnabled(): boolean {
    return this.engine.isEnabled();
  }

  /**
   * Flush engine state
   */
  flush(): void {
    this.engine.flush();
    this.emit('engine:flushed');
  }

  /**
   * Get trajectory metadata
   */
  getTrajectory(trajectoryId: string): TrajectoryMetadata | undefined {
    return this.trajectories.get(trajectoryId);
  }

  /**
   * Get all active trajectories
   */
  getActiveTrajectories(): TrajectoryMetadata[] {
    return Array.from(this.trajectories.values()).filter(t => !t.endTime);
  }
}

/**
 * Singleton SONA service instances for different use cases. Each engine is
 * created on first access, so importing this module neither allocates five
 * native engines nor requires @ruvector/sona.
 */
const profileInstances = new Map<SONAProfile, SONAService>();

function profileService(profile: SONAProfile): SONAService {
  let service = profileInstances.get(profile);
  if (!service) {
    service = new SONAService({ profile });
    profileInstances.set(profile, service);
  }
  return service;
}

export const sonaServices: {
  readonly realtime: SONAService;
  readonly batch: SONAService;
  readonly research: SONAService;
  readonly edge: SONAService;
  readonly balanced: SONAService;
} = {
  get realtime() { return profileService('real-time'); },
  get batch() { return profileService('batch'); },
  get research() { return profileService('research'); },
  get edge() { return profileService('edge'); },
  get balanced() { return profileService('balanced'); }
};

/**
 * Default SONA service (balanced profile), created on first use.
 */
export const sonaService: SONAService = new Proxy({} as SONAService, {
  get(_target, prop) {
    const service = sonaServices.balanced;
    const value = Reflect.get(service, prop, service);
    return typeof value === 'function' ? value.bind(service) : value;
  },
  set(_target, prop, value) {
    return Reflect.set(sonaServices.balanced, prop, value);
  },
  has(_target, prop) {
    return prop in sonaServices.balanced;
  },
  getPrototypeOf() {
    return SONAService.prototype;
  }
});

/**
 * Convenience function to create custom SONA service
 */
export function createSONAService(config?: Partial<SONAConfig>): SONAService {
  return new SONAService(config);
}

/**
 * Example usage based on vibecast sona.test.js patterns
 */
export async function exampleUsage() {
  console.log('🧠 SONA Service Example\n');

  // Use balanced profile service
  const sona = sonaService;

  // Example 1: Begin trajectory
  const embedding = Array.from({ length: 1536 }, () => Math.random());
  const trajectoryId = sona.beginTrajectory(embedding, 'claude-sonnet-4-5');
  console.log(`Started trajectory: ${trajectoryId}`);

  // Example 2: Add steps
  for (let i = 0; i < 5; i++) {
    const activations = Array.from({ length: 3072 }, () => Math.random());
    const attentionWeights = Array.from({ length: 40 }, () => Math.random());
    const reward = 0.8 + Math.random() * 0.2;

    sona.addTrajectoryStep(trajectoryId, activations, attentionWeights, reward);
  }

  // Example 3: Add context
  sona.addTrajectoryContext(trajectoryId, 'task-code-review');

  // Example 4: End trajectory
  sona.endTrajectory(trajectoryId, 0.92);

  // Example 5: Find patterns
  const query = Array.from({ length: 1536 }, () => Math.random());
  const patterns = sona.findPatterns(query, 3);
  console.log(`\nFound ${patterns.length} similar patterns:`);
  patterns.forEach((p, i) => {
    console.log(`  ${i + 1}. Quality: ${p.avgQuality.toFixed(2)}, Similarity: ${p.similarity.toFixed(3)}`);
  });

  // Example 6: Apply LoRA
  const input = Array.from({ length: 3072 }, () => Math.random());
  const output = sona.applyMicroLora(input);
  console.log(`\nApplied Micro-LoRA to ${input.length}D vector`);

  // Example 7: Statistics
  const stats = sona.getStats();
  console.log('\nSONA Statistics:');
  console.log(`  Total Trajectories: ${stats.totalTrajectories}`);
  console.log(`  Completed: ${stats.completedTrajectories}`);
  console.log(`  Avg Quality: ${stats.avgQualityScore.toFixed(2)}`);
  console.log(`  Total Ops: ${stats.totalOpsProcessed}`);
  console.log(`  Capacity Utilization: ${(stats.trajectoryUtilization * 100).toFixed(1)}%`);
}

// Auto-run example if executed directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exampleUsage().catch(console.error);
}
