/**
 * Permit Platform Integration Adapter (Production-Ready v1.0)
 *
 * Uses agentic-flow's built-in Supabase federation adapter
 * to sync research-swarm jobs with permit platform database.
 *
 * Features:
 * - Exponential backoff retry logic
 * - Batch sync for high-frequency updates
 * - Progress throttling
 * - Metrics and observability
 * - Connection health monitoring
 * - Graceful degradation
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { createJob, updateProgress, markComplete, getDatabase } from './db-utils.js';

// SupabaseFederationAdapter is not in agentic-flow's "exports", so locate the
// file through the package root (its package.json is exported). Resolving the
// peer this way works in flat installs too; the old '../node_modules/...' path
// only worked when agentic-flow was nested inside research-swarm. Loaded
// lazily so the package entry imports even without the agentic-flow peer.
let adapterModulePromise = null;
function loadSupabaseFederationAdapter() {
  if (!adapterModulePromise) {
    adapterModulePromise = (async () => {
      const require = createRequire(import.meta.url);
      const pkgJson = require.resolve('agentic-flow/package.json');
      const url = new URL('./dist/federation/integrations/supabase-adapter.js', pathToFileURL(pkgJson));
      const { SupabaseFederationAdapter } = await import(url.href);
      return SupabaseFederationAdapter;
    })();
  }
  return adapterModulePromise;
}

export class PermitPlatformAdapter {
  constructor(config) {
    const {
      supabaseUrl,
      supabaseServiceKey,
      tenantId,
      enableRealtimeSync = true,
      syncInterval = 5000,  // 5 seconds
      batchSize = 10,
      retryAttempts = 3,
      progressThrottle = 1000,  // 1 second min between updates
      enableMetrics = true,
      enableHealthMonitoring = true,
      healthCheckInterval = 30000  // 30 seconds
    } = config;

    // agentic-flow's built-in Supabase adapter, created in initialize()
    this.supabaseConfig = {
      url: supabaseUrl,
      anonKey: supabaseServiceKey,
      serviceRoleKey: supabaseServiceKey,
      vectorBackend: 'hybrid',  // Use both AgentDB (fast) + pgvector (persistent)
      syncInterval
    };
    this.supabase = null;

    this.tenantId = tenantId;
    this.enableRealtimeSync = enableRealtimeSync;
    this.syncInterval = syncInterval;
    this.batchSize = batchSize;
    this.retryAttempts = retryAttempts;
    this.progressThrottle = progressThrottle;
    this.enableMetrics = enableMetrics;
    this.enableHealthMonitoring = enableHealthMonitoring;
    this.healthCheckInterval = healthCheckInterval;

    // Update queue for batch sync
    this.updateQueue = [];
    this.flushInterval = 2000; // Flush every 2 seconds

    // Progress throttling
    this.lastProgressUpdate = new Map(); // jobId -> timestamp

    // Metrics
    this.metrics = {
      totalUpdates: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      syncLatency: [], // Array of latency measurements
      lastError: null,
      startTime: Date.now()
    };

    // Timers
    this.syncTimer = null;
    this.batchTimer = null;
    this.healthTimer = null;
  }

  /**
   * Initialize adapter with Supabase schema
   */
  async initialize() {
    console.log('🔧 Initializing Permit Platform Adapter...');

    try {
      // Initialize Supabase federation schema
      if (!this.supabase) {
        const SupabaseFederationAdapter = await loadSupabaseFederationAdapter();
        this.supabase = new SupabaseFederationAdapter(this.supabaseConfig);
      }
      await this.supabase.initialize();

      // Verify permit_research_jobs table exists
      await this.ensurePermitTables();

      // Start connection health monitoring
      if (this.enableHealthMonitoring) {
        this.startHealthMonitoring();
      }

      // Start batch sync
      if (this.enableRealtimeSync) {
        this.startBatchSync();
      }

      console.log('✅ Permit Platform Adapter Ready');
      console.log(`   Real-time Sync: ${this.enableRealtimeSync ? 'Enabled' : 'Disabled'}`);
      console.log(`   Batch Size: ${this.batchSize}`);
      console.log(`   Retry Attempts: ${this.retryAttempts}`);
      console.log(`   Health Monitoring: ${this.enableHealthMonitoring ? 'Enabled' : 'Disabled'}`);

    } catch (err) {
      console.warn('⚠️  Adapter initialization failed:', err.message);
      console.log('📝 Falling back to local-only mode');
      this.enableRealtimeSync = false;
    }
  }

  /**
   * Ensure permit-specific tables exist
   */
  async ensurePermitTables() {
    try {
      // Check if permit_research_jobs table exists
      const { error } = await this.supabase.client
        .from('permit_research_jobs')
        .select('id')
        .limit(1);

      if (error && error.code === 'PGRST116') {
        console.warn('⚠️  permit_research_jobs table not found');
        console.log('📖 Please run: psql $DATABASE_URL -f schema/supabase/permit_tables.sql');
        throw new Error('Permit tables not found');
      }
    } catch (err) {
      throw new Error(`Table verification failed: ${err.message}`);
    }
  }

  /**
   * Create job in both AgentDB (SQLite) and Supabase
   */
  async createJob(jobData) {
    const {
      id,
      agent,
      task,
      config,
      userId,
      agentType
    } = jobData;

    // 1. Create in local AgentDB (fast)
    const localJobId = createJob({
      id,
      agent,
      task,
      config: JSON.stringify(config)
    });

    // 2. Sync to Supabase (persistent + real-time)
    if (this.enableRealtimeSync) {
      await this.retryOperation(async () => {
        const { error } = await this.supabase.client
          .from('permit_research_jobs')
          .insert({
            id: localJobId,
            tenant_id: this.tenantId,
            user_id: userId,
            agent_type: agentType,
            agent_name: agent,
            task_description: task,
            status: 'pending',
            progress: 0,
            current_message: 'Job created',
            config: config,
            swarm_mode: config.swarmMode || true,
            swarm_size: config.swarmSize || 5,
            created_at: new Date().toISOString()
          });

        if (error) throw error;

        // Register session in federation system
        await this.supabase.registerSession(
          localJobId,
          this.tenantId,
          agent,
          {
            jobType: 'research',
            permitPlatform: true,
            config
          }
        );
      }, this.retryAttempts);
    }

    return localJobId;
  }

  /**
   * Update progress (queued for batch sync)
   */
  async updateProgress(jobId, progress, message, additionalData = {}) {
    // 1. Update local AgentDB immediately (always fast)
    updateProgress(jobId, progress, message, additionalData);

    // 2. Throttle and queue Supabase updates
    if (this.enableRealtimeSync) {
      const lastUpdate = this.lastProgressUpdate.get(jobId) || 0;
      const now = Date.now();

      // Skip if too soon (unless completion)
      if (now - lastUpdate < this.progressThrottle && progress < 95) {
        return; // Throttled
      }

      this.lastProgressUpdate.set(jobId, now);
      this.metrics.totalUpdates++;

      // Queue for batch sync
      this.updateQueue.push({
        jobId,
        progress: Math.min(progress, 95),
        message,
        additionalData,
        timestamp: now
      });

      // Immediate flush for completion
      if (progress >= 95) {
        await this.flushUpdates();
      }
    }
  }

  /**
   * Mark job complete with report
   */
  async markComplete(jobId, completionData) {
    const {
      exitCode,
      reportContent,
      reportFormat,
      swarmResults,
      durationSeconds,
      learningPatterns,
      tokensUsed,
      estimatedCost,
      providerBreakdown
    } = completionData;

    // 1. Update local AgentDB
    markComplete(jobId, completionData);

    // 2. Sync to Supabase (with retries)
    if (this.enableRealtimeSync) {
      await this.retryOperation(async () => {
        const status = exitCode === 0 ? 'completed' : 'failed';

        const { error } = await this.supabase.client
          .from('permit_research_jobs')
          .update({
            status,
            progress: 100,
            current_message: exitCode === 0 ? 'Completed successfully' : 'Job failed',
            report_content: reportContent,
            report_format: reportFormat,
            swarm_results: swarmResults,
            duration_seconds: durationSeconds,
            tokens_used: tokensUsed,
            estimated_cost: estimatedCost,
            provider_breakdown: providerBreakdown,
            completed_at: new Date().toISOString()
          })
          .eq('id', jobId)
          .eq('tenant_id', this.tenantId);

        if (error) throw error;

        // Store learning patterns in federation memory
        if (learningPatterns && learningPatterns.length > 0) {
          await this.storeLearningPatterns(jobId, learningPatterns);
        }
      }, this.retryAttempts);
    }
  }

  /**
   * Store learning patterns in Supabase for cross-session learning
   */
  async storeLearningPatterns(jobId, patterns) {
    try {
      for (const pattern of patterns) {
        await this.supabase.storeMemory({
          id: `${jobId}-${pattern.id}`,
          tenant_id: this.tenantId,
          agent_id: pattern.agentId,
          session_id: jobId,
          content: JSON.stringify({
            task: pattern.task,
            approach: pattern.approach,
            success: pattern.success,
            reward: pattern.reward
          }),
          embedding: pattern.embedding,
          metadata: {
            jobId,
            patternType: 'research',
            complexity: pattern.complexity,
            duration: pattern.duration
          }
        });
      }

      console.log(`🧠 Stored ${patterns.length} learning patterns in Supabase`);
    } catch (err) {
      console.warn('⚠️  Pattern storage failed:', err.message);
    }
  }

  /**
   * Start batch sync timer
   */
  startBatchSync() {
    if (this.batchTimer) return;

    console.log(`🔄 Starting batch sync (flush every ${this.flushInterval}ms)...`);

    this.batchTimer = setInterval(async () => {
      await this.flushUpdates();
    }, this.flushInterval);
  }

  /**
   * Flush pending updates to Supabase
   */
  async flushUpdates() {
    if (this.updateQueue.length === 0) return;

    // Get unique job updates (latest per job)
    const latestUpdates = new Map();
    for (const update of this.updateQueue) {
      latestUpdates.set(update.jobId, update);
    }

    // Clear queue
    this.updateQueue = [];

    // Batch sync to Supabase
    const updates = Array.from(latestUpdates.values());
    await this.syncBatch(updates);
  }

  /**
   * Sync batch of updates to Supabase with metrics
   */
  async syncBatch(updates) {
    const startTime = Date.now();

    for (const update of updates) {
      try {
        await this.retryOperation(async () => {
          const { error } = await this.supabase.client
            .from('permit_research_jobs')
            .update({
              progress: update.progress,
              current_message: update.message,
              last_update: new Date().toISOString(),
              ...update.additionalData
            })
            .eq('id', update.jobId)
            .eq('tenant_id', this.tenantId);

          if (error) throw error;
        }, this.retryAttempts);

        this.metrics.successfulSyncs++;

      } catch (err) {
        this.metrics.failedSyncs++;
        this.metrics.lastError = err.message;
        console.warn(`⚠️  Sync failed for job ${update.jobId}:`, err.message);
      }
    }

    const latency = Date.now() - startTime;
    this.metrics.syncLatency.push(latency);

    // Keep only last 100 measurements
    if (this.metrics.syncLatency.length > 100) {
      this.metrics.syncLatency.shift();
    }

    if (updates.length > 0) {
      console.log(`✅ Synced ${updates.length} updates in ${latency}ms`);
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryOperation(operation, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        if (attempt === maxRetries) {
          console.warn(`⚠️  Operation failed after ${maxRetries} attempts:`, err.message);
          return; // Graceful fallback
        }

        const backoff = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.warn(`⚠️  Attempt ${attempt} failed, retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  /**
   * Start connection health monitoring
   */
  startHealthMonitoring() {
    if (this.healthTimer) return;

    console.log(`🏥 Starting health monitoring (check every ${this.healthCheckInterval}ms)...`);

    this.healthTimer = setInterval(async () => {
      try {
        // Simple health check query
        const { error } = await this.supabase.client
          .from('permit_research_jobs')
          .select('id')
          .limit(1);

        if (error) {
          console.warn('⚠️  Supabase connection unhealthy:', error.message);

          if (this.enableRealtimeSync) {
            console.log('🛑 Disabling real-time sync until connection restored');
            this.enableRealtimeSync = false;
          }
        } else {
          // Connection healthy
          if (!this.enableRealtimeSync && this.config?.enableRealtimeSync !== false) {
            console.log('✅ Supabase connection restored');
            this.enableRealtimeSync = true;
          }
        }
      } catch (err) {
        console.warn('⚠️  Health check failed:', err.message);
      }
    }, this.healthCheckInterval);
  }

  /**
   * Query similar research jobs using semantic search
   */
  async findSimilarJobs(taskEmbedding, limit = 5) {
    try {
      const memories = await this.supabase.semanticSearch(
        taskEmbedding,
        this.tenantId,
        limit
      );

      return memories.map(m => ({
        jobId: m.metadata?.jobId,
        similarity: m.similarity,
        task: JSON.parse(m.content).task,
        success: JSON.parse(m.content).success
      }));
    } catch (err) {
      console.warn('⚠️  Semantic search failed:', err.message);
      return [];
    }
  }

  /**
   * Get adapter metrics
   */
  getMetrics() {
    const avgLatency = this.metrics.syncLatency.length > 0
      ? this.metrics.syncLatency.reduce((a, b) => a + b, 0) / this.metrics.syncLatency.length
      : 0;

    const uptime = Date.now() - this.metrics.startTime;

    return {
      totalUpdates: this.metrics.totalUpdates,
      successfulSyncs: this.metrics.successfulSyncs,
      failedSyncs: this.metrics.failedSyncs,
      successRate: this.metrics.totalUpdates > 0
        ? ((this.metrics.successfulSyncs / this.metrics.totalUpdates) * 100).toFixed(2) + '%'
        : '0%',
      avgLatency: avgLatency.toFixed(2) + 'ms',
      lastError: this.metrics.lastError,
      uptime: Math.floor(uptime / 1000) + 's',
      queueSize: this.updateQueue.length,
      syncEnabled: this.enableRealtimeSync
    };
  }

  /**
   * Print metrics to console
   */
  printMetrics() {
    const metrics = this.getMetrics();

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║              PERMIT PLATFORM ADAPTER METRICS                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    console.log(`  Total Updates:     ${metrics.totalUpdates}`);
    console.log(`  Successful Syncs:  ${metrics.successfulSyncs}`);
    console.log(`  Failed Syncs:      ${metrics.failedSyncs}`);
    console.log(`  Success Rate:      ${metrics.successRate}`);
    console.log(`  Avg Latency:       ${metrics.avgLatency}`);
    console.log(`  Queue Size:        ${metrics.queueSize}`);
    console.log(`  Sync Enabled:      ${metrics.syncEnabled ? 'Yes' : 'No'}`);
    console.log(`  Uptime:            ${metrics.uptime}`);
    console.log(`  Last Error:        ${metrics.lastError || 'None'}`);
    console.log('═════════════════════════════════════════════════════════════════════\n');
  }

  /**
   * Cleanup: stop timers, flush pending updates
   */
  async cleanup() {
    console.log('🧹 Cleaning up Permit Platform Adapter...');

    // Flush any pending updates
    await this.flushUpdates();

    // Stop timers
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Print final metrics
    if (this.enableMetrics) {
      this.printMetrics();
    }

    console.log('✅ Permit Platform Adapter cleaned up');
  }
}

// Export singleton instance
let adapterInstance = null;

export function getPermitAdapter(config) {
  if (!adapterInstance) {
    adapterInstance = new PermitPlatformAdapter(config);
  }
  return adapterInstance;
}

export function resetPermitAdapter() {
  if (adapterInstance) {
    adapterInstance.cleanup();
    adapterInstance = null;
  }
}
