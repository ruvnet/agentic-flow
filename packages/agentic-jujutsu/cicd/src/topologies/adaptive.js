/**
 * Adaptive Coordination Topology
 *
 * Characteristics:
 * - Dynamically switches between topologies based on workload
 * - Self-optimizing based on metrics
 * - Learns from execution patterns
 * - Best for: Variable workloads, unknown task characteristics
 *
 * Performance: Adapts to optimal performance for any scenario
 */

const SequentialTopology = require('./sequential');
const MeshTopology = require('./mesh');
const HierarchicalTopology = require('./hierarchical');

class AdaptiveTopology {
  constructor(config = {}) {
    this.name = 'adaptive';
    this.config = config;

    // Available topologies
    this.topologies = {
      sequential: new SequentialTopology(config),
      mesh: new MeshTopology(config),
      hierarchical: new HierarchicalTopology(config)
    };

    // Current active topology
    this.activeTopology = null;

    // Learning data
    this.history = [];
    this.performanceProfiles = {
      sequential: { avgTime: 0, successRate: 0, executions: 0 },
      mesh: { avgTime: 0, successRate: 0, executions: 0 },
      hierarchical: { avgTime: 0, successRate: 0, executions: 0 }
    };

    this.stats = {
      totalExecutions: 0,
      topologyChanges: 0,
      adaptations: [],
      currentTopology: 'sequential', // Default
      topologyUsage: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0
      }
    };
  }

  /**
   * Execute tasks with adaptive topology selection
   */
  async execute(tasks, context = {}) {
    const startTime = Date.now();

    console.log(`🔄 Adaptive: Analyzing ${tasks.length} tasks to select optimal topology`);

    // Analyze tasks and select best topology
    const selectedTopology = this.selectTopology(tasks, context);

    if (this.activeTopology !== selectedTopology) {
      this.stats.topologyChanges++;
      console.log(`  🔀 Switching from ${this.activeTopology || 'none'} to ${selectedTopology}`);
    }

    this.activeTopology = selectedTopology;
    this.stats.currentTopology = selectedTopology;
    this.stats.topologyUsage[selectedTopology]++;

    // Execute with selected topology
    const topology = this.topologies[selectedTopology];
    const result = await topology.execute(tasks, context);

    const totalTime = Date.now() - startTime;

    // Learn from execution
    this.learnFromExecution(selectedTopology, result, tasks, totalTime);

    this.stats.totalExecutions++;

    return {
      topology: 'adaptive',
      selectedTopology,
      success: result.success,
      results: result.results,
      duration: totalTime,
      adaptiveStats: this.getStats(),
      topologyStats: result.stats
    };
  }

  /**
   * Select optimal topology based on task characteristics
   */
  selectTopology(tasks, context) {
    const analysis = this.analyzeTasks(tasks);

    console.log(`  📊 Task analysis:`, {
      count: tasks.length,
      hasDependencies: analysis.hasDependencies,
      isHomogeneous: analysis.isHomogeneous,
      estimatedComplexity: analysis.complexity
    });

    // Decision matrix based on task characteristics
    let selectedTopology;
    let reason;

    // Rule 1: Tasks with dependencies → Sequential
    if (analysis.hasDependencies) {
      selectedTopology = 'sequential';
      reason = 'Tasks have dependencies, sequential execution required';
    }
    // Rule 2: Many independent tasks → Mesh
    else if (tasks.length > 5 && !analysis.hasDependencies && analysis.isHomogeneous) {
      selectedTopology = 'mesh';
      reason = 'Many independent homogeneous tasks, mesh provides best parallelism';
    }
    // Rule 3: Complex heterogeneous tasks → Hierarchical
    else if (analysis.complexity === 'high' || !analysis.isHomogeneous) {
      selectedTopology = 'hierarchical';
      reason = 'Complex or heterogeneous tasks, hierarchical coordination optimal';
    }
    // Rule 4: Few simple tasks → Sequential
    else if (tasks.length <= 3) {
      selectedTopology = 'sequential';
      reason = 'Few simple tasks, sequential execution has low overhead';
    }
    // Default: Use best performing topology from history
    else {
      selectedTopology = this.getBestPerformingTopology();
      reason = `Based on historical performance (${this.performanceProfiles[selectedTopology].successRate.toFixed(2)} success rate)`;
    }

    console.log(`  ✅ Selected ${selectedTopology}: ${reason}`);

    this.stats.adaptations.push({
      timestamp: Date.now(),
      taskCount: tasks.length,
      selectedTopology,
      reason,
      analysis
    });

    return selectedTopology;
  }

  /**
   * Analyze task characteristics
   */
  analyzeTasks(tasks) {
    const analysis = {
      count: tasks.length,
      hasDependencies: false,
      isHomogeneous: true,
      complexity: 'medium',
      estimatedDuration: 0
    };

    // Check for dependencies
    for (const task of tasks) {
      if (task.dependencies && task.dependencies.length > 0) {
        analysis.hasDependencies = true;
        break;
      }
    }

    // Check homogeneity (all tasks similar type)
    if (tasks.length > 1) {
      const firstType = tasks[0].type || 'default';
      analysis.isHomogeneous = tasks.every(t => (t.type || 'default') === firstType);
    }

    // Estimate complexity
    if (tasks.length > 10) {
      analysis.complexity = 'high';
    } else if (tasks.length > 5) {
      analysis.complexity = 'medium';
    } else {
      analysis.complexity = 'low';
    }

    return analysis;
  }

  /**
   * Get best performing topology from history
   */
  getBestPerformingTopology() {
    let bestTopology = 'sequential';
    let bestScore = 0;

    for (const [topology, profile] of Object.entries(this.performanceProfiles)) {
      if (profile.executions === 0) continue;

      // Score = success rate * (1 / avg time) to favor both reliability and speed
      const timeScore = profile.avgTime > 0 ? (1000 / profile.avgTime) : 0;
      const score = profile.successRate * timeScore;

      if (score > bestScore) {
        bestScore = score;
        bestTopology = topology;
      }
    }

    return bestTopology;
  }

  /**
   * Learn from execution results
   */
  learnFromExecution(topology, result, tasks, duration) {
    const profile = this.performanceProfiles[topology];

    // Update running averages
    const successRate = result.results.filter(r => r.success).length / result.results.length;

    profile.executions++;
    profile.avgTime = ((profile.avgTime * (profile.executions - 1)) + duration) / profile.executions;
    profile.successRate = ((profile.successRate * (profile.executions - 1)) + successRate) / profile.executions;

    // Store execution history
    this.history.push({
      timestamp: Date.now(),
      topology,
      taskCount: tasks.length,
      duration,
      successRate,
      result: result.success
    });

    // Keep history bounded (last 100 executions)
    if (this.history.length > 100) {
      this.history.shift();
    }

    console.log(`  📚 Learning: ${topology} profile updated (${profile.executions} executions, ${(profile.successRate * 100).toFixed(1)}% success, ${profile.avgTime.toFixed(0)}ms avg)`);
  }

  /**
   * Get topology statistics
   */
  getStats() {
    return {
      ...this.stats,
      performanceProfiles: this.performanceProfiles,
      historySize: this.history.length,
      recentAdaptations: this.stats.adaptations.slice(-5)
    };
  }

  /**
   * Optimize adaptive strategy
   */
  async optimize(metrics) {
    const recommendations = [];

    // Analyze topology distribution
    const totalUsage = Object.values(this.stats.topologyUsage).reduce((a, b) => a + b, 0);

    for (const [topology, usage] of Object.entries(this.stats.topologyUsage)) {
      const percentage = totalUsage > 0 ? (usage / totalUsage) * 100 : 0;

      if (percentage > 70) {
        recommendations.push({
          priority: 'medium',
          message: `${topology} used ${percentage.toFixed(1)}% of the time - consider using it directly`,
          expectedImprovement: '10-15% reduction in selection overhead'
        });
      }
    }

    // Analyze adaptation frequency
    if (this.stats.topologyChanges / this.stats.totalExecutions > 0.5) {
      recommendations.push({
        priority: 'low',
        message: 'Frequent topology changes - workload is highly variable',
        expectedImprovement: 'Adaptive topology is optimal for this use case'
      });
    }

    return {
      topology: 'adaptive',
      recommendations,
      topologyDistribution: this.stats.topologyUsage,
      adaptationRate: this.stats.topologyChanges / this.stats.totalExecutions,
      bestTopology: this.getBestPerformingTopology()
    };
  }

  /**
   * Reset all topologies and stats
   */
  reset() {
    for (const topology of Object.values(this.topologies)) {
      topology.reset();
    }

    this.activeTopology = null;
    this.history = [];

    this.performanceProfiles = {
      sequential: { avgTime: 0, successRate: 0, executions: 0 },
      mesh: { avgTime: 0, successRate: 0, executions: 0 },
      hierarchical: { avgTime: 0, successRate: 0, executions: 0 }
    };

    this.stats = {
      totalExecutions: 0,
      topologyChanges: 0,
      adaptations: [],
      currentTopology: 'sequential',
      topologyUsage: {
        sequential: 0,
        mesh: 0,
        hierarchical: 0
      }
    };
  }
}

module.exports = AdaptiveTopology;
