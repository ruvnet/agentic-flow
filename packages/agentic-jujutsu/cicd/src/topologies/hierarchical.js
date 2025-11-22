/**
 * Hierarchical (Queen-Led) Coordination Topology
 *
 * Characteristics:
 * - Central queen coordinates worker agents
 * - Task delegation and specialization
 * - Centralized decision making
 * - Worker supervision and recovery
 * - Best for: Complex workflows, specialized tasks, need for oversight
 *
 * Performance: Medium parallelism, excellent task management
 */

class HierarchicalTopology {
  constructor(config = {}) {
    this.name = 'hierarchical';
    this.maxConcurrent = config.maxConcurrent || 5;
    this.config = config;

    // Queen state
    this.queen = {
      status: 'ready',
      assignedTasks: 0,
      decisions: [],
      workers: new Map()
    };

    // Worker pool
    this.workers = new Map();

    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
      avgTaskTime: 0,
      totalTime: 0,
      workersSpawned: 0,
      queenDecisions: 0
    };
  }

  /**
   * Execute tasks in hierarchical topology (queen delegates to workers)
   */
  async execute(tasks, context = {}) {
    const startTime = Date.now();
    const results = [];

    console.log(`👑 Hierarchical: Queen coordinating ${tasks.length} tasks with ${this.maxConcurrent} workers`);

    this.queen.status = 'coordinating';

    // Queen analyzes and prioritizes tasks
    const prioritizedTasks = this.queenPrioritizeTasks(tasks);

    // Queen assigns tasks to worker pool
    const assignments = this.queenAssignTasks(prioritizedTasks);

    console.log(`  👑 Queen: Assigned ${assignments.length} task batches to workers`);

    // Execute assignments in batches (respecting maxConcurrent)
    for (const batch of assignments) {
      const batchResults = await this.executeBatch(batch, context, results);
      results.push(...batchResults);

      // Queen evaluates batch results and makes decisions
      this.queenEvaluateBatch(batchResults);
    }

    const totalTime = Date.now() - startTime;
    this.stats.totalTime += totalTime;

    this.queen.status = 'completed';

    return {
      topology: 'hierarchical',
      success: results.every(r => r.success),
      results,
      duration: totalTime,
      queenDecisions: this.queen.decisions,
      stats: this.getStats()
    };
  }

  /**
   * Queen prioritizes tasks based on dependencies and importance
   */
  queenPrioritizeTasks(tasks) {
    console.log(`  👑 Queen: Analyzing and prioritizing ${tasks.length} tasks`);

    // Simple priority: tasks with dependencies first
    const prioritized = tasks.map((task, index) => ({
      ...task,
      originalIndex: index,
      priority: task.priority || 'medium',
      dependencies: task.dependencies || []
    }));

    // Sort by priority: high > medium > low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    prioritized.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] || 1;
      const bPriority = priorityOrder[b.priority] || 1;
      return aPriority - bPriority;
    });

    this.stats.queenDecisions++;
    this.queen.decisions.push({
      type: 'prioritization',
      taskCount: tasks.length,
      timestamp: Date.now()
    });

    return prioritized;
  }

  /**
   * Queen assigns tasks to workers in batches
   */
  queenAssignTasks(tasks) {
    const batches = [];

    for (let i = 0; i < tasks.length; i += this.maxConcurrent) {
      batches.push(tasks.slice(i, i + this.maxConcurrent));
    }

    this.stats.queenDecisions++;
    this.queen.decisions.push({
      type: 'task-assignment',
      batchCount: batches.length,
      workersPerBatch: this.maxConcurrent,
      timestamp: Date.now()
    });

    return batches;
  }

  /**
   * Execute a batch of tasks with worker supervision
   */
  async executeBatch(batch, context, previousResults) {
    const batchStartTime = Date.now();
    const batchResults = [];

    console.log(`  👷 Workers: Executing batch of ${batch.length} tasks`);

    const promises = batch.map(async (task, workerIndex) => {
      const workerId = `worker-${Date.now()}-${workerIndex}`;
      const taskStartTime = Date.now();

      // Spawn worker
      this.spawnWorker(workerId, task);

      try {
        this.stats.totalTasks++;

        console.log(`    👷 ${workerId}: ${task.name}...`);

        // Worker executes task
        const result = await task.action(context, previousResults);

        const taskDuration = Date.now() - taskStartTime;

        // Update worker status
        this.updateWorker(workerId, 'completed', result);

        this.stats.completedTasks++;
        this.stats.avgTaskTime = ((this.stats.avgTaskTime * (this.stats.completedTasks - 1)) + taskDuration) / this.stats.completedTasks;

        console.log(`    ✅ ${workerId}: ${task.name} completed in ${taskDuration}ms`);

        return {
          name: task.name,
          workerId,
          success: true,
          result,
          duration: taskDuration,
          originalIndex: task.originalIndex
        };

      } catch (error) {
        const taskDuration = Date.now() - taskStartTime;

        // Update worker status
        this.updateWorker(workerId, 'failed', null, error.message);

        this.stats.failedTasks++;

        console.log(`    ❌ ${workerId}: ${task.name} failed: ${error.message}`);

        // Queen decides whether to retry
        const shouldRetry = this.queenDecideRetry(task, error);

        if (shouldRetry) {
          console.log(`    🔄 Queen: Retrying ${task.name} with new worker`);
          this.stats.retriedTasks++;

          // Retry with new worker
          try {
            const retryResult = await task.action(context, previousResults);
            return {
              name: task.name,
              workerId: `${workerId}-retry`,
              success: true,
              result: retryResult,
              duration: Date.now() - taskStartTime,
              originalIndex: task.originalIndex,
              retried: true
            };
          } catch (retryError) {
            return {
              name: task.name,
              workerId,
              success: false,
              error: retryError.message,
              duration: Date.now() - taskStartTime,
              originalIndex: task.originalIndex,
              retryFailed: true
            };
          }
        }

        return {
          name: task.name,
          workerId,
          success: false,
          error: error.message,
          duration: taskDuration,
          originalIndex: task.originalIndex
        };
      }
    });

    const settled = await Promise.allSettled(promises);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        batchResults.push(result.value);
      } else {
        batchResults.push({
          success: false,
          error: result.reason?.message || 'Unknown error'
        });
      }
    }

    const batchDuration = Date.now() - batchStartTime;
    console.log(`  ✅ Batch completed in ${batchDuration}ms (${batchResults.filter(r => r.success).length}/${batchResults.length} successful)`);

    return batchResults;
  }

  /**
   * Spawn a new worker
   */
  spawnWorker(workerId, task) {
    this.workers.set(workerId, {
      id: workerId,
      task: task.name,
      status: 'running',
      spawnedAt: Date.now(),
      result: null,
      error: null
    });

    this.stats.workersSpawned++;
    this.queen.assignedTasks++;
  }

  /**
   * Update worker status
   */
  updateWorker(workerId, status, result = null, error = null) {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = status;
      worker.result = result;
      worker.error = error;
      worker.completedAt = Date.now();
    }
  }

  /**
   * Queen evaluates batch results and makes strategic decisions
   */
  queenEvaluateBatch(batchResults) {
    const successCount = batchResults.filter(r => r.success).length;
    const failureCount = batchResults.filter(r => !r.success).length;
    const successRate = successCount / batchResults.length;

    console.log(`  👑 Queen: Batch evaluation - ${successCount}/${batchResults.length} successful (${(successRate * 100).toFixed(1)}%)`);

    this.stats.queenDecisions++;
    this.queen.decisions.push({
      type: 'batch-evaluation',
      successRate,
      successCount,
      failureCount,
      totalTasks: batchResults.length,
      timestamp: Date.now()
    });

    // Queen's strategic decision
    if (successRate < 0.5) {
      console.log(`  👑 Queen: WARNING - Low success rate, adjusting strategy`);
      this.queen.decisions.push({
        type: 'strategy-adjustment',
        reason: 'low-success-rate',
        action: 'reduce-parallelism',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Queen decides whether to retry a failed task
   */
  queenDecideRetry(task, error) {
    // Simple retry logic: retry transient errors, not logic errors
    const transientErrors = ['timeout', 'network', 'busy'];
    const isTransient = transientErrors.some(te =>
      error.message?.toLowerCase().includes(te)
    );

    if (isTransient) {
      this.stats.queenDecisions++;
      this.queen.decisions.push({
        type: 'retry-decision',
        task: task.name,
        reason: 'transient-error',
        decision: 'retry',
        timestamp: Date.now()
      });
      return true;
    }

    return false;
  }

  /**
   * Get topology statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalTasks > 0
        ? (this.stats.completedTasks / this.stats.totalTasks)
        : 0,
      retryRate: this.stats.totalTasks > 0
        ? (this.stats.retriedTasks / this.stats.totalTasks)
        : 0,
      avgWorkersActive: this.workers.size / (this.stats.queenDecisions || 1)
    };
  }

  /**
   * Optimize topology based on metrics
   */
  async optimize(metrics) {
    const recommendations = [];

    // Analyze queen's decision quality
    const retryRate = this.stats.retriedTasks / this.stats.totalTasks;

    if (retryRate > 0.2) {
      recommendations.push({
        priority: 'high',
        message: 'High retry rate - improve task reliability or error handling',
        expectedImprovement: '30-40% reduction in retries'
      });
    }

    if (this.stats.workersSpawned > this.stats.totalTasks * 2) {
      recommendations.push({
        priority: 'medium',
        message: 'Too many worker spawns - optimize batch size',
        expectedImprovement: '20-30% reduction in overhead'
      });
    }

    return {
      topology: 'hierarchical',
      recommendations,
      currentEfficiency: this.stats.successRate,
      queenDecisions: this.queen.decisions.length,
      workerUtilization: this.stats.completedTasks / this.stats.workersSpawned
    };
  }

  /**
   * Reset topology state
   */
  reset() {
    this.queen = {
      status: 'ready',
      assignedTasks: 0,
      decisions: [],
      workers: new Map()
    };

    this.workers.clear();

    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
      avgTaskTime: 0,
      totalTime: 0,
      workersSpawned: 0,
      queenDecisions: 0
    };
  }
}

module.exports = HierarchicalTopology;
