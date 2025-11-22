/**
 * CI/CD Workflow Orchestrator with ReasoningBank Learning
 *
 * Orchestrates CI/CD workflows with intelligent learning and optimization
 * using ReasoningBank patterns and VectorDB for metrics storage.
 *
 * @module cicd/orchestrator
 */

const { CICDVectorDB } = require('./vectordb');

// Optional dependencies - gracefully handle if not available
let JjWrapper, QuantumBridge;
try {
  const aj = require('agentic-jujutsu');
  JjWrapper = aj.JjWrapper;
  try {
    const qb = require('agentic-jujutsu/quantum_bridge');
    QuantumBridge = qb.QuantumBridge;
  } catch (err) {
    // QuantumBridge not available
  }
} catch (err) {
  // Mock JjWrapper for testing
  JjWrapper = class {
    async enableAgentCoordination() {}
    async registerAgent() {}
    startTrajectory() { return 'test-trajectory'; }
    addToTrajectory() {}
    finalizeTrajectory() {}
  };
}

/**
 * Workflow Orchestrator with Learning
 */
class WorkflowOrchestrator {
  /**
   * Initialize orchestrator
   * @param {Object} config - Configuration
   */
  constructor(config = {}) {
    this.config = {
      dbPath: config.dbPath || '.vectordb',
      enableLearning: config.enableLearning !== false,
      enableQuantum: config.enableQuantum !== false,
      maxParallel: config.maxParallel || 5,
      ...config
    };

    this.jj = new JjWrapper();
    this.vectordb = new CICDVectorDB({ dbPath: this.config.dbPath });
    this.quantumBridge = null;
    this.activeWorkflows = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the orchestrator
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // Initialize VectorDB
    await this.vectordb.initialize();

    // Enable agent coordination
    await this.jj.enableAgentCoordination();

    // Setup quantum coordination if enabled
    if (this.config.enableQuantum) {
      this.quantumBridge = new QuantumBridge(this.jj);
      await this.quantumBridge.initialize();
    }

    this.initialized = true;
    console.log('[WorkflowOrchestrator] Initialized');
  }

  /**
   * Execute a workflow with learning
   * @param {Object} workflow - Workflow definition
   * @param {string} workflow.name - Workflow name
   * @param {Array} workflow.steps - Workflow steps
   * @param {Object} workflow.config - Workflow configuration
   * @returns {Promise<Object>} Execution result
   */
  async executeWorkflow(workflow) {
    if (!this.initialized) {
      await this.initialize();
    }

    const workflowId = `wf-${Date.now()}`;
    const startTime = Date.now();

    console.log(`\n[WorkflowOrchestrator] Starting workflow: ${workflow.name} (${workflowId})`);

    // Start learning trajectory
    let trajectoryId = null;
    if (this.config.enableLearning) {
      try {
        trajectoryId = this.jj.startTrajectory(`Workflow: ${workflow.name}`);
      } catch (error) {
        console.log('[WorkflowOrchestrator] ReasoningBank not available, continuing without learning');
      }
    }

    // Get optimization recommendations
    const optimizations = await this.vectordb.getOptimizations({
      name: workflow.name,
      steps: workflow.steps
    });

    if (optimizations.recommendations.length > 0) {
      console.log(`\n📊 Found ${optimizations.recommendations.length} optimization recommendations:`);
      optimizations.recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. [${rec.priority.toUpperCase()}] ${rec.message}`);
        console.log(`     Expected: ${rec.expectedImprovement}`);
      });
      console.log(`   Confidence: ${(optimizations.confidence * 100).toFixed(1)}% (based on ${optimizations.basedOn} similar workflows)\n`);
    }

    // Apply optimizations
    const optimizedWorkflow = this.applyOptimizations(workflow, optimizations);

    // Execute steps
    const results = {
      workflowId,
      name: workflow.name,
      startTime,
      steps: [],
      success: true,
      error: null,
      metrics: {}
    };

    try {
      // Register workflow agent
      await this.jj.registerAgent(workflowId, 'workflow');

      // Execute steps (with parallelization if recommended)
      if (optimizations.patterns?.parallelSteps?.length > 0) {
        await this.executeParallel(optimizedWorkflow.steps, results);
      } else {
        await this.executeSequential(optimizedWorkflow.steps, results);
      }

      results.success = true;
      results.duration = Date.now() - startTime;

      // Store successful workflow
      await this.vectordb.storeWorkflow(results);

      // Finalize learning with high score
      if (trajectoryId) {
        try {
          this.jj.addToTrajectory(trajectoryId);
          this.jj.finalizeTrajectory(0.95, `Workflow completed successfully in ${results.duration}ms`);
        } catch (error) {
          // ReasoningBank might not be available
        }
      }

      console.log(`\n✅ Workflow completed successfully in ${results.duration}ms`);

    } catch (error) {
      results.success = false;
      results.error = error.message;
      results.duration = Date.now() - startTime;

      // Store failed workflow for learning
      await this.vectordb.storeWorkflow(results);

      // Finalize learning with low score
      if (trajectoryId) {
        try {
          this.jj.finalizeTrajectory(0.3, `Workflow failed: ${error.message}`);
        } catch (err) {
          // ReasoningBank might not be available
        }
      }

      console.log(`\n❌ Workflow failed: ${error.message}`);
      throw error;
    }

    return results;
  }

  /**
   * Execute steps sequentially
   * @private
   */
  async executeSequential(steps, results) {
    for (const step of steps) {
      const stepResult = await this.executeStep(step);
      results.steps.push(stepResult);

      if (!stepResult.success) {
        throw new Error(`Step failed: ${step.name}`);
      }
    }
  }

  /**
   * Execute steps in parallel
   * @private
   */
  async executeParallel(steps, results) {
    const chunks = [];
    for (let i = 0; i < steps.length; i += this.config.maxParallel) {
      chunks.push(steps.slice(i, i + this.config.maxParallel));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(step => this.executeStep(step));
      const stepResults = await Promise.all(promises);
      results.steps.push(...stepResults);

      // Check if any failed
      const failed = stepResults.find(r => !r.success);
      if (failed) {
        throw new Error(`Step failed: ${failed.name}`);
      }
    }
  }

  /**
   * Execute a single step
   * @private
   */
  async executeStep(step) {
    const startTime = Date.now();
    console.log(`  ⚙️  Executing step: ${step.name}`);

    const result = {
      name: step.name,
      startTime,
      success: false,
      duration: 0,
      output: null
    };

    try {
      // Simulate step execution (replace with actual execution logic)
      if (step.action) {
        result.output = await step.action();
      } else {
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 100));
        result.output = `Completed ${step.name}`;
      }

      result.success = true;
      result.duration = Date.now() - startTime;
      console.log(`     ✓ ${step.name} completed in ${result.duration}ms`);

    } catch (error) {
      result.success = false;
      result.error = error.message;
      result.duration = Date.now() - startTime;
      console.log(`     ✗ ${step.name} failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Apply optimizations to workflow
   * @private
   */
  applyOptimizations(workflow, optimizations) {
    const optimized = { ...workflow };

    // Apply caching if recommended
    const cacheRec = optimizations.recommendations.find(r => r.type === 'caching');
    if (cacheRec) {
      optimized.cacheEnabled = true;
      optimized.cacheConfig = cacheRec.config;
    }

    // Apply parallelization if recommended
    const parallelRec = optimizations.recommendations.find(r => r.type === 'parallelization');
    if (parallelRec && parallelRec.steps) {
      optimized.parallelSteps = parallelRec.steps;
    }

    return optimized;
  }

  /**
   * Get workflow status
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>} Workflow status
   */
  async getWorkflowStatus(workflowId) {
    const metrics = await this.vectordb.getMetrics(workflowId);
    return {
      workflowId,
      metrics,
      active: this.activeWorkflows.has(workflowId)
    };
  }

  /**
   * Get orchestrator statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    const dbStats = await this.vectordb.getStats();
    const coordStats = this.config.enableQuantum && this.quantumBridge
      ? await this.quantumBridge.getStats()
      : null;

    return {
      database: dbStats,
      quantum: coordStats,
      activeWorkflows: this.activeWorkflows.size,
      config: this.config
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    await this.vectordb.cleanup();
    if (this.quantumBridge) {
      await this.quantumBridge.cleanup();
    }
    this.activeWorkflows.clear();
    this.initialized = false;
  }
}

module.exports = { WorkflowOrchestrator };
