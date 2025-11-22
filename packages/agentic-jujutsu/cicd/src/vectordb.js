/**
 * VectorDB Integration for CI/CD Metrics and Learning
 *
 * This module provides a high-performance vector database for storing and querying
 * CI/CD metrics, workflow patterns, and learning trajectories using AgentDB.
 *
 * Features:
 * - Fast vector similarity search for pattern matching
 * - Persistent storage of workflow metrics
 * - Learning from successful/failed pipelines
 * - Optimization recommendations based on historical data
 *
 * @module cicd/vectordb
 */

const fs = require('fs').promises;
const path = require('path');

// Optional dependency - gracefully handle if not available
let JjWrapper;
try {
  const aj = require('agentic-jujutsu');
  JjWrapper = aj.JjWrapper;
} catch (err) {
  // Mock JjWrapper for testing
  JjWrapper = class {
    async enableAgentCoordination() {}
    async registerAgentOperation() {}
    startTrajectory() { return 'test-trajectory'; }
    addToTrajectory() {}
    finalizeTrajectory() {}
  };
}

/**
 * VectorDB for CI/CD metrics and learning
 */
class CICDVectorDB {
  /**
   * Initialize VectorDB
   * @param {Object} config - Configuration options
   * @param {string} config.dbPath - Path to store vector DB data
   * @param {number} config.vectorDim - Vector dimensions (default: 384)
   * @param {number} config.maxEntries - Maximum entries to keep (default: 10000)
   */
  constructor(config = {}) {
    this.dbPath = config.dbPath || path.join(__dirname, '../.vectordb');
    this.vectorDim = config.vectorDim || 384;
    this.maxEntries = config.maxEntries || 10000;
    this.jj = new JjWrapper();

    // Performance optimization config
    this.batchSize = config.batchSize || 10; // Write every N workflows
    this.batchInterval = config.batchInterval || 5000; // Or every X ms
    this.cacheVectors = config.cacheVectors !== false; // Enable vector caching
    this.earlyTermination = config.earlyTermination !== false; // Enable early search termination

    // In-memory cache for fast access
    this.cache = {
      workflows: new Map(),
      metrics: new Map(),
      patterns: new Map(),
      trajectories: new Map(),
      vectors: new Map(), // Cache computed vectors
      queryResults: new Map() // Cache query results (TTL: 60s)
    };

    // Batch processing queues
    this.pendingWrites = 0;
    this.lastSaveTime = Date.now();
    this.patternQueue = [];
    this.saveTimer = null;

    this.initialized = false;
  }

  /**
   * Initialize the vector database
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure DB directory exists
      await fs.mkdir(this.dbPath, { recursive: true });

      // Enable AgentDB for operation tracking
      await this.jj.enableAgentCoordination();

      // Load existing data if available
      await this.loadFromDisk();

      this.initialized = true;
      console.log(`[CICDVectorDB] Initialized at ${this.dbPath}`);
    } catch (error) {
      console.error('[CICDVectorDB] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Store workflow execution data
   * @param {Object} workflow - Workflow execution data
   * @param {string} workflow.id - Workflow ID
   * @param {string} workflow.name - Workflow name
   * @param {number} workflow.duration - Execution duration (ms)
   * @param {boolean} workflow.success - Success status
   * @param {Object} workflow.metrics - Additional metrics
   * @param {string[]} workflow.steps - Executed steps
   * @returns {Promise<string>} Stored workflow ID
   */
  async storeWorkflow(workflow) {
    if (!this.initialized) {
      await this.initialize();
    }

    const id = workflow.id || this.generateId();
    const timestamp = Date.now();

    // Create workflow vector from metrics (with caching)
    const vector = this.createWorkflowVector(workflow);

    const entry = {
      id,
      timestamp,
      ...workflow,
      vector,
      embedding: this.createEmbedding(workflow)
    };

    // Store in cache
    this.cache.workflows.set(id, entry);

    // Store in AgentDB for persistent tracking (non-blocking)
    this.storeInAgentDB('workflow', entry).catch(() => {}); // Fire and forget

    // Queue pattern learning for batch processing (deferred)
    if (workflow.success) {
      this.queuePatternLearning(entry, 'success');
    } else {
      this.queuePatternLearning(entry, 'failure');
    }

    // Batch disk writes (only write every N workflows or X seconds)
    this.pendingWrites++;
    await this.maybeFlushToDisk();

    console.log(`[CICDVectorDB] Stored workflow ${id}: ${workflow.name} (${workflow.duration}ms)`);
    return id;
  }

  /**
   * Query similar workflows using vector similarity
   * @param {Object} query - Query parameters
   * @param {Object} query.metrics - Metrics to match
   * @param {number} query.limit - Number of results (default: 10)
   * @param {number} query.threshold - Similarity threshold (default: 0.7)
   * @returns {Promise<Array>} Similar workflows with scores
   */
  async querySimilar(query) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check cache first (60s TTL)
    const cacheKey = JSON.stringify(query);
    const cached = this.cache.queryResults.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 60000)) {
      return cached.results;
    }

    const queryVector = this.createWorkflowVector(query.metrics || {});
    const limit = query.limit || 10;
    const threshold = query.threshold || 0.7;

    const results = [];

    // Calculate similarity scores with early termination
    for (const [id, workflow] of this.cache.workflows) {
      const similarity = this.cosineSimilarity(queryVector, workflow.vector);

      if (similarity >= threshold) {
        results.push({
          id,
          workflow,
          similarity,
          score: similarity * 100
        });

        // Early termination: if we have enough high-quality results, stop searching
        if (this.earlyTermination && results.length >= limit * 2 && similarity >= 0.9) {
          break;
        }
      }
    }

    // Sort by similarity (highest first)
    results.sort((a, b) => b.similarity - a.similarity);

    const finalResults = results.slice(0, limit);

    // Cache results
    this.cache.queryResults.set(cacheKey, {
      results: finalResults,
      timestamp: Date.now()
    });

    return finalResults;
  }

  /**
   * Get optimization recommendations based on historical data
   * @param {Object} currentWorkflow - Current workflow metrics
   * @returns {Promise<Object>} Optimization recommendations
   */
  async getOptimizations(currentWorkflow) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Find similar successful workflows
    const similar = await this.querySimilar({
      metrics: currentWorkflow,
      limit: 20,
      threshold: 0.6
    });

    const successful = similar.filter(s => s.workflow.success);

    if (successful.length === 0) {
      return {
        recommendations: [],
        confidence: 0,
        message: 'No similar successful workflows found'
      };
    }

    // Analyze patterns
    const recommendations = [];
    const patterns = this.analyzePatterns(successful);

    // Caching recommendations
    if (patterns.cacheHitRate && patterns.cacheHitRate > 0.8) {
      recommendations.push({
        type: 'caching',
        priority: 'high',
        message: 'Enable aggressive caching - 80%+ hit rate observed',
        expectedImprovement: '60-80% faster',
        config: patterns.optimalCacheConfig
      });
    }

    // Parallelization recommendations
    if (patterns.parallelSteps && patterns.parallelSteps.length > 0) {
      recommendations.push({
        type: 'parallelization',
        priority: 'high',
        message: `Run ${patterns.parallelSteps.length} steps in parallel`,
        expectedImprovement: '40-60% faster',
        steps: patterns.parallelSteps
      });
    }

    // Step optimization
    if (patterns.slowSteps && patterns.slowSteps.length > 0) {
      recommendations.push({
        type: 'step-optimization',
        priority: 'medium',
        message: `Optimize ${patterns.slowSteps.length} slow steps`,
        steps: patterns.slowSteps
      });
    }

    // Resource allocation
    if (patterns.optimalResources) {
      recommendations.push({
        type: 'resources',
        priority: 'medium',
        message: 'Adjust resource allocation for optimal performance',
        resources: patterns.optimalResources
      });
    }

    const confidence = this.calculateConfidence(successful.length, patterns);

    return {
      recommendations,
      confidence,
      basedOn: successful.length,
      averageImprovement: patterns.averageImprovement || 0,
      patterns
    };
  }

  /**
   * Store metrics for a specific workflow run
   * @param {string} workflowId - Workflow ID
   * @param {Object} metrics - Metrics to store
   * @returns {Promise<void>}
   */
  async storeMetrics(workflowId, metrics) {
    const id = `${workflowId}-${Date.now()}`;
    this.cache.metrics.set(id, {
      workflowId,
      timestamp: Date.now(),
      ...metrics
    });

    await this.saveToDisk();
  }

  /**
   * Get all metrics for a workflow
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Array>} All metrics for workflow
   */
  async getMetrics(workflowId) {
    const results = [];
    for (const [id, metric] of this.cache.metrics) {
      if (metric.workflowId === workflowId) {
        results.push(metric);
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    return {
      workflows: this.cache.workflows.size,
      metrics: this.cache.metrics.size,
      patterns: this.cache.patterns.size,
      trajectories: this.cache.trajectories.size,
      totalSize: this.calculateSize(),
      initialized: this.initialized,
      dbPath: this.dbPath
    };
  }

  // ===== Private Methods =====

  /**
   * Create workflow vector from metrics (with caching)
   * @private
   */
  createWorkflowVector(workflow) {
    // Check cache first
    if (this.cacheVectors) {
      const cacheKey = JSON.stringify(workflow);
      const cached = this.cache.vectors.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Simple vector representation of workflow
    // In production, use proper embedding model
    const features = [
      workflow.duration || 0,
      workflow.steps?.length || 0,
      workflow.success ? 1 : 0,
      workflow.cacheHits || 0,
      workflow.parallelJobs || 0,
      workflow.cpuUsage || 0,
      workflow.memoryUsage || 0,
      workflow.testCount || 0,
      workflow.coverage || 0
    ];

    // Normalize to fixed dimension
    while (features.length < this.vectorDim) {
      features.push(0);
    }

    const vector = features.slice(0, this.vectorDim);

    // Cache the vector
    if (this.cacheVectors) {
      this.cache.vectors.set(JSON.stringify(workflow), vector);

      // LRU eviction: keep only recent 1000 vectors
      if (this.cache.vectors.size > 1000) {
        const firstKey = this.cache.vectors.keys().next().value;
        this.cache.vectors.delete(firstKey);
      }
    }

    return vector;
  }

  /**
   * Create text embedding from workflow
   * @private
   */
  createEmbedding(workflow) {
    return {
      name: workflow.name,
      steps: workflow.steps?.join(' ') || '',
      status: workflow.success ? 'success' : 'failure',
      tags: workflow.tags || []
    };
  }

  /**
   * Calculate cosine similarity between vectors
   * @private
   */
  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Analyze patterns from successful workflows
   * @private
   */
  analyzePatterns(workflows) {
    const patterns = {
      cacheHitRate: 0,
      parallelSteps: [],
      slowSteps: [],
      optimalResources: {},
      averageImprovement: 0
    };

    if (workflows.length === 0) {
      return patterns;
    }

    // Calculate average cache hit rate
    const cacheHits = workflows.map(w => w.workflow.cacheHits || 0);
    patterns.cacheHitRate = cacheHits.reduce((a, b) => a + b, 0) / workflows.length;

    // Find commonly parallelized steps
    const stepCounts = new Map();
    workflows.forEach(w => {
      (w.workflow.steps || []).forEach(step => {
        stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
      });
    });

    patterns.parallelSteps = Array.from(stepCounts.entries())
      .filter(([_, count]) => count > workflows.length * 0.5)
      .map(([step, _]) => step);

    // Find optimal resources
    if (workflows.length > 0) {
      patterns.optimalResources = {
        cpu: Math.max(...workflows.map(w => w.workflow.cpuUsage || 2)),
        memory: Math.max(...workflows.map(w => w.workflow.memoryUsage || 4096))
      };
    }

    return patterns;
  }

  /**
   * Calculate confidence score for recommendations
   * @private
   */
  calculateConfidence(sampleSize, patterns) {
    // Base confidence on sample size
    let confidence = Math.min(sampleSize / 20, 1.0);

    // Boost if patterns are strong
    if (patterns.cacheHitRate > 0.8) {
      confidence *= 1.2;
    }
    if (patterns.parallelSteps.length > 3) {
      confidence *= 1.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Queue pattern learning for batch processing (deferred)
   * @private
   */
  queuePatternLearning(workflow, type) {
    this.patternQueue.push({ workflow, type, timestamp: Date.now() });

    // Process queue in batches
    if (this.patternQueue.length >= this.batchSize) {
      this.processPatternQueue();
    }
  }

  /**
   * Process queued pattern learning in batch
   * @private
   */
  processPatternQueue() {
    const batch = this.patternQueue.splice(0, this.batchSize);

    for (const { workflow, type } of batch) {
      const pattern = {
        id: this.generateId(),
        type,
        timestamp: Date.now(),
        workflow: workflow.id,
        duration: workflow.duration,
        steps: workflow.steps,
        metrics: workflow.metrics,
        error: workflow.error
      };

      this.cache.patterns.set(pattern.id, pattern);

      // Use ReasoningBank for learning (non-blocking)
      if (type === 'success') {
        try {
          const trajectoryId = this.jj.startTrajectory(`Successful workflow: ${workflow.name}`);
          this.jj.addToTrajectory(trajectoryId);
          this.jj.finalizeTrajectory(0.95, `Success pattern: ${workflow.duration}ms`);
        } catch (error) {
          // ReasoningBank might not be available
        }
      }
    }
  }

  /**
   * Store data in AgentDB
   * @private
   */
  async storeInAgentDB(type, data) {
    try {
      // Use JjWrapper's operation tracking
      await this.jj.registerAgentOperation(
        `cicd-${type}`,
        `store-${data.id}`,
        [`cicd/${type}/${data.id}`]
      );
    } catch (error) {
      // AgentDB might not be available in all environments
      console.log(`[CICDVectorDB] AgentDB storage skipped: ${error.message}`);
    }
  }

  /**
   * Load data from disk
   * @private
   */
  async loadFromDisk() {
    try {
      const files = ['workflows.json', 'metrics.json', 'patterns.json'];

      for (const file of files) {
        const filePath = path.join(this.dbPath, file);
        try {
          const data = await fs.readFile(filePath, 'utf8');
          const parsed = JSON.parse(data);
          const mapName = file.replace('.json', '');

          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              this.cache[mapName].set(item.id, item);
            });
          }
        } catch (err) {
          // File doesn't exist yet, that's okay
        }
      }
    } catch (error) {
      console.log('[CICDVectorDB] No existing data to load');
    }
  }

  /**
   * Maybe flush to disk (batch writes)
   * @private
   */
  async maybeFlushToDisk() {
    const timeSinceLastSave = Date.now() - this.lastSaveTime;

    // Flush if we've accumulated enough writes OR enough time has passed
    if (this.pendingWrites >= this.batchSize || timeSinceLastSave >= this.batchInterval) {
      await this.flushToDisk();
    } else {
      // Schedule a flush if not already scheduled
      if (!this.saveTimer) {
        this.saveTimer = setTimeout(() => {
          this.flushToDisk();
        }, this.batchInterval - timeSinceLastSave);
      }
    }
  }

  /**
   * Flush pending writes to disk
   * @private
   */
  async flushToDisk() {
    if (this.pendingWrites === 0) {
      return;
    }

    // Clear timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // Process any queued patterns first
    if (this.patternQueue.length > 0) {
      this.processPatternQueue();
    }

    await this.saveToDisk();

    this.pendingWrites = 0;
    this.lastSaveTime = Date.now();
  }

  /**
   * Save data to disk
   * @private
   */
  async saveToDisk() {
    try {
      const saves = [
        { name: 'workflows', data: Array.from(this.cache.workflows.values()) },
        { name: 'metrics', data: Array.from(this.cache.metrics.values()) },
        { name: 'patterns', data: Array.from(this.cache.patterns.values()) }
      ];

      for (const { name, data } of saves) {
        const filePath = path.join(this.dbPath, `${name}.json`);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error('[CICDVectorDB] Failed to save to disk:', error);
    }
  }

  /**
   * Calculate total size
   * @private
   */
  calculateSize() {
    return (
      this.cache.workflows.size +
      this.cache.metrics.size +
      this.cache.patterns.size +
      this.cache.trajectories.size
    );
  }

  /**
   * Generate unique ID
   * @private
   */
  generateId() {
    return `cicd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Flush any pending writes
    await this.flushToDisk();

    // Clear timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.cache.workflows.clear();
    this.cache.metrics.clear();
    this.cache.patterns.clear();
    this.cache.trajectories.clear();
    this.cache.vectors.clear();
    this.cache.queryResults.clear();
    this.patternQueue = [];
    this.initialized = false;
  }
}

module.exports = { CICDVectorDB };
