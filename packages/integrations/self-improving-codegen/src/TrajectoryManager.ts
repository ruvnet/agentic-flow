/**
 * Manages storage and retrieval of code generation trajectories
 * Integrates with AgentDB for vector storage and ReasoningBank for learning
 */

import type { Trajectory, TrajectoryMetrics, LearningStats } from './types.js';

interface TrajectoryRecord {
  request: any;
  result: any;
  metrics: TrajectoryMetrics;
}

export class TrajectoryManager {
  private trajectories: Trajectory[] = [];
  private agentDB: any = null;
  private initialized = false;

  constructor() {
    // Will initialize AgentDB lazily
  }

  /**
   * Initialize AgentDB connection
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      // For now, use in-memory storage
      // In production, this would connect to AgentDB
      this.initialized = true;
    } catch (error) {
      console.warn('AgentDB not available, using in-memory storage');
      this.initialized = true;
    }
  }

  /**
   * Store a trajectory for learning
   */
  async storeTrajectory(record: TrajectoryRecord): Promise<string> {
    await this.ensureInitialized();

    const trajectory: Trajectory = {
      id: this.generateId(),
      timestamp: Date.now(),
      request: record.request,
      code: record.result.code,
      success: record.result.success,
      metrics: record.metrics,
      reward: this.calculateReward(record.result, record.metrics),
      verdict: this.determineVerdict(record.result, record.metrics)
    };

    this.trajectories.push(trajectory);

    // In production, store to AgentDB with vector embedding
    // await this.agentDB.store({
    //   id: trajectory.id,
    //   text: `${trajectory.request.prompt} | ${trajectory.code}`,
    //   metadata: trajectory
    // });

    return trajectory.id;
  }

  /**
   * Record manual feedback on a generation
   */
  async recordManualFeedback(data: {
    task: string;
    code: string;
    success: boolean;
    metrics: any;
  }): Promise<void> {
    await this.ensureInitialized();

    const trajectory: Trajectory = {
      id: this.generateId(),
      timestamp: Date.now(),
      request: {
        prompt: data.task,
        language: 'unknown'
      },
      code: data.code,
      success: data.success,
      metrics: data.metrics,
      reward: data.success ? 0.9 : 0.1,
      verdict: data.success ? 'success' : 'failure'
    };

    this.trajectories.push(trajectory);
  }

  /**
   * Get recent trajectories for pattern learning
   */
  async getRecentTrajectories(limit: number = 100): Promise<Trajectory[]> {
    await this.ensureInitialized();

    return this.trajectories
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get successful trajectories for a language
   */
  async getSuccessfulTrajectories(
    language: string,
    limit: number = 50
  ): Promise<Trajectory[]> {
    await this.ensureInitialized();

    return this.trajectories
      .filter(t => t.success && t.request.language === language)
      .sort((a, b) => b.reward - a.reward)
      .slice(0, limit);
  }

  /**
   * Search for similar trajectories
   */
  async searchSimilar(
    prompt: string,
    language: string,
    k: number = 5
  ): Promise<Trajectory[]> {
    await this.ensureInitialized();

    // Simple keyword-based search for now
    // In production, use AgentDB vector similarity search
    const keywords = prompt.toLowerCase().split(/\s+/);

    const scored = this.trajectories
      .filter(t => t.request.language === language && t.success)
      .map(t => ({
        trajectory: t,
        score: this.calculateSimilarity(t.request.prompt, keywords)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored.map(item => item.trajectory);
  }

  /**
   * Get learning statistics
   */
  async getStats(): Promise<LearningStats> {
    await this.ensureInitialized();

    const total = this.trajectories.length;
    const successful = this.trajectories.filter(t => t.success).length;
    const failed = total - successful;

    // Calculate quality improvement over time
    const qualityImprovement = this.calculateQualityTrend();

    // Calculate average latency
    const avgLatency = total > 0
      ? this.trajectories.reduce((sum, t) => sum + t.metrics.latency, 0) / total
      : 0;

    return {
      totalTrajectories: total,
      successCount: successful,
      failureCount: failed,
      successRate: total > 0 ? successful / total : 0,
      patternsLearned: this.countUniquePatterns(),
      qualityImprovement,
      avgLatency
    };
  }

  /**
   * Calculate reward signal based on quality metrics
   */
  private calculateReward(result: any, metrics: TrajectoryMetrics): number {
    let reward = 0.5; // Base reward

    // Success increases reward
    if (result.success) reward += 0.2;

    // High confidence increases reward
    reward += metrics.confidence * 0.2;

    // Quality metrics
    if (metrics.quality.syntaxValid) reward += 0.1;
    reward += (metrics.quality.maintainability / 100) * 0.1;
    reward += metrics.quality.bestPractices * 0.1;

    // Low latency increases reward
    if (metrics.latency < 10) reward += 0.05;

    // Tests passing
    if (metrics.testPassRate !== undefined) {
      reward += metrics.testPassRate * 0.15;
    }

    return Math.min(reward, 1.0);
  }

  /**
   * Determine verdict for trajectory
   */
  private determineVerdict(
    result: any,
    metrics: TrajectoryMetrics
  ): 'success' | 'failure' | 'partial' {
    if (!result.success) return 'failure';

    if (metrics.confidence > 0.8 && metrics.quality.syntaxValid) {
      return 'success';
    }

    if (metrics.confidence > 0.5 || metrics.quality.syntaxValid) {
      return 'partial';
    }

    return 'failure';
  }

  /**
   * Calculate similarity between prompt and keywords
   */
  private calculateSimilarity(prompt: string, keywords: string[]): number {
    const promptLower = prompt.toLowerCase();
    const matches = keywords.filter(kw => promptLower.includes(kw)).length;
    return keywords.length > 0 ? matches / keywords.length : 0;
  }

  /**
   * Calculate quality improvement trend
   */
  private calculateQualityTrend(): number {
    if (this.trajectories.length < 10) return 0;

    const sorted = [...this.trajectories].sort((a, b) => a.timestamp - b.timestamp);
    const firstBatch = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondBatch = sorted.slice(Math.floor(sorted.length / 2));

    const avgFirst = firstBatch.reduce((sum, t) => sum + t.reward, 0) / firstBatch.length;
    const avgSecond = secondBatch.reduce((sum, t) => sum + t.reward, 0) / secondBatch.length;

    return avgSecond - avgFirst;
  }

  /**
   * Count unique patterns in trajectories
   */
  private countUniquePatterns(): number {
    const patterns = new Set<string>();
    this.trajectories.forEach(t => {
      if (t.success) {
        patterns.add(`${t.request.language}:${t.request.prompt.substring(0, 50)}`);
      }
    });
    return patterns.size;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `traj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
