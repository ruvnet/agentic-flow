/**
 * Sequential Coordination Topology
 *
 * Characteristics:
 * - Tasks execute one at a time in order
 * - Simple, predictable execution
 * - Low overhead, easy debugging
 * - Best for: Dependencies between steps, limited resources
 *
 * Performance: Low parallelism, high reliability
 */

class SequentialTopology {
  constructor(config = {}) {
    this.name = 'sequential';
    this.maxConcurrent = 1;
    this.config = config;

    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgTaskTime: 0,
      totalTime: 0
    };
  }

  /**
   * Execute tasks sequentially
   */
  async execute(tasks, context = {}) {
    const startTime = Date.now();
    const results = [];

    console.log(`🔄 Sequential: Executing ${tasks.length} tasks in order`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const taskStartTime = Date.now();

      console.log(`  [${i + 1}/${tasks.length}] ${task.name}...`);

      try {
        this.stats.totalTasks++;

        // Execute task with context from previous tasks
        const result = await task.action(context, results);

        const taskDuration = Date.now() - taskStartTime;

        results.push({
          name: task.name,
          success: true,
          result,
          duration: taskDuration,
          index: i
        });

        this.stats.completedTasks++;
        this.stats.avgTaskTime = ((this.stats.avgTaskTime * (this.stats.completedTasks - 1)) + taskDuration) / this.stats.completedTasks;

        console.log(`  ✅ ${task.name} completed in ${taskDuration}ms`);

        // Update context for next task
        context[task.name] = result;

      } catch (error) {
        const taskDuration = Date.now() - taskStartTime;

        results.push({
          name: task.name,
          success: false,
          error: error.message,
          duration: taskDuration,
          index: i
        });

        this.stats.failedTasks++;

        console.log(`  ❌ ${task.name} failed: ${error.message}`);

        // Stop on first failure (sequential behavior)
        if (!this.config.continueOnError) {
          break;
        }
      }
    }

    const totalTime = Date.now() - startTime;
    this.stats.totalTime += totalTime;

    return {
      topology: 'sequential',
      success: results.every(r => r.success),
      results,
      duration: totalTime,
      stats: this.getStats()
    };
  }

  /**
   * Get topology statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalTasks > 0
        ? (this.stats.completedTasks / this.stats.totalTasks)
        : 0
    };
  }

  /**
   * Optimize topology (nothing to optimize for sequential)
   */
  async optimize(metrics) {
    return {
      topology: 'sequential',
      recommendations: [
        'Sequential execution is optimal for tasks with dependencies',
        'Consider parallel topology if tasks are independent',
        'Use hierarchical topology for complex task delegation'
      ]
    };
  }

  /**
   * Reset statistics
   */
  reset() {
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgTaskTime: 0,
      totalTime: 0
    };
  }
}

module.exports = SequentialTopology;
