/**
 * EphemeralAgentManager - Main orchestrator for ephemeral agent system
 *
 * Features:
 * - On-demand agent spawning (<50ms)
 * - Persistent memory across agent lifecycles
 * - Resource monitoring and optimization
 * - Automatic cleanup and lifecycle management
 */

import { Agent, Task, SpawnOptions } from './types.js';
import { MemoryPersistenceLayer, MemoryPersistenceConfig } from './MemoryPersistenceLayer.js';
import { AgentLifecycleManager, LifecycleConfig } from './AgentLifecycleManager.js';
import { MemorySynchronizer, SyncConfig } from './MemorySynchronizer.js';
import { ResourceMonitor, MonitorConfig } from './ResourceMonitor.js';
import { EventEmitter } from 'events';

export interface EphemeralAgentManagerConfig {
  tenantId: string;
  dbPath?: string;
  lifecycle?: LifecycleConfig;
  sync?: SyncConfig;
  monitor?: MonitorConfig;
  memory?: Omit<MemoryPersistenceConfig, 'tenantId'>;
}

export interface AgentExecutionContext {
  agent: Agent;
  memory: MemorySynchronizer;
  monitor: ResourceMonitor;
}

export class EphemeralAgentManager extends EventEmitter {
  private config: EphemeralAgentManagerConfig;
  private persistence: MemoryPersistenceLayer;
  private lifecycle: AgentLifecycleManager;
  private synchronizers: Map<string, MemorySynchronizer>;
  private monitor: ResourceMonitor;
  private agentTypes: Map<string, any>; // Agent type registry

  constructor(config: EphemeralAgentManagerConfig) {
    super();
    this.config = config;

    // Initialize persistence layer
    this.persistence = new MemoryPersistenceLayer({
      tenantId: config.tenantId,
      dbPath: config.dbPath,
      ...config.memory
    });

    // Initialize lifecycle manager
    this.lifecycle = new AgentLifecycleManager(config.lifecycle);

    // Initialize resource monitor
    this.monitor = new ResourceMonitor(config.monitor);

    // Initialize synchronizers map
    this.synchronizers = new Map();

    // Initialize agent type registry
    this.agentTypes = new Map();

    // Wire up event handlers
    this.setupEventHandlers();
  }

  /**
   * Spawn a new ephemeral agent
   * Target: <50ms spawn time
   */
  async spawnAgent(type: string, task: Task, options: SpawnOptions = {}): Promise<Agent> {
    const startTime = Date.now();

    // Generate agent ID
    const agentId = `${type}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      // Register agent with lifecycle manager
      const agent = this.lifecycle.registerAgent(
        agentId,
        type,
        this.config.tenantId,
        options
      );

      // Create memory synchronizer for this agent
      const synchronizer = new MemorySynchronizer(
        this.persistence,
        this.config.sync
      );
      this.synchronizers.set(agentId, synchronizer);

      // Preload memories if specified
      if (options.memoryPreload && options.memoryPreload.length > 0) {
        await synchronizer.preload(options.memoryPreload);
      }

      // Load relevant context from past agents of same type
      const contextMemories = await this.persistence.searchMemories(
        `${type}:${task.description}`,
        5
      );

      // Store context in agent's memory
      for (const memory of contextMemories) {
        await synchronizer.write(agentId, memory.key, memory.value);
      }

      // Record spawn metrics
      this.monitor.recordSpawn(agentId);

      // Activate agent
      this.lifecycle.activateAgent(agentId);

      const spawnTime = Date.now() - startTime;

      this.emit('agent:spawned', {
        agent,
        spawnTime,
        contextLoaded: contextMemories.length
      });

      // Log spawn time performance
      if (spawnTime > 50) {
        this.emit('performance:warning', {
          message: 'Spawn time exceeded target',
          target: 50,
          actual: spawnTime,
          agentId
        });
      }

      return agent;
    } catch (error: any) {
      this.emit('agent:spawn:error', {
        agentId,
        type,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Terminate an agent and persist its memory
   */
  async terminateAgent(agentId: string): Promise<void> {
    const agent = this.lifecycle.getAgent(agentId);
    if (!agent) {
      return; // Already terminated
    }

    try {
      // Flush all pending memory operations
      const synchronizer = this.synchronizers.get(agentId);
      if (synchronizer) {
        await synchronizer.flush();
        await synchronizer.stop();
        this.synchronizers.delete(agentId);
      }

      // Record termination
      this.monitor.recordTermination(agentId);

      // Terminate via lifecycle manager
      await this.lifecycle.terminateAgent(agentId);

      this.emit('agent:terminated', { agentId });
    } catch (error: any) {
      this.emit('agent:terminate:error', {
        agentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get memory for an agent
   */
  async getMemory(agentId: string, key: string): Promise<any> {
    const synchronizer = this.synchronizers.get(agentId);
    if (!synchronizer) {
      throw new Error(`Agent ${agentId} not found`);
    }

    this.monitor.recordMemoryOperation(agentId, 'read');
    return await synchronizer.read(key);
  }

  /**
   * Set memory for an agent
   */
  async setMemory(agentId: string, key: string, value: any): Promise<void> {
    const synchronizer = this.synchronizers.get(agentId);
    if (!synchronizer) {
      throw new Error(`Agent ${agentId} not found`);
    }

    this.monitor.recordMemoryOperation(agentId, 'write');
    await synchronizer.write(agentId, key, value);
  }

  /**
   * Search agent memories semantically
   */
  async searchMemories(agentId: string, query: string, k: number = 5): Promise<any[]> {
    const synchronizer = this.synchronizers.get(agentId);
    if (!synchronizer) {
      throw new Error(`Agent ${agentId} not found`);
    }

    return await synchronizer.search(query, k);
  }

  /**
   * Execute a task with an ephemeral agent
   */
  async executeTask<T>(
    type: string,
    task: Task,
    executor: (context: AgentExecutionContext) => Promise<T>,
    options: SpawnOptions = {}
  ): Promise<T> {
    const agent = await this.spawnAgent(type, task, options);

    try {
      const context: AgentExecutionContext = {
        agent,
        memory: this.synchronizers.get(agent.id)!,
        monitor: this.monitor
      };

      // Execute task
      const result = await executor(context);

      // Record successful completion
      this.monitor.recordTaskCompletion(agent.id, true);

      return result;
    } catch (error: any) {
      // Record failed completion
      this.monitor.recordTaskCompletion(agent.id, false);

      throw error;
    } finally {
      // Always terminate agent after execution
      await this.terminateAgent(agent.id);
    }
  }

  /**
   * List all active agents
   */
  listActiveAgents(): Agent[] {
    return this.lifecycle.getActiveAgents();
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.lifecycle.getAgent(agentId);
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: string): Agent[] {
    return this.lifecycle.getAgentsByType(type);
  }

  /**
   * Get agents by tenant
   */
  getAgentsByTenant(tenantId: string): Agent[] {
    return this.lifecycle.getAgentsByTenant(tenantId);
  }

  /**
   * Get resource statistics
   */
  getResourceStats() {
    return {
      lifecycle: this.lifecycle.getStats(),
      monitor: this.monitor.getAggregatedMetrics(),
      costSavings: this.monitor.calculateCostSavings(this.listActiveAgents())
    };
  }

  /**
   * Get synchronization statistics
   */
  getSyncStats() {
    const stats = new Map();

    for (const [agentId, sync] of this.synchronizers.entries()) {
      stats.set(agentId, sync.getSyncStats());
    }

    return stats;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const stats = new Map();

    for (const [agentId, sync] of this.synchronizers.entries()) {
      stats.set(agentId, sync.getCacheStats());
    }

    return stats;
  }

  /**
   * Get load balancing recommendations
   */
  getLoadBalancingRecommendations() {
    return this.monitor.getLoadBalancingRecommendations();
  }

  /**
   * Export metrics for monitoring systems (Prometheus, Grafana, etc.)
   */
  exportMetrics() {
    return {
      timestamp: Date.now(),
      manager: {
        activeAgents: this.listActiveAgents().length,
        totalSpawns: this.synchronizers.size,
        tenantId: this.config.tenantId
      },
      lifecycle: this.lifecycle.getStats(),
      monitor: this.monitor.exportMetrics(),
      memory: this.persistence.getStats()
    };
  }

  /**
   * Consolidate memories to reduce duplication
   */
  async consolidateMemories(): Promise<number> {
    return await this.persistence.consolidate();
  }

  /**
   * Setup event handlers for cross-component communication
   */
  private setupEventHandlers(): void {
    // Forward lifecycle events
    this.lifecycle.on('lifecycle', (event) => {
      this.emit('lifecycle', event);
    });

    // Forward resource alerts
    this.monitor.on('alert', (alert) => {
      this.emit('alert', alert);
    });

    // Update resource usage on lifecycle changes
    this.lifecycle.on('lifecycle', (event) => {
      if (event.event === 'active') {
        const agent = this.lifecycle.getAgent(event.agentId);
        if (agent) {
          this.monitor.updateResourceUsage(event.agentId, agent.resourceUsage);
        }
      }
    });
  }

  /**
   * Shutdown manager and cleanup all resources
   */
  async shutdown(): Promise<void> {
    try {
      // Stop all synchronizers
      for (const synchronizer of this.synchronizers.values()) {
        await synchronizer.stop();
      }
      this.synchronizers.clear();

      // Shutdown lifecycle manager (terminates all agents)
      await this.lifecycle.shutdown();

      // Stop monitoring
      this.monitor.stop();

      // Close persistence layer
      this.persistence.close();

      this.emit('shutdown');
    } catch (error: any) {
      this.emit('shutdown:error', { error: error.message });
      throw error;
    }
  }
}
