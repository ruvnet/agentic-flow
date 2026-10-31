/**
 * Autopilot Learning Bridge (ADR-058 v2)
 *
 * Bridges autopilot coordinator with AgentDB's ReflexionMemory,
 * LearningSystem, and SONA trajectory tracking. All methods
 * gracefully no-op when AgentDB/SONA are unavailable.
 *
 * ruflo loads this file by path (dist/coordination/autopilot-learning.js);
 * keep the path, the class name and the method signatures stable.
 */

export interface AutopilotEpisode {
  taskId: string;
  subject: string;
  status: string;
  iterations: number;
  durationMs: number;
  critique?: string;
  agentId?: string;
}

export interface ReEngagementContext {
  pastFailures: Array<{ task: string; critique?: string; reward: number }>;
  pastSuccesses: Array<{ task: string; reward: number }>;
  patterns: Array<{ pattern: string; frequency: number; avgReward: number }>;
  recommendations: string[];
  confidence: number;
}

export interface LearningMetrics {
  available: boolean;
  episodes: number;
  patterns: number;
  trajectories: number;
  sonaStats: { totalTrajectories: number; totalSteps: number; avgReward: number; patternsFound: number } | null;
}

export class AutopilotLearning {
  private agentDB: any = null;
  private sonaService: any = null;
  private available = false;
  private sonaAvailable = false;
  private trajectoryId: string | null = null;
  private episodeCount = 0;

  /**
   * Initialize by dynamically importing AgentDB and SONA services.
   * Returns true only when the real AgentDB backend is active. The service's
   * in-memory fallback does not persist across processes, so it does not
   * count as available.
   */
  async initialize(): Promise<boolean> {
    // Try AgentDB
    try {
      const { AgentDBService } = await import('../services/agentdb-service.js');
      const service = await AgentDBService.getInstance();
      this.available = service.getBackendName() === 'agentdb';
      this.agentDB = this.available ? service : null;
    } catch {
      this.agentDB = null;
      this.available = false;
    }

    // Try SONA
    try {
      const { SonaRvfService } = await import('../services/sona-rvf-service.js');
      this.sonaService = await SonaRvfService.getInstance();
      this.sonaAvailable = true;
    } catch {
      this.sonaAvailable = false;
    }

    return this.available;
  }

  /**
   * Check if learning subsystem is available.
   */
  isAvailable(): boolean {
    return this.available;
  }

  // -- Episode recording --

  /**
   * Record a successful task completion episode.
   */
  async recordTaskCompletion(episode: AutopilotEpisode): Promise<void> {
    if (!this.available || !this.agentDB) return;
    try {
      const reward = this.calculateReward(episode.iterations, episode.durationMs);
      await this.agentDB.storeEpisode({
        sessionId: episode.agentId || 'autopilot',
        task: `[COMPLETED] ${episode.subject}`,
        input: `taskId:${episode.taskId} iterations:${episode.iterations}`,
        output: `Completed in ${episode.durationMs}ms`,
        reward,
        success: true,
        tags: ['autopilot', 'completion'],
      });
      this.episodeCount++;
    } catch {
      // Silently fail — learning is optional
    }
  }

  /**
   * Record a task failure episode.
   */
  async recordTaskFailure(episode: AutopilotEpisode): Promise<void> {
    if (!this.available || !this.agentDB) return;
    try {
      const reward = -0.5;
      await this.agentDB.storeEpisode({
        sessionId: episode.agentId || 'autopilot',
        task: `[FAILED] ${episode.subject}`,
        input: `taskId:${episode.taskId} iterations:${episode.iterations}`,
        output: `Failed after ${episode.durationMs}ms`,
        critique: episode.critique || `Task moved to ${episode.status}`,
        reward,
        success: false,
        tags: ['autopilot', 'failure'],
      });
      this.episodeCount++;
    } catch {
      // Silently fail
    }
  }

  // -- History recall --

  /**
   * Recall similar tasks from past episodes.
   */
  async recallSimilarTasks(query: string, limit = 5): Promise<any[]> {
    if (!this.available || !this.agentDB) return [];
    try {
      return await this.agentDB.recallEpisodes(query, limit);
    } catch {
      return [];
    }
  }

  // -- Re-engagement context --

  /**
   * Build re-engagement context from past episodes and patterns.
   * Queries top 3 remaining tasks against ReflexionMemory.
   */
  async getReEngagementContext(tasks: Array<{ subject: string; status: string }>): Promise<ReEngagementContext> {
    const empty: ReEngagementContext = {
      pastFailures: [],
      pastSuccesses: [],
      patterns: [],
      recommendations: [],
      confidence: 0,
    };

    if (!this.available || !this.agentDB) return empty;

    try {
      const topTasks = tasks.slice(0, 3);
      const episodeArrays = await Promise.all(
        topTasks.map(task => this.agentDB.recallEpisodes(task.subject, 3)),
      );
      const allEpisodes: any[] = episodeArrays.flat();

      const pastFailures = allEpisodes
        .filter((ep: any) => !ep.success)
        .map((ep: any) => ({ task: ep.task, critique: ep.critique, reward: ep.reward }));

      const pastSuccesses = allEpisodes
        .filter((ep: any) => ep.success)
        .map((ep: any) => ({ task: ep.task, reward: ep.reward }));

      // Search for completion patterns
      let patterns: Array<{ pattern: string; frequency: number; avgReward: number }> = [];
      try {
        const searchResults = await this.agentDB.searchPatterns('swarm completion', 5);
        patterns = searchResults.map((p: any) => ({
          pattern: p.approach || p.taskType,
          frequency: p.uses || 1,
          avgReward: p.successRate || 0,
        }));
      } catch {
        // Patterns unavailable
      }

      // Generate recommendations
      const recommendations: string[] = [];

      if (pastFailures.length > 0) {
        const failReasons = pastFailures
          .filter((f) => f.critique)
          .map((f) => f.critique)
          .slice(0, 3);
        if (failReasons.length > 0) {
          recommendations.push(`Avoid previous failure patterns: ${failReasons.join('; ')}`);
        }
      }

      if (pastSuccesses.length > 0) {
        recommendations.push(`${pastSuccesses.length} similar tasks succeeded before — apply same approach`);
      }

      if (patterns.length > 0) {
        const bestPattern = patterns.sort((a, b) => b.avgReward - a.avgReward)[0];
        recommendations.push(`Best pattern: ${bestPattern.pattern} (success rate: ${Math.round(bestPattern.avgReward * 100)}%)`);
      }

      const confidence = allEpisodes.length > 0
        ? Math.min(allEpisodes.length / 10, 1)
        : 0;

      return { pastFailures, pastSuccesses, patterns, recommendations, confidence };
    } catch {
      return empty;
    }
  }

  // -- SONA trajectory --

  /**
   * Begin tracking a swarm lifecycle via SONA trajectory.
   */
  async beginSwarmTrajectory(_sessionId: string): Promise<void> {
    if (!this.sonaAvailable || !this.sonaService) return;
    try {
      const traj = this.sonaService.beginTrajectory();
      this.trajectoryId = traj.id;
    } catch {
      this.trajectoryId = null;
    }
  }

  /**
   * Record an iteration step in the SONA trajectory.
   */
  async recordIterationStep(
    state: { completed: number; total: number; iterations: number; progress: number },
    driftSignals: Array<{ type: string; severity: string }>,
  ): Promise<void> {
    if (!this.sonaAvailable || !this.sonaService || !this.trajectoryId) return;
    try {
      const stateStr = `iter:${state.iterations} progress:${Math.round(state.progress)}% completed:${state.completed}/${state.total}`;
      const actionStr = driftSignals.length > 0
        ? `drift:${driftSignals.map(s => s.type).join(',')}`
        : 'normal';
      const reward = state.total > 0 ? state.completed / state.total : 0;

      this.sonaService.addStep(this.trajectoryId, {
        state: stateStr,
        action: actionStr,
        reward,
      });
    } catch {
      // Silently fail
    }
  }

  /**
   * End the SONA trajectory and extract patterns.
   */
  async endSwarmTrajectory(finalState: { completed: number; total: number }): Promise<void> {
    if (!this.sonaAvailable || !this.sonaService || !this.trajectoryId) return;
    try {
      this.sonaService.endTrajectory(this.trajectoryId);
      this.trajectoryId = null;

      // Store completion pattern in AgentDB if available
      if (this.available && this.agentDB && finalState.total > 0) {
        const successRate = finalState.completed / finalState.total;
        await this.agentDB.storePattern({
          taskType: 'swarm-completion',
          approach: `completed ${finalState.completed}/${finalState.total} tasks`,
          successRate,
          tags: ['autopilot', 'trajectory'],
        });
      }
    } catch {
      // Silently fail
    }
  }

  // -- Pattern discovery and prediction --

  /**
   * Discover success patterns from past swarm completions.
   */
  async discoverSuccessPatterns(): Promise<any[]> {
    if (!this.available || !this.agentDB) return [];
    try {
      return await this.agentDB.searchPatterns('swarm completion', 10);
    } catch {
      return [];
    }
  }

  /**
   * Predict the next best action given current state.
   */
  async predictNextAction(state: any): Promise<any> {
    if (!this.available || !this.agentDB) {
      return { action: 'continue', confidence: 0, alternatives: [] };
    }
    try {
      const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
      return await this.agentDB.predictAction(stateStr);
    } catch {
      return { action: 'continue', confidence: 0, alternatives: [] };
    }
  }

  // -- Metrics --

  /**
   * Get learning subsystem metrics.
   */
  async getMetrics(): Promise<LearningMetrics> {
    const metrics: LearningMetrics = {
      available: this.available,
      episodes: this.episodeCount,
      patterns: 0,
      trajectories: 0,
      sonaStats: null,
    };

    if (this.available && this.agentDB) {
      try {
        const svcMetrics = await this.agentDB.getMetrics();
        metrics.episodes = svcMetrics.episodes || this.episodeCount;
        metrics.patterns = svcMetrics.patterns || 0;
      } catch {
        // Use defaults
      }
    }

    if (this.sonaAvailable && this.sonaService) {
      try {
        metrics.sonaStats = this.sonaService.getStats();
        metrics.trajectories = metrics.sonaStats?.totalTrajectories || 0;
      } catch {
        // Use defaults
      }
    }

    return metrics;
  }

  /**
   * Calculate reward for a completion episode.
   * Formula: (1 - iters/(iters+10)) * 0.6 + (1 - min(durationMs/3600000, 1)) * 0.4
   */
  private calculateReward(iterations: number, durationMs: number): number {
    const iterFactor = (1 - iterations / (iterations + 10)) * 0.6;
    const timeFactor = (1 - Math.min(durationMs / 3600000, 1)) * 0.4;
    return iterFactor + timeFactor;
  }
}
