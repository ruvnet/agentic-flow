/**
 * Enhanced CI/CD Workflow Orchestrator
 *
 * Adds:
 * - AST-based code analysis (optional, 352x faster than LLM)
 * - Multiple coordination topologies (sequential, mesh, hierarchical, adaptive, gossip)
 * - Self-learning and optimization
 * - Advanced metrics and recommendations
 *
 * @module cicd/enhanced-orchestrator
 */

const { WorkflowOrchestrator } = require('./orchestrator');
const TopologyManager = require('./topology-manager');
const ASTAnalyzer = require('./ast-analyzer');

class EnhancedOrchestrator {
  /**
   * Initialize enhanced orchestrator
   * @param {Object} config - Configuration
   */
  constructor(config = {}) {
    this.config = {
      dbPath: config.dbPath || '.vectordb',
      enableLearning: config.enableLearning !== false,
      enableAST: config.enableAST !== false, // AST analysis (optional)
      topology: config.topology || 'adaptive', // Default topology
      maxParallel: config.maxParallel || 5,
      ...config
    };

    // Core orchestrator (existing functionality)
    this.orchestrator = new WorkflowOrchestrator({
      dbPath: this.config.dbPath,
      enableLearning: this.config.enableLearning,
      enableQuantum: this.config.enableQuantum,
      maxParallel: this.config.maxParallel
    });

    // Topology manager (new: multiple coordination patterns)
    this.topologyManager = new TopologyManager({
      defaultTopology: this.config.topology,
      maxConcurrent: this.config.maxParallel
    });

    // AST analyzer (new: optional code intelligence)
    this.astAnalyzer = new ASTAnalyzer({
      enabled: this.config.enableAST,
      cachePath: `${this.config.dbPath}/.ast-cache`
    });

    this.initialized = false;

    this.stats = {
      totalWorkflows: 0,
      successfulWorkflows: 0,
      failedWorkflows: 0,
      avgDuration: 0,
      topologiesUsed: {},
      astAnalysesPerformed: 0
    };
  }

  /**
   * Initialize the enhanced orchestrator
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[EnhancedOrchestrator] Initializing...');

    // Initialize core orchestrator
    await this.orchestrator.initialize();

    // Initialize AST analyzer
    if (this.config.enableAST) {
      await this.astAnalyzer.initialize();
      console.log('[EnhancedOrchestrator] AST analyzer initialized');
    }

    this.initialized = true;
    console.log('[EnhancedOrchestrator] Ready');
  }

  /**
   * Execute workflow with enhanced features
   * @param {Object} workflow - Workflow definition
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  async executeWorkflow(workflow, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    console.log(`\n🚀 [EnhancedOrchestrator] Executing: ${workflow.name}`);

    // Step 1: AST analysis (if enabled and files provided)
    let astAnalysis = null;
    if (this.config.enableAST && (workflow.files || workflow.sourceFiles)) {
      console.log('\n📝 [AST Analysis] Analyzing code quality...');
      astAnalysis = await this.astAnalyzer.analyzeWorkflow(workflow);

      if (astAnalysis.enabled) {
        this.stats.astAnalysesPerformed++;

        console.log(`   ✅ AST Analysis: ${astAnalysis.summary.totalFiles} files, ` +
          `quality score ${astAnalysis.summary.qualityScore}/100, ` +
          `${astAnalysis.summary.patterns.length} patterns found ` +
          `(${astAnalysis.analysisTime}ms, ${astAnalysis.boosterMode ? 'agent-booster' : 'fallback'})`);

        if (astAnalysis.summary.patterns.length > 0) {
          console.log(`   ⚠️  Code patterns detected:`);
          astAnalysis.summary.patterns.slice(0, 3).forEach(p => {
            console.log(`      - [${p.priority}] ${p.type}: ${p.message}`);
          });
        }
      }
    }

    // Step 2: Get topology recommendation
    const topologyOptions = {
      topology: options.topology || this.config.topology,
      context: {
        ...options.context,
        astAnalysis
      }
    };

    if (topologyOptions.topology === 'auto' || topologyOptions.topology === 'adaptive') {
      // Use topology manager's recommendation
      const recommendation = this.topologyManager.recommendTopology(
        workflow.steps || [],
        topologyOptions.context
      );

      console.log(`\n🎯 [Topology] Recommendation: ${recommendation.bestTopology}`);
      console.log(`   Reasons: ${recommendation.recommendations[0].reasons.join(', ')}`);

      topologyOptions.topology = options.topology === 'auto'
        ? recommendation.bestTopology
        : 'adaptive';
    }

    console.log(`   Selected topology: ${topologyOptions.topology}`);

    // Step 3: Execute with selected topology
    const result = await this.executeWithTopology(workflow, topologyOptions);

    const totalDuration = Date.now() - startTime;

    // Step 4: Store results and learn
    this.stats.totalWorkflows++;
    if (result.success) {
      this.stats.successfulWorkflows++;
    } else {
      this.stats.failedWorkflows++;
    }

    this.stats.avgDuration = ((this.stats.avgDuration * (this.stats.totalWorkflows - 1)) + totalDuration) / this.stats.totalWorkflows;

    const topologyUsed = result.selectedTopology || topologyOptions.topology;
    this.stats.topologiesUsed[topologyUsed] = (this.stats.topologiesUsed[topologyUsed] || 0) + 1;

    return {
      ...result,
      astAnalysis,
      totalDuration,
      enhancedStats: this.getStats()
    };
  }

  /**
   * Execute workflow with specific topology
   * @private
   */
  async executeWithTopology(workflow, options) {
    const topology = options.topology;

    // Convert workflow steps to topology tasks
    const tasks = (workflow.steps || []).map(step => ({
      name: step.name,
      action: step.action || (async () => {
        // Default action: simulate work
        await new Promise(resolve => setTimeout(resolve, 50));
        return `Completed ${step.name}`;
      }),
      type: step.type || 'default',
      priority: step.priority || 'medium',
      dependencies: step.dependencies || []
    }));

    // Execute using topology manager
    const result = await this.topologyManager.execute(tasks, {
      topology,
      context: options.context
    });

    // Also store in vectordb for learning
    await this.orchestrator.vectordb.storeWorkflow({
      name: workflow.name,
      duration: result.duration,
      success: result.success,
      steps: workflow.steps || [],
      topology: result.selectedTopology || topology,
      metrics: {
        taskCount: tasks.length,
        successRate: result.results.filter(r => r.success).length / result.results.length,
        ...result.stats
      }
    });

    return result;
  }

  /**
   * Benchmark all topologies on a given workflow
   */
  async benchmark(workflow, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`\n📊 [EnhancedOrchestrator] Benchmarking workflow: ${workflow.name}\n`);

    // Convert workflow to tasks
    const tasks = (workflow.steps || []).map(step => ({
      name: step.name,
      action: step.action || (async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return `Completed ${step.name}`;
      }),
      type: step.type || 'default',
      priority: step.priority || 'medium',
      dependencies: step.dependencies || []
    }));

    // Benchmark all topologies
    const benchmarkResults = await this.topologyManager.benchmark(tasks, options.context);

    // Include AST analysis in benchmark
    let astBenchmark = null;
    if (this.config.enableAST && (workflow.files || workflow.sourceFiles)) {
      const astStart = Date.now();
      astBenchmark = await this.astAnalyzer.analyzeWorkflow(workflow);
      astBenchmark.benchmarkDuration = Date.now() - astStart;
    }

    return {
      workflow: workflow.name,
      topologyResults: benchmarkResults.results,
      winner: benchmarkResults.winner,
      astBenchmark,
      recommendations: this.generateRecommendations(benchmarkResults, astBenchmark)
    };
  }

  /**
   * Generate recommendations based on benchmark results
   * @private
   */
  generateRecommendations(benchmarkResults, astBenchmark) {
    const recommendations = [];

    // Topology recommendation
    const winner = benchmarkResults.winner;
    if (winner) {
      recommendations.push({
        category: 'topology',
        priority: 'high',
        message: `Use ${winner.topology} topology for this workload`,
        expectedImprovement: `Best performance: ${winner.duration}ms with ${(winner.successRate * 100).toFixed(1)}% success`,
        implementation: `Set topology: '${winner.topology}' in config`
      });
    }

    // AST recommendations
    if (astBenchmark && astBenchmark.enabled) {
      if (astBenchmark.summary.patterns.length > 0) {
        recommendations.push({
          category: 'code-quality',
          priority: 'medium',
          message: `${astBenchmark.summary.patterns.length} code quality issues detected`,
          expectedImprovement: 'Addressing these may improve reliability',
          patterns: astBenchmark.summary.patterns.slice(0, 5)
        });
      }

      if (astBenchmark.boosterMode) {
        recommendations.push({
          category: 'performance',
          priority: 'low',
          message: 'Using agent-booster for fast AST analysis (352x faster than LLM)',
          expectedImprovement: 'Already optimal'
        });
      } else {
        recommendations.push({
          category: 'performance',
          priority: 'medium',
          message: 'Install agent-booster for 352x faster code analysis',
          expectedImprovement: '352x faster AST operations',
          implementation: 'npm install -g agentic-flow'
        });
      }
    }

    return recommendations;
  }

  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      enhanced: this.stats,
      topology: this.topologyManager.getStats(),
      ast: this.astAnalyzer.getStats(),
      orchestrator: this.orchestrator.vectordb.getStats()
    };
  }

  /**
   * Get optimization recommendations for a workflow
   */
  async getOptimizations(workflow) {
    // Get vectordb optimizations
    const vectorOptimizations = await this.orchestrator.vectordb.getOptimizations({
      name: workflow.name,
      steps: workflow.steps || []
    });

    // Get topology recommendations
    const topologyRec = this.topologyManager.recommendTopology(
      workflow.steps || [],
      {}
    );

    // Combine recommendations
    return {
      vectorDB: vectorOptimizations,
      topology: topologyRec,
      combined: [
        ...vectorOptimizations.recommendations,
        {
          type: 'topology',
          priority: 'high',
          message: `Use ${topologyRec.bestTopology} topology`,
          expectedImprovement: topologyRec.recommendations[0]?.reasons?.join(', ') || 'Optimal coordination',
          reasons: topologyRec.recommendations[0]?.reasons || []
        }
      ]
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    await this.orchestrator.cleanup();
    await this.astAnalyzer.cleanup();
    this.topologyManager.reset();
    this.initialized = false;
  }
}

module.exports = { EnhancedOrchestrator };
