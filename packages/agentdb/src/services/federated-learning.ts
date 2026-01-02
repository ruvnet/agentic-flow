/**
 * Federated Learning Integration for SONA v0.1.4
 *
 * Provides distributed learning capabilities with WasmEphemeralAgent and WasmFederatedCoordinator
 */

import type { SonaEngine } from '@ruvector/sona';

/**
 * Federated agent state for synchronization
 */
export interface FederatedAgentState {
  agentId: string;
  embedding: Float32Array;
  quality: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Federated learning configuration
 */
export interface FederatedConfig {
  /** Agent identifier */
  agentId: string;

  /** Coordinator endpoint (for agents) or null (for coordinator) */
  coordinatorEndpoint?: string;

  /** Minimum quality threshold for aggregation */
  minQuality?: number;

  /** Aggregation interval in milliseconds */
  aggregationInterval?: number;

  /** Enable quality filtering */
  qualityFiltering?: boolean;

  /** Maximum agents to aggregate */
  maxAgents?: number;

  /** Maximum task history size per agent (default: 1000) */
  maxHistorySize?: number;
}

/**
 * Ephemeral agent for lightweight distributed learning
 *
 * Features:
 * - ~5MB footprint
 * - Local task processing
 * - State export for federation
 * - Quality-based filtering
 */
export class EphemeralLearningAgent {
  private agentId: string;
  private sonaEngine: SonaEngine | null = null;
  private taskHistory: Array<{ embedding: Float32Array; quality: number; timestamp: number }> = [];
  private config: FederatedConfig;

  constructor(config: FederatedConfig) {
    this.agentId = config.agentId;
    this.config = {
      minQuality: 0.7,
      qualityFiltering: true,
      maxAgents: 100,
      maxHistorySize: 1000,
      ...config
    };
  }

  /**
   * Initialize SONA engine with ephemeral preset
   */
  async initialize(sonaEngine: SonaEngine): Promise<void> {
    this.sonaEngine = sonaEngine;
    // SONA engine initialized with ephemeral config
  }

  /**
   * Process a task and update local learning state
   */
  async processTask(embedding: Float32Array, quality: number): Promise<void> {
    if (!this.sonaEngine) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    // Prevent memory leak by capping history size
    if (this.taskHistory.length >= (this.config.maxHistorySize || 1000)) {
      this.taskHistory.shift(); // Remove oldest
    }

    // Store in task history
    this.taskHistory.push({
      embedding,
      quality,
      timestamp: Date.now()
    });

    // Train SONA engine on task
    // In actual implementation, this would call SONA's training methods
    // For now, we track the task for later aggregation
  }

  /**
   * Export agent state for federation
   */
  exportState(): FederatedAgentState {
    if (this.taskHistory.length === 0) {
      throw new Error('No tasks processed yet');
    }

    // Filter by quality if enabled
    const validTasks = this.config.qualityFiltering
      ? this.taskHistory.filter(t => t.quality >= (this.config.minQuality || 0.7))
      : this.taskHistory;

    if (validTasks.length === 0) {
      throw new Error('No tasks meet quality threshold');
    }

    // Compute average embedding
    const avgEmbedding = this.computeAverageEmbedding(
      validTasks.map(t => t.embedding)
    );

    // Compute average quality
    const avgQuality = validTasks.reduce((sum, t) => sum + t.quality, 0) / validTasks.length;

    return {
      agentId: this.agentId,
      embedding: avgEmbedding,
      quality: avgQuality,
      timestamp: Date.now(),
      metadata: {
        taskCount: validTasks.length,
        totalTasks: this.taskHistory.length,
        minQuality: this.config.minQuality
      }
    };
  }

  /**
   * Import consolidated state from coordinator
   */
  async importState(state: FederatedAgentState): Promise<void> {
    if (!this.sonaEngine) {
      throw new Error('Agent not initialized');
    }

    // Update local model with consolidated state
    // This would integrate the federated learning into local SONA engine
  }

  /**
   * Clear task history (after successful aggregation)
   */
  clearHistory(): void {
    this.taskHistory = [];
  }

  /**
   * Get current task count
   */
  getTaskCount(): number {
    return this.taskHistory.length;
  }

  /**
   * Compute average embedding from multiple embeddings
   */
  private computeAverageEmbedding(embeddings: Float32Array[]): Float32Array {
    if (embeddings.length === 0) {
      throw new Error('No embeddings to average');
    }

    const dim = embeddings[0].length;
    const avg = new Float32Array(dim);

    for (const embedding of embeddings) {
      for (let i = 0; i < dim; i++) {
        avg[i] += embedding[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      avg[i] /= embeddings.length;
    }

    return avg;
  }
}

/**
 * Federated coordinator for central aggregation
 *
 * Features:
 * - Aggregate states from multiple agents
 * - Quality-based filtering
 * - Consolidated model distribution
 * - Scalable to hundreds of agents
 */
export class FederatedLearningCoordinator {
  private coordinatorId: string;
  private agentStates: Map<string, FederatedAgentState> = new Map();
  private consolidatedState: FederatedAgentState | null = null;
  private config: FederatedConfig;

  constructor(config: FederatedConfig) {
    this.coordinatorId = config.agentId;
    this.config = {
      minQuality: 0.7,
      qualityFiltering: true,
      maxAgents: 100,
      aggregationInterval: 60000, // 1 minute
      ...config
    };
  }

  /**
   * Aggregate state from an agent
   */
  async aggregate(state: FederatedAgentState): Promise<void> {
    // Validate quality threshold
    if (this.config.qualityFiltering && state.quality < (this.config.minQuality || 0.7)) {
      console.warn(`Agent ${state.agentId} state rejected: quality ${state.quality} below threshold`);
      return;
    }

    // Check max agents limit
    if (this.agentStates.size >= (this.config.maxAgents || 100)) {
      // Remove oldest state if at limit
      const oldestKey = Array.from(this.agentStates.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.agentStates.delete(oldestKey);
    }

    // Store agent state
    this.agentStates.set(state.agentId, state);
  }

  /**
   * Consolidate all agent states into unified model
   */
  async consolidate(): Promise<FederatedAgentState> {
    if (this.agentStates.size === 0) {
      throw new Error('No agent states to consolidate');
    }

    const states = Array.from(this.agentStates.values());

    // Compute weighted average based on quality
    const totalWeight = states.reduce((sum, s) => sum + s.quality, 0);
    const dim = states[0].embedding.length;
    const consolidatedEmbedding = new Float32Array(dim);

    for (const state of states) {
      const weight = state.quality / totalWeight;
      for (let i = 0; i < dim; i++) {
        consolidatedEmbedding[i] += state.embedding[i] * weight;
      }
    }

    // Compute average quality
    const avgQuality = states.reduce((sum, s) => sum + s.quality, 0) / states.length;

    this.consolidatedState = {
      agentId: this.coordinatorId,
      embedding: consolidatedEmbedding,
      quality: avgQuality,
      timestamp: Date.now(),
      metadata: {
        agentCount: states.length,
        minQuality: Math.min(...states.map(s => s.quality)),
        maxQuality: Math.max(...states.map(s => s.quality)),
        avgQuality
      }
    };

    return this.consolidatedState;
  }

  /**
   * Get consolidated state for distribution to agents
   */
  getConsolidatedState(): FederatedAgentState | null {
    return this.consolidatedState;
  }

  /**
   * Clear all agent states (after distribution)
   */
  clearStates(): void {
    this.agentStates.clear();
  }

  /**
   * Get number of aggregated agents
   */
  getAgentCount(): number {
    return this.agentStates.size;
  }

  /**
   * Get agent states summary
   */
  getSummary(): {
    agentCount: number;
    avgQuality: number;
    minQuality: number;
    maxQuality: number;
    consolidated: boolean;
  } {
    const states = Array.from(this.agentStates.values());

    if (states.length === 0) {
      return {
        agentCount: 0,
        avgQuality: 0,
        minQuality: 0,
        maxQuality: 0,
        consolidated: this.consolidatedState !== null
      };
    }

    return {
      agentCount: states.length,
      avgQuality: states.reduce((sum, s) => sum + s.quality, 0) / states.length,
      minQuality: Math.min(...states.map(s => s.quality)),
      maxQuality: Math.max(...states.map(s => s.quality)),
      consolidated: this.consolidatedState !== null
    };
  }
}

/**
 * Federated learning manager for coordinating multiple agents
 */
export class FederatedLearningManager {
  private coordinator: FederatedLearningCoordinator;
  private agents: Map<string, EphemeralLearningAgent> = new Map();
  private aggregationTimer: NodeJS.Timeout | null = null;

  constructor(config: FederatedConfig) {
    this.coordinator = new FederatedLearningCoordinator(config);
  }

  /**
   * Register a new agent
   */
  registerAgent(agentId: string, sonaEngine: SonaEngine): EphemeralLearningAgent {
    const agent = new EphemeralLearningAgent({
      agentId,
      minQuality: 0.7,
      qualityFiltering: true
    });

    agent.initialize(sonaEngine);
    this.agents.set(agentId, agent);

    return agent;
  }

  /**
   * Start automatic aggregation
   */
  startAggregation(intervalMs: number = 60000): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
    }

    this.aggregationTimer = setInterval(async () => {
      await this.aggregateAll();
    }, intervalMs);
    
    // Don't keep process alive if this is the only active handle
    this.aggregationTimer.unref();
  }

  /**
   * Stop automatic aggregation
   */
  stopAggregation(): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
  }

  /**
   * Aggregate all agent states
   */
  async aggregateAll(): Promise<void> {
    for (const [agentId, agent] of this.agents) {
      try {
        if (agent.getTaskCount() > 0) {
          const state = agent.exportState();
          await this.coordinator.aggregate(state);
          agent.clearHistory();
        }
      } catch (error) {
        console.error(`Failed to aggregate agent ${agentId}:`, error);
      }
    }

    // Consolidate if we have states
    if (this.coordinator.getAgentCount() > 0) {
      try {
        const consolidated = await this.coordinator.consolidate();

        // Distribute consolidated state to all agents
        for (const agent of this.agents.values()) {
          await agent.importState(consolidated);
        }

        this.coordinator.clearStates();
      } catch (error) {
        console.error('Failed to consolidate:', error);
      }
    }
  }

  /**
   * Get aggregation summary
   */
  getSummary() {
    return {
      coordinator: this.coordinator.getSummary(),
      agents: {
        count: this.agents.size,
        activeAgents: Array.from(this.agents.entries())
          .filter(([_, agent]) => agent.getTaskCount() > 0)
          .map(([id, agent]) => ({
            id,
            taskCount: agent.getTaskCount()
          }))
      }
    };
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopAggregation();
    this.agents.clear();
  }
}
