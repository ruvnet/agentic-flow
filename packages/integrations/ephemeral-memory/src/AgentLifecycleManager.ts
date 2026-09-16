/**
 * AgentLifecycleManager - Manages agent time-to-live and cleanup
 *
 * Features:
 * - Track agent TTL (time-to-live)
 * - Auto-terminate expired agents
 * - Graceful shutdown (save state before termination)
 * - Resource cleanup
 */

import { Agent, LifecycleEvent, SpawnOptions } from './types.js';
import { EventEmitter } from 'events';

export interface LifecycleConfig {
  defaultTTL?: number; // milliseconds
  checkInterval?: number; // milliseconds
  gracePeriod?: number; // milliseconds for graceful shutdown
  enableAutoCleanup?: boolean;
}

export class AgentLifecycleManager extends EventEmitter {
  private agents: Map<string, Agent>;
  private timers: Map<string, NodeJS.Timeout>;
  private config: Required<LifecycleConfig>;
  private checkTimer?: NodeJS.Timeout;

  constructor(config: LifecycleConfig = {}) {
    super();
    this.agents = new Map();
    this.timers = new Map();
    this.config = {
      defaultTTL: 300000, // 5 minutes
      checkInterval: 10000, // 10 seconds
      gracePeriod: 5000, // 5 seconds
      enableAutoCleanup: true,
      ...config
    };

    if (this.config.enableAutoCleanup) {
      this.startPeriodicCheck();
    }
  }

  /**
   * Register a new agent for lifecycle management
   */
  registerAgent(
    agentId: string,
    type: string,
    tenantId: string,
    options: SpawnOptions = {}
  ): Agent {
    const now = Date.now();
    const ttl = options.ttl || this.config.defaultTTL;

    const agent: Agent = {
      id: agentId,
      type,
      tenantId,
      spawnedAt: now,
      expiresAt: now + ttl,
      status: 'spawning',
      memoryNamespace: `${type}:${agentId}`,
      resourceUsage: {
        cpuPercent: 0,
        memoryMB: 0,
        uptime: 0,
        taskCount: 0
      }
    };

    this.agents.set(agentId, agent);

    // Schedule auto-termination
    if (options.autoTerminate !== false) {
      this.scheduleTermination(agentId, ttl);
    }

    this.emitEvent(agentId, 'spawned', { ttl });

    return agent;
  }

  /**
   * Activate an agent (mark as ready)
   */
  activateAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    agent.status = 'active';
    this.emitEvent(agentId, 'active');
  }

  /**
   * Get agent information
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Check if agent is alive
   */
  isAlive(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    return agent.status === 'active' && Date.now() < agent.expiresAt;
  }

  /**
   * Get remaining lifetime for agent
   */
  getRemainingLifetime(agentId: string): number {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return 0;
    }

    return Math.max(0, agent.expiresAt - Date.now());
  }

  /**
   * Extend agent lifetime
   */
  extendLifetime(agentId: string, additionalMs: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    agent.expiresAt += additionalMs;

    // Cancel existing termination timer
    const existingTimer = this.timers.get(agentId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Reschedule termination
    const remaining = agent.expiresAt - Date.now();
    this.scheduleTermination(agentId, remaining);

    this.emitEvent(agentId, 'active', { lifetimeExtended: additionalMs });
  }

  /**
   * Initiate graceful shutdown for agent
   */
  async terminateAgent(agentId: string, reason: string = 'manual'): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return; // Already terminated
    }

    if (agent.status === 'terminating' || agent.status === 'terminated') {
      return; // Already terminating/terminated
    }

    agent.status = 'terminating';
    this.emitEvent(agentId, 'terminating', { reason });

    // Cancel scheduled termination
    const timer = this.timers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(agentId);
    }

    // Allow grace period for cleanup
    await new Promise(resolve => setTimeout(resolve, this.config.gracePeriod));

    // Mark as terminated
    agent.status = 'terminated';
    this.emitEvent(agentId, 'terminated', { reason });

    // Remove from tracking
    this.agents.delete(agentId);
  }

  /**
   * Update resource usage for agent
   */
  updateResourceUsage(agentId: string, usage: Partial<Agent['resourceUsage']>): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    agent.resourceUsage = {
      ...agent.resourceUsage,
      ...usage,
      uptime: Date.now() - agent.spawnedAt
    };
  }

  /**
   * Get all active agents
   */
  getActiveAgents(): Agent[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.status === 'active'
    );
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: string): Agent[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.type === type
    );
  }

  /**
   * Get agents by tenant
   */
  getAgentsByTenant(tenantId: string): Agent[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.tenantId === tenantId
    );
  }

  /**
   * Get lifecycle statistics
   */
  getStats(): {
    totalAgents: number;
    activeAgents: number;
    spawningAgents: number;
    terminatingAgents: number;
    averageUptime: number;
    totalTasks: number;
  } {
    const agents = Array.from(this.agents.values());
    const active = agents.filter(a => a.status === 'active');
    const spawning = agents.filter(a => a.status === 'spawning');
    const terminating = agents.filter(a => a.status === 'terminating');

    const totalUptime = agents.reduce((sum, a) => sum + a.resourceUsage.uptime, 0);
    const averageUptime = agents.length > 0 ? totalUptime / agents.length : 0;

    const totalTasks = agents.reduce((sum, a) => sum + a.resourceUsage.taskCount, 0);

    return {
      totalAgents: agents.length,
      activeAgents: active.length,
      spawningAgents: spawning.length,
      terminatingAgents: terminating.length,
      averageUptime,
      totalTasks
    };
  }

  /**
   * Schedule automatic termination for agent
   */
  private scheduleTermination(agentId: string, delayMs: number): void {
    const timer = setTimeout(async () => {
      await this.terminateAgent(agentId, 'ttl_expired');
    }, delayMs);

    this.timers.set(agentId, timer);
  }

  /**
   * Periodic check for expired agents
   */
  private startPeriodicCheck(): void {
    this.checkTimer = setInterval(() => {
      const now = Date.now();

      for (const [agentId, agent] of this.agents.entries()) {
        if (now >= agent.expiresAt && agent.status !== 'terminating') {
          this.terminateAgent(agentId, 'ttl_expired');
        }
      }
    }, this.config.checkInterval);
  }

  /**
   * Emit lifecycle event
   */
  private emitEvent(
    agentId: string,
    event: LifecycleEvent['event'],
    metadata?: Record<string, any>
  ): void {
    const lifecycleEvent: LifecycleEvent = {
      agentId,
      event,
      timestamp: Date.now(),
      metadata
    };

    this.emit('lifecycle', lifecycleEvent);
    this.emit(event, lifecycleEvent);
  }

  /**
   * Shutdown lifecycle manager and terminate all agents
   */
  async shutdown(): Promise<void> {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    // Terminate all agents
    const agentIds = Array.from(this.agents.keys());
    await Promise.all(
      agentIds.map(id => this.terminateAgent(id, 'shutdown'))
    );

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
