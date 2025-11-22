/**
 * Topology Manager - Manages multiple coordination topologies
 *
 * Provides unified interface for:
 * - Sequential: One-at-a-time execution
 * - Mesh: Peer-to-peer coordination
 * - Hierarchical: Queen-led delegation
 * - Adaptive: Auto-selecting best topology
 * - Gossip: Eventually consistent coordination
 */

const SequentialTopology = require('./topologies/sequential');
const MeshTopology = require('./topologies/mesh');
const HierarchicalTopology = require('./topologies/hierarchical');
const AdaptiveTopology = require('./topologies/adaptive');
const GossipTopology = require('./topologies/gossip');

class TopologyManager {
  constructor(config = {}) {
    this.config = config;

    // Initialize all topologies
    this.topologies = {
      sequential: new SequentialTopology(config),
      mesh: new MeshTopology(config),
      hierarchical: new HierarchicalTopology(config),
      adaptive: new AdaptiveTopology(config),
      gossip: new GossipTopology(config)
    };

    // Default topology
    this.defaultTopology = config.defaultTopology || 'adaptive';

    // Performance tracking
    this.executionHistory = [];

    this.stats = {
      totalExecutions: 0,
      topologyUsage: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0,
        adaptive: 0,
        gossip: 0
      },
      avgExecutionTime: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0,
        adaptive: 0,
        gossip: 0
      },
      successRate: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0,
        adaptive: 0,
        gossip: 0
      }
    };
  }

  /**
   * Execute tasks using specified topology (or default)
   */
  async execute(tasks, options = {}) {
    const topologyName = options.topology || this.defaultTopology;
    const context = options.context || {};

    if (!this.topologies[topologyName]) {
      throw new Error(`Unknown topology: ${topologyName}. Available: ${Object.keys(this.topologies).join(', ')}`);
    }

    const topology = this.topologies[topologyName];

    console.log(`\n🎯 Topology Manager: Executing with ${topologyName} topology\n`);

    const startTime = Date.now();

    // Execute with selected topology
    const result = await topology.execute(tasks, context);

    const duration = Date.now() - startTime;

    // Track execution
    this.trackExecution(topologyName, result, duration);

    return {
      ...result,
      selectedTopology: topologyName,
      managerStats: this.getStats()
    };
  }

  /**
   * Get recommendation for best topology based on task characteristics
   */
  recommendTopology(tasks, context = {}) {
    const taskCount = tasks.length;
    const hasDependencies = tasks.some(t => t.dependencies && t.dependencies.length > 0);
    const isHomogeneous = this.checkHomogeneity(tasks);
    const estimatedComplexity = this.estimateComplexity(tasks);

    const recommendations = [];

    // Sequential: Best for dependent tasks or few simple tasks
    if (hasDependencies || taskCount <= 3) {
      recommendations.push({
        topology: 'sequential',
        score: hasDependencies ? 95 : (taskCount <= 3 ? 85 : 60),
        reasons: [
          hasDependencies ? 'Tasks have dependencies' : null,
          taskCount <= 3 ? 'Few tasks, low overhead' : null
        ].filter(Boolean),
        pros: ['Simple', 'Predictable', 'Easy debugging'],
        cons: ['No parallelism', 'Slower for independent tasks']
      });
    }

    // Mesh: Best for many independent homogeneous tasks
    if (taskCount > 5 && !hasDependencies && isHomogeneous) {
      recommendations.push({
        topology: 'mesh',
        score: 90,
        reasons: [
          'Many independent tasks',
          'Homogeneous workload',
          'Excellent fault tolerance'
        ],
        pros: ['High parallelism', 'Fault tolerant', 'Lock-free (23x faster)'],
        cons: ['Overhead for small task sets', 'Eventually consistent']
      });
    }

    // Hierarchical: Best for complex heterogeneous tasks
    if (estimatedComplexity === 'high' || !isHomogeneous) {
      recommendations.push({
        topology: 'hierarchical',
        score: 85,
        reasons: [
          estimatedComplexity === 'high' ? 'High complexity tasks' : null,
          !isHomogeneous ? 'Heterogeneous workload' : null,
          'Centralized oversight beneficial'
        ].filter(Boolean),
        pros: ['Task specialization', 'Supervised execution', 'Retry logic'],
        cons: ['Queen bottleneck', 'Medium parallelism']
      });
    }

    // Gossip: Best for very large scale (100+ tasks)
    if (taskCount > 50) {
      recommendations.push({
        topology: 'gossip',
        score: 80,
        reasons: [
          'Large scale workload',
          'Excellent scalability',
          'Network partition tolerant'
        ],
        pros: ['Massive scale (1000+)', 'Partition tolerant', 'Decentralized'],
        cons: ['Eventual consistency', 'Convergence delay']
      });
    }

    // Adaptive: Default recommendation if unsure
    if (recommendations.length === 0 || taskCount > 10) {
      recommendations.push({
        topology: 'adaptive',
        score: 75,
        reasons: [
          'Unknown workload characteristics',
          'Self-optimizing',
          'Learns from history'
        ],
        pros: ['Auto-selects best topology', 'Self-learning', 'Flexible'],
        cons: ['Selection overhead', 'Needs warmup period']
      });
    }

    // Sort by score
    recommendations.sort((a, b) => b.score - a.score);

    return {
      taskCount,
      hasDependencies,
      isHomogeneous,
      estimatedComplexity,
      recommendations,
      bestTopology: recommendations[0].topology
    };
  }

  /**
   * Check if tasks are homogeneous (same type)
   */
  checkHomogeneity(tasks) {
    if (tasks.length <= 1) return true;

    const firstType = tasks[0].type || 'default';
    return tasks.every(t => (t.type || 'default') === firstType);
  }

  /**
   * Estimate task complexity
   */
  estimateComplexity(tasks) {
    if (tasks.length > 20) return 'high';
    if (tasks.length > 5) return 'medium';
    return 'low';
  }

  /**
   * Track execution for learning
   */
  trackExecution(topology, result, duration) {
    this.stats.totalExecutions++;
    this.stats.topologyUsage[topology]++;

    // Update average execution time
    const usageCount = this.stats.topologyUsage[topology];
    const currentAvg = this.stats.avgExecutionTime[topology];
    this.stats.avgExecutionTime[topology] = ((currentAvg * (usageCount - 1)) + duration) / usageCount;

    // Update success rate
    const successCount = result.results.filter(r => r.success).length;
    const totalTasks = result.results.length;
    const successRate = totalTasks > 0 ? successCount / totalTasks : 0;

    const currentSuccessRate = this.stats.successRate[topology];
    this.stats.successRate[topology] = ((currentSuccessRate * (usageCount - 1)) + successRate) / usageCount;

    // Store execution
    this.executionHistory.push({
      timestamp: Date.now(),
      topology,
      taskCount: result.results.length,
      duration,
      successRate,
      success: result.success
    });

    // Keep history bounded (last 100)
    if (this.executionHistory.length > 100) {
      this.executionHistory.shift();
    }
  }

  /**
   * Get topology statistics
   */
  getStats() {
    return {
      ...this.stats,
      executionCount: this.executionHistory.length,
      mostUsedTopology: this.getMostUsedTopology(),
      bestPerformingTopology: this.getBestPerformingTopology()
    };
  }

  /**
   * Get most used topology
   */
  getMostUsedTopology() {
    let mostUsed = 'sequential';
    let maxUsage = 0;

    for (const [topology, usage] of Object.entries(this.stats.topologyUsage)) {
      if (usage > maxUsage) {
        maxUsage = usage;
        mostUsed = topology;
      }
    }

    return mostUsed;
  }

  /**
   * Get best performing topology (by success rate and speed)
   */
  getBestPerformingTopology() {
    let best = 'sequential';
    let bestScore = 0;

    for (const topology of Object.keys(this.topologies)) {
      const successRate = this.stats.successRate[topology];
      const avgTime = this.stats.avgExecutionTime[topology];

      // Score = success rate * speed (inverse of time)
      const timeScore = avgTime > 0 ? (1000 / avgTime) : 0;
      const score = successRate * timeScore;

      if (score > bestScore) {
        bestScore = score;
        best = topology;
      }
    }

    return best;
  }

  /**
   * Compare all topologies on a given workload
   */
  async benchmark(tasks, context = {}) {
    console.log(`\n📊 Benchmarking all topologies with ${tasks.length} tasks\n`);

    const results = {};

    for (const topologyName of Object.keys(this.topologies)) {
      console.log(`\n🔬 Testing ${topologyName}...`);

      const startTime = Date.now();

      try {
        const result = await this.execute(tasks, {
          topology: topologyName,
          context
        });

        results[topologyName] = {
          success: result.success,
          duration: Date.now() - startTime,
          successRate: result.results.filter(r => r.success).length / result.results.length,
          stats: result.stats || result.topologyStats
        };

        console.log(`  ✅ ${topologyName}: ${results[topologyName].duration}ms (${(results[topologyName].successRate * 100).toFixed(1)}% success)`);

      } catch (error) {
        results[topologyName] = {
          success: false,
          error: error.message,
          duration: Date.now() - startTime
        };

        console.log(`  ❌ ${topologyName}: Failed - ${error.message}`);
      }

      // Reset topology for next test
      this.topologies[topologyName].reset();
    }

    // Find winner
    const winner = this.findWinner(results);

    console.log(`\n🏆 Winner: ${winner.topology} (${winner.duration}ms, ${(winner.successRate * 100).toFixed(1)}% success)\n`);

    return {
      results,
      winner
    };
  }

  /**
   * Find winning topology from benchmark
   */
  findWinner(results) {
    let winner = null;
    let bestScore = 0;

    for (const [topology, result] of Object.entries(results)) {
      if (!result.success) continue;

      // Score: success rate (weight 0.6) + speed (weight 0.4)
      const successScore = result.successRate * 0.6;
      const speedScore = result.duration > 0 ? (1000 / result.duration) * 0.4 : 0;
      const score = successScore + speedScore;

      if (score > bestScore) {
        bestScore = score;
        winner = {
          topology,
          duration: result.duration,
          successRate: result.successRate,
          score
        };
      }
    }

    return winner;
  }

  /**
   * Reset all topologies
   */
  reset() {
    for (const topology of Object.values(this.topologies)) {
      topology.reset();
    }

    this.executionHistory = [];

    this.stats = {
      totalExecutions: 0,
      topologyUsage: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0,
        adaptive: 0,
        gossip: 0
      },
      avgExecutionTime: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0,
        adaptive: 0,
        gossip: 0
      },
      successRate: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0,
        adaptive: 0,
        gossip: 0
      }
    };
  }
}

module.exports = TopologyManager;
