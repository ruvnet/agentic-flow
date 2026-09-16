/**
 * ResourceMonitor - Track resource usage and calculate cost savings
 *
 * Features:
 * - Track resource usage per agent
 * - Calculate cost savings vs persistent agents
 * - Alert on resource exhaustion
 * - Load balancing recommendations
 */

import { Agent, AgentMetrics, CostSavings, ResourceUsage } from './types.js';
import { EventEmitter } from 'events';

export interface MonitorConfig {
  samplingInterval?: number; // milliseconds
  persistentAgentCostPerHour?: number; // $
  ephemeralAgentCostPerHour?: number; // $
  cpuThreshold?: number; // percent
  memoryThreshold?: number; // MB
  enableAlerts?: boolean;
}

export interface ResourceAlert {
  type: 'cpu' | 'memory' | 'spawn_rate' | 'cost';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export class ResourceMonitor extends EventEmitter {
  private config: Required<MonitorConfig>;
  private metrics: Map<string, AgentMetrics>;
  private samplingTimer?: NodeJS.Timeout;
  private startTime: number;
  private totalSpawns: number;
  private totalTerminations: number;

  constructor(config: MonitorConfig = {}) {
    super();
    this.config = {
      samplingInterval: 5000, // 5 seconds
      persistentAgentCostPerHour: 0.10,
      ephemeralAgentCostPerHour: 0.01,
      cpuThreshold: 80,
      memoryThreshold: 512,
      enableAlerts: true,
      ...config
    };

    this.metrics = new Map();
    this.startTime = Date.now();
    this.totalSpawns = 0;
    this.totalTerminations = 0;

    this.startSampling();
  }

  /**
   * Record agent spawn
   */
  recordSpawn(agentId: string): void {
    const metrics: AgentMetrics = {
      agentId,
      spawnTime: Date.now(),
      executionTime: 0,
      memoryReads: 0,
      memoryWrites: 0,
      tasksCompleted: 0,
      errors: 0,
      resourceUsage: {
        cpuPercent: 0,
        memoryMB: 0,
        uptime: 0,
        taskCount: 0
      }
    };

    this.metrics.set(agentId, metrics);
    this.totalSpawns++;
  }

  /**
   * Record agent termination
   */
  recordTermination(agentId: string): void {
    const metrics = this.metrics.get(agentId);
    if (metrics) {
      metrics.executionTime = Date.now() - metrics.spawnTime;
    }

    this.totalTerminations++;
  }

  /**
   * Update agent resource usage
   */
  updateResourceUsage(agentId: string, usage: ResourceUsage): void {
    const metrics = this.metrics.get(agentId);
    if (!metrics) {
      return;
    }

    metrics.resourceUsage = usage;

    // Check thresholds and emit alerts
    if (this.config.enableAlerts) {
      this.checkThresholds(agentId, usage);
    }
  }

  /**
   * Record memory operation
   */
  recordMemoryOperation(agentId: string, operation: 'read' | 'write'): void {
    const metrics = this.metrics.get(agentId);
    if (!metrics) {
      return;
    }

    if (operation === 'read') {
      metrics.memoryReads++;
    } else {
      metrics.memoryWrites++;
    }
  }

  /**
   * Record task completion
   */
  recordTaskCompletion(agentId: string, success: boolean): void {
    const metrics = this.metrics.get(agentId);
    if (!metrics) {
      return;
    }

    metrics.tasksCompleted++;
    if (!success) {
      metrics.errors++;
    }
  }

  /**
   * Get metrics for specific agent
   */
  getAgentMetrics(agentId: string): AgentMetrics | undefined {
    return this.metrics.get(agentId);
  }

  /**
   * Get aggregated metrics across all agents
   */
  getAggregatedMetrics(): {
    totalAgents: number;
    totalSpawns: number;
    totalTerminations: number;
    activeAgents: number;
    avgSpawnTime: number;
    avgExecutionTime: number;
    totalMemoryReads: number;
    totalMemoryWrites: number;
    totalTasksCompleted: number;
    totalErrors: number;
    avgCpuPercent: number;
    avgMemoryMB: number;
  } {
    const metricsArray = Array.from(this.metrics.values());
    const activeMetrics = metricsArray.filter(m => m.executionTime === 0);

    const totalSpawnTime = metricsArray.reduce((sum, m) => sum + m.spawnTime, 0);
    const avgSpawnTime = metricsArray.length > 0 ? totalSpawnTime / metricsArray.length : 0;

    const execTimes = metricsArray.filter(m => m.executionTime > 0);
    const totalExecTime = execTimes.reduce((sum, m) => sum + m.executionTime, 0);
    const avgExecutionTime = execTimes.length > 0 ? totalExecTime / execTimes.length : 0;

    const totalMemoryReads = metricsArray.reduce((sum, m) => sum + m.memoryReads, 0);
    const totalMemoryWrites = metricsArray.reduce((sum, m) => sum + m.memoryWrites, 0);
    const totalTasksCompleted = metricsArray.reduce((sum, m) => sum + m.tasksCompleted, 0);
    const totalErrors = metricsArray.reduce((sum, m) => sum + m.errors, 0);

    const totalCpu = activeMetrics.reduce((sum, m) => sum + m.resourceUsage.cpuPercent, 0);
    const avgCpuPercent = activeMetrics.length > 0 ? totalCpu / activeMetrics.length : 0;

    const totalMemory = activeMetrics.reduce((sum, m) => sum + m.resourceUsage.memoryMB, 0);
    const avgMemoryMB = activeMetrics.length > 0 ? totalMemory / activeMetrics.length : 0;

    return {
      totalAgents: metricsArray.length,
      totalSpawns: this.totalSpawns,
      totalTerminations: this.totalTerminations,
      activeAgents: activeMetrics.length,
      avgSpawnTime,
      avgExecutionTime,
      totalMemoryReads,
      totalMemoryWrites,
      totalTasksCompleted,
      totalErrors,
      avgCpuPercent,
      avgMemoryMB
    };
  }

  /**
   * Calculate cost savings vs persistent agents
   */
  calculateCostSavings(agents: Agent[]): CostSavings {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeHours = uptimeMs / (1000 * 60 * 60);

    // Calculate actual uptime for ephemeral agents
    const totalEphemeralUptime = agents.reduce((sum, agent) => {
      const agentUptime = Math.min(
        Date.now() - agent.spawnedAt,
        agent.expiresAt - agent.spawnedAt
      );
      return sum + agentUptime;
    }, 0);

    const ephemeralUptimeHours = totalEphemeralUptime / (1000 * 60 * 60);

    // Cost calculations
    const persistentCost = uptimeHours * this.config.persistentAgentCostPerHour * agents.length;
    const ephemeralCost = ephemeralUptimeHours * this.config.ephemeralAgentCostPerHour;

    const savingsAmount = persistentCost - ephemeralCost;
    const savingsPercent = persistentCost > 0 ? (savingsAmount / persistentCost) * 100 : 0;

    const uptimePercent = uptimeMs > 0 ? (totalEphemeralUptime / (uptimeMs * agents.length)) * 100 : 0;

    return {
      persistentAgentCost: persistentCost,
      ephemeralAgentCost: ephemeralCost,
      savingsPercent,
      savingsAmount,
      uptimePercent
    };
  }

  /**
   * Get spawn rate (spawns per second)
   */
  getSpawnRate(): number {
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    return uptimeSeconds > 0 ? this.totalSpawns / uptimeSeconds : 0;
  }

  /**
   * Get load balancing recommendations
   */
  getLoadBalancingRecommendations(): {
    shouldScaleUp: boolean;
    shouldScaleDown: boolean;
    recommendedAgentCount: number;
    reason: string;
  } {
    const metrics = this.getAggregatedMetrics();

    // High CPU usage indicates need to scale up
    if (metrics.avgCpuPercent > this.config.cpuThreshold) {
      return {
        shouldScaleUp: true,
        shouldScaleDown: false,
        recommendedAgentCount: Math.ceil(metrics.activeAgents * 1.5),
        reason: `High CPU usage (${metrics.avgCpuPercent.toFixed(1)}%)`
      };
    }

    // High memory usage indicates need to scale up
    if (metrics.avgMemoryMB > this.config.memoryThreshold) {
      return {
        shouldScaleUp: true,
        shouldScaleDown: false,
        recommendedAgentCount: Math.ceil(metrics.activeAgents * 1.5),
        reason: `High memory usage (${metrics.avgMemoryMB.toFixed(0)}MB)`
      };
    }

    // Low resource usage indicates can scale down
    if (metrics.avgCpuPercent < 20 && metrics.avgMemoryMB < 100 && metrics.activeAgents > 1) {
      return {
        shouldScaleUp: false,
        shouldScaleDown: true,
        recommendedAgentCount: Math.max(1, Math.floor(metrics.activeAgents * 0.5)),
        reason: 'Low resource usage'
      };
    }

    // Current capacity is optimal
    return {
      shouldScaleUp: false,
      shouldScaleDown: false,
      recommendedAgentCount: metrics.activeAgents,
      reason: 'Optimal capacity'
    };
  }

  /**
   * Export metrics for external monitoring (Prometheus, Grafana, etc.)
   */
  exportMetrics() {
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      aggregated: this.getAggregatedMetrics(),
      spawnRate: this.getSpawnRate(),
      agents: Array.from(this.metrics.values())
    };
  }

  /**
   * Check resource thresholds and emit alerts
   */
  private checkThresholds(agentId: string, usage: ResourceUsage): void {
    const alerts: ResourceAlert[] = [];

    // CPU threshold
    if (usage.cpuPercent > this.config.cpuThreshold) {
      alerts.push({
        type: 'cpu',
        severity: usage.cpuPercent > 95 ? 'critical' : 'warning',
        message: `Agent ${agentId} CPU usage is high`,
        value: usage.cpuPercent,
        threshold: this.config.cpuThreshold,
        timestamp: Date.now()
      });
    }

    // Memory threshold
    if (usage.memoryMB > this.config.memoryThreshold) {
      alerts.push({
        type: 'memory',
        severity: usage.memoryMB > this.config.memoryThreshold * 1.5 ? 'critical' : 'warning',
        message: `Agent ${agentId} memory usage is high`,
        value: usage.memoryMB,
        threshold: this.config.memoryThreshold,
        timestamp: Date.now()
      });
    }

    // Emit alerts
    for (const alert of alerts) {
      this.emit('alert', alert);
    }
  }

  /**
   * Start periodic resource sampling
   */
  private startSampling(): void {
    this.samplingTimer = setInterval(() => {
      this.emit('sample', this.exportMetrics());
    }, this.config.samplingInterval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.samplingTimer) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = undefined;
    }
  }

  /**
   * Clear all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.totalSpawns = 0;
    this.totalTerminations = 0;
    this.startTime = Date.now();
  }
}
