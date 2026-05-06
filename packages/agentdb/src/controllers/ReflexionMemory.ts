/**
 * ReflexionMemory - Episodic Replay Memory System
 *
 * Implements reflexion-style episodic replay for agent self-improvement.
 * Stores self-critiques and outcomes, retrieves relevant past experiences.
 *
 * Based on: "Reflexion: Language Agents with Verbal Reinforcement Learning"
 * https://arxiv.org/abs/2303.11366
 */

import type { IDatabaseConnection, DatabaseRows } from '../types/database.types.js';
import { normalizeRowId } from '../types/database.types.js';
import { EmbeddingService } from './EmbeddingService.js';
import type { VectorBackend } from '../backends/VectorBackend.js';
import type { LearningBackend } from '../backends/LearningBackend.js';
import type { GraphBackend, GraphNode } from '../backends/GraphBackend.js';
import type { GraphDatabaseAdapter } from '../backends/graph/GraphDatabaseAdapter.js';
import { NodeIdMapper } from '../utils/NodeIdMapper.js';
import { QueryCache, type QueryCacheConfig } from '../core/QueryCache.js';

export interface Episode {
  id?: number;
  ts?: number;
  sessionId: string;
  task: string;
  input?: string;
  output?: string;
  critique?: string;
  reward: number;
  success: boolean;
  latencyMs?: number;
  tokensUsed?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface EpisodeWithEmbedding extends Episode {
  embedding?: Float32Array;
  similarity?: number;
}

export interface ReflexionQuery {
  task: string;
  currentState?: string;
  k?: number; // Top-k to retrieve
  minReward?: number;
  onlyFailures?: boolean;
  onlySuccesses?: boolean;
  timeWindowDays?: number;
}

export class ReflexionMemory {
  private db: IDatabaseConnection;
  private embedder: EmbeddingService;
  private vectorBackend?: VectorBackend;
  private learningBackend?: LearningBackend;
  private graphBackend?: GraphBackend;
  private queryCache: QueryCache;

  constructor(
    db: IDatabaseConnection,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
    learningBackend?: LearningBackend,
    graphBackend?: GraphBackend,
    cacheConfig?: QueryCacheConfig
  ) {
    this.db = db;
    this.embedder = embedder;
    this.vectorBackend = vectorBackend;
    this.learningBackend = learningBackend;
    this.graphBackend = graphBackend;
    this.queryCache = new QueryCache(cacheConfig);
  }

  /**
   * Store a new episode with its critique and outcome
   * Invalidates relevant cache entries
   *
   * Persistence guarantee (issue #128 fix):
   *   storeEpisode() always writes to the SQLite `episodes` and
   *   `episode_embeddings` tables when a SQL-capable connection is present,
   *   even when a graph or vector backend handles the primary index. This
   *   ensures data survives process restarts (graph/vector backends are
   *   often in-memory or rebuildable from SQL).
   */
  async storeEpisode(episode: Episode): Promise<number> {
    // Invalidate episode caches on write
    this.queryCache.invalidateCategory('episodes');
    this.queryCache.invalidateCategory('task-stats');
    // Use GraphDatabaseAdapter if available (AgentDB v2)
    if (this.graphBackend && 'storeEpisode' in this.graphBackend) {
      // GraphDatabaseAdapter has specialized storeEpisode method
      const graphAdapter = this.graphBackend as any as GraphDatabaseAdapter;

      // Generate embedding for the task
      const taskEmbedding = await this.embedder.embed(episode.task);

      // Create episode node using GraphDatabaseAdapter
      const nodeId = await graphAdapter.storeEpisode(
        {
          id: episode.id ? `episode-${episode.id}` : `episode-${Date.now()}-${Math.random()}`,
          sessionId: episode.sessionId,
          task: episode.task,
          reward: episode.reward,
          success: episode.success,
          input: episode.input,
          output: episode.output,
          critique: episode.critique,
          createdAt: episode.ts ? episode.ts * 1000 : Date.now(),
          tokensUsed: episode.tokensUsed,
          latencyMs: episode.latencyMs,
        },
        taskEmbedding
      );

      // Return a numeric ID (parse from string ID)
      const numericId = parseInt(nodeId.split('-').pop() || '0', 36);

      // Register mapping for later use by CausalMemoryGraph
      NodeIdMapper.getInstance().register(numericId, nodeId);

      // #128: dual-write to SQL for restart-safe persistence. Graph adapter
      // index is typically in-memory; SQL is the durable record.
      this.dualWriteEpisodeToSQL(episode, taskEmbedding);

      return numericId;
    }

    // Use generic GraphBackend if available
    if (this.graphBackend) {
      // Generate embedding for the task
      const taskEmbedding = await this.embedder.embed(episode.task);

      // Create episode node ID
      const nodeId = await this.graphBackend.createNode(['Episode'], {
        sessionId: episode.sessionId,
        task: episode.task,
        input: episode.input || '',
        output: episode.output || '',
        critique: episode.critique || '',
        reward: episode.reward,
        success: episode.success,
        latencyMs: episode.latencyMs || 0,
        tokensUsed: episode.tokensUsed || 0,
        tags: episode.tags ? JSON.stringify(episode.tags) : '[]',
        metadata: episode.metadata ? JSON.stringify(episode.metadata) : '{}',
        createdAt: Date.now(),
      });

      // Store embedding using vectorBackend if available
      if (this.vectorBackend && taskEmbedding) {
        this.vectorBackend.insert(nodeId, taskEmbedding, {
          type: 'episode',
          sessionId: episode.sessionId,
        });
      }

      // Return a numeric ID (parse from string ID)
      const numericId = parseInt(nodeId.split('-').pop() || '0', 36);

      // Register mapping for later use by CausalMemoryGraph
      NodeIdMapper.getInstance().register(numericId, nodeId);

      // #128: dual-write to SQL for restart-safe persistence.
      this.dualWriteEpisodeToSQL(episode, taskEmbedding);

      return numericId;
    }

    // Fallback to SQLite (v1 compatibility)
    const stmt = this.db.prepare(`
      INSERT INTO episodes (
        session_id, task, input, output, critique, reward, success,
        latency_ms, tokens_used, tags, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tags = episode.tags ? JSON.stringify(episode.tags) : null;
    const metadata = episode.metadata ? JSON.stringify(episode.metadata) : null;

    const result = stmt.run(
      episode.sessionId,
      episode.task,
      episode.input || null,
      episode.output || null,
      episode.critique || null,
      episode.reward,
      episode.success ? 1 : 0,
      episode.latencyMs || null,
      episode.tokensUsed || null,
      tags,
      metadata
    );

    const episodeId = normalizeRowId(result.lastInsertRowid);

    // Generate and store embedding
    const text = this.buildEpisodeText(episode);
    const embedding = await this.embedder.embed(text);

    // Use vector backend if available (150x faster retrieval)
    if (this.vectorBackend) {
      this.vectorBackend.insert(episodeId.toString(), embedding);
    }

    // Also store in SQL for fallback
    this.storeEmbedding(episodeId, embedding);

    // Create graph node for episode if graph backend available
    if (this.graphBackend) {
      await this.createEpisodeGraphNode(episodeId, episode, embedding);
    }

    // Add training sample if learning backend available
    if (this.learningBackend && episode.success !== undefined) {
      this.learningBackend.addSample({
        embedding,
        label: episode.success ? 1 : 0,
        weight: Math.abs(episode.reward),
        context: {
          task: episode.task,
          sessionId: episode.sessionId,
          latencyMs: episode.latencyMs,
          tokensUsed: episode.tokensUsed,
        },
      });
    }

    return episodeId;
  }

  /**
   * Retrieve relevant past episodes for a new task attempt
   * Results are cached for improved performance
   */
  async retrieveRelevant(query: ReflexionQuery): Promise<EpisodeWithEmbedding[]> {
    const {
      task,
      currentState = '',
      k = 5,
      minReward,
      onlyFailures = false,
      onlySuccesses = false,
      timeWindowDays,
    } = query;

    // Check cache first
    const cacheKey = this.queryCache.generateKey(
      'retrieveRelevant',
      [task, currentState, k, minReward, onlyFailures, onlySuccesses, timeWindowDays],
      'episodes'
    );

    const cached = this.queryCache.get<EpisodeWithEmbedding[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Generate and enhance query embedding
    const queryEmbedding = await this.prepareQueryEmbedding(task, currentState, k);

    // Try different retrieval strategies in order of preference
    let episodes: EpisodeWithEmbedding[] = [];

    if (this.graphBackend && 'searchSimilarEpisodes' in this.graphBackend) {
      episodes = await this.retrieveFromGraphAdapter(queryEmbedding, query);
    } else if (this.graphBackend && 'execute' in this.graphBackend) {
      episodes = await this.retrieveFromGenericGraph(query);
    } else if (this.vectorBackend) {
      episodes = await this.retrieveFromVectorBackend(queryEmbedding, query);
    } else {
      episodes = await this.retrieveFromSQLFallback(queryEmbedding, query);
    }

    // Cache and return results
    this.queryCache.set(cacheKey, episodes);
    return episodes;
  }

  /**
   * Prepare and enhance query embedding for search
   */
  private async prepareQueryEmbedding(
    task: string,
    currentState: string,
    k: number
  ): Promise<Float32Array> {
    const queryText = currentState ? `${task}\n${currentState}` : task;
    let queryEmbedding = await this.embedder.embed(queryText);

    // Enhance query with GNN if learning backend available
    if (this.learningBackend) {
      queryEmbedding = await this.enhanceQueryWithGNN(queryEmbedding, k);
    }

    return queryEmbedding;
  }

  /**
   * Retrieve episodes using GraphDatabaseAdapter (AgentDB v2)
   */
  private async retrieveFromGraphAdapter(
    queryEmbedding: Float32Array,
    query: ReflexionQuery
  ): Promise<EpisodeWithEmbedding[]> {
    const { k = 5, minReward, onlyFailures, onlySuccesses, timeWindowDays } = query;
    const graphAdapter = this.graphBackend as any as GraphDatabaseAdapter;

    // Search using vector similarity
    const results = await graphAdapter.searchSimilarEpisodes(queryEmbedding, k * 3);

    // Apply filters
    const filtered = this.applyEpisodeFilters(results, {
      minReward,
      onlyFailures,
      onlySuccesses,
      timeWindowDays,
    });

    // Convert to EpisodeWithEmbedding format
    return filtered.slice(0, k).map((ep: any) => this.convertGraphEpisode(ep));
  }

  /**
   * Retrieve episodes using generic GraphBackend
   */
  private async retrieveFromGenericGraph(query: ReflexionQuery): Promise<EpisodeWithEmbedding[]> {
    const { k = 5 } = query;
    const cypherQuery = this.buildCypherQuery(query);
    const result = await this.graphBackend!.execute(cypherQuery);

    // Convert to EpisodeWithEmbedding format
    const episodes: EpisodeWithEmbedding[] = result.rows.map((row: any) =>
      this.convertCypherEpisode(row.e)
    );

    return episodes.slice(0, k);
  }

  /**
   * Retrieve episodes using VectorBackend (150x faster)
   */
  private async retrieveFromVectorBackend(
    queryEmbedding: Float32Array,
    query: ReflexionQuery
  ): Promise<EpisodeWithEmbedding[]> {
    const { k = 5, minReward, onlyFailures, onlySuccesses, timeWindowDays } = query;

    // Get candidates from vector backend
    const searchResults = this.vectorBackend!.search(queryEmbedding, k * 3, {
      threshold: 0.0,
    });

    // Fetch full episode data from DB
    const episodeIds = searchResults.map((r) => parseInt(r.id));
    if (episodeIds.length === 0) {
      return [];
    }

    const rows = this.fetchEpisodesByIds(episodeIds);
    const episodeMap = new Map(rows.map((r) => [r.id.toString(), r]));

    // Map results with similarity scores and apply filters
    const episodes: EpisodeWithEmbedding[] = [];

    for (const result of searchResults) {
      const row = episodeMap.get(result.id);
      if (!row) continue;

      // Apply filters
      if (
        !this.passesEpisodeFilters(row, { minReward, onlyFailures, onlySuccesses, timeWindowDays })
      ) {
        continue;
      }

      episodes.push(this.convertDatabaseEpisode(row, result.similarity));

      if (episodes.length >= k) break;
    }

    return episodes;
  }

  /**
   * Retrieve episodes using SQL-based similarity search (fallback)
   */
  private async retrieveFromSQLFallback(
    queryEmbedding: Float32Array,
    query: ReflexionQuery
  ): Promise<EpisodeWithEmbedding[]> {
    const { k = 5 } = query;
    const { whereClause, params } = this.buildSQLFilters(query);

    const stmt = this.db.prepare<DatabaseRows.Episode & { embedding: Buffer }>(`
      SELECT e.*, ee.embedding
      FROM episodes e
      JOIN episode_embeddings ee ON e.id = ee.episode_id
      ${whereClause}
      ORDER BY e.reward DESC
    `);

    const rows = stmt.all(...params);

    // Calculate similarities and convert
    const episodes: EpisodeWithEmbedding[] = rows.map((row) => {
      const embedding = this.deserializeEmbedding(row.embedding);
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return this.convertDatabaseEpisode(row, similarity, embedding);
    });

    // Sort by similarity and return top-k
    episodes.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    return episodes.slice(0, k);
  }

  /**
   * Apply episode filters to search results
   */
  private applyEpisodeFilters(
    episodes: any[],
    filters: {
      minReward?: number;
      onlyFailures?: boolean;
      onlySuccesses?: boolean;
      timeWindowDays?: number;
    }
  ): any[] {
    return episodes.filter((ep) => {
      if (filters.minReward !== undefined && ep.reward < filters.minReward) return false;
      if (filters.onlyFailures && ep.success) return false;
      if (filters.onlySuccesses && !ep.success) return false;
      if (filters.timeWindowDays && ep.createdAt < Date.now() - filters.timeWindowDays * 86400000)
        return false;
      return true;
    });
  }

  /**
   * Check if database row passes episode filters
   */
  private passesEpisodeFilters(
    row: DatabaseRows.Episode,
    filters: {
      minReward?: number;
      onlyFailures?: boolean;
      onlySuccesses?: boolean;
      timeWindowDays?: number;
    }
  ): boolean {
    if (filters.minReward !== undefined && row.reward < filters.minReward) return false;
    if (filters.onlyFailures && row.success === 1) return false;
    if (filters.onlySuccesses && row.success === 0) return false;
    if (filters.timeWindowDays && row.ts < Date.now() / 1000 - filters.timeWindowDays * 86400)
      return false;
    return true;
  }

  /**
   * Build Cypher query with filters
   */
  private buildCypherQuery(query: ReflexionQuery): string {
    const { k = 5, minReward, onlyFailures, onlySuccesses, timeWindowDays } = query;
    let cypherQuery = 'MATCH (e:Episode) WHERE 1=1';

    if (minReward !== undefined) {
      cypherQuery += ` AND e.reward >= ${minReward}`;
    }
    if (onlyFailures) {
      cypherQuery += ` AND e.success = false`;
    }
    if (onlySuccesses) {
      cypherQuery += ` AND e.success = true`;
    }
    if (timeWindowDays) {
      const cutoff = Date.now() - timeWindowDays * 86400000;
      cypherQuery += ` AND e.createdAt >= ${cutoff}`;
    }

    cypherQuery += ` RETURN e LIMIT ${k * 3}`;
    return cypherQuery;
  }

  /**
   * Build SQL WHERE clause and parameters for filters
   */
  private buildSQLFilters(query: ReflexionQuery): { whereClause: string; params: any[] } {
    const { minReward, onlyFailures, onlySuccesses, timeWindowDays } = query;
    const filters: string[] = [];
    const params: any[] = [];

    if (minReward !== undefined) {
      filters.push('e.reward >= ?');
      params.push(minReward);
    }

    if (onlyFailures) {
      filters.push('e.success = 0');
    }

    if (onlySuccesses) {
      filters.push('e.success = 1');
    }

    if (timeWindowDays) {
      filters.push('e.ts > strftime("%s", "now") - ?');
      params.push(timeWindowDays * 86400);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    return { whereClause, params };
  }

  /**
   * Fetch episodes by IDs from database
   */
  private fetchEpisodesByIds(episodeIds: number[]): DatabaseRows.Episode[] {
    const placeholders = episodeIds.map(() => '?').join(',');
    const stmt = this.db.prepare<DatabaseRows.Episode>(`
      SELECT * FROM episodes
      WHERE id IN (${placeholders})
    `);
    return stmt.all(...episodeIds);
  }

  /**
   * Convert GraphDatabaseAdapter episode to EpisodeWithEmbedding
   */
  private convertGraphEpisode(ep: any): EpisodeWithEmbedding {
    return {
      id: parseInt(ep.id.split('-').pop() || '0', 36),
      sessionId: ep.sessionId,
      task: ep.task,
      input: ep.input,
      output: ep.output,
      critique: ep.critique,
      reward: ep.reward,
      success: ep.success,
      latencyMs: ep.latencyMs,
      tokensUsed: ep.tokensUsed,
      ts: Math.floor(ep.createdAt / 1000),
    };
  }

  /**
   * Convert Cypher query result to EpisodeWithEmbedding
   */
  private convertCypherEpisode(node: any): EpisodeWithEmbedding {
    return {
      id: parseInt(node.id.split('-').pop() || '0', 36),
      sessionId: node.properties.sessionId,
      task: node.properties.task,
      input: node.properties.input,
      output: node.properties.output,
      critique: node.properties.critique,
      reward:
        typeof node.properties.reward === 'string'
          ? parseFloat(node.properties.reward)
          : node.properties.reward,
      success:
        typeof node.properties.success === 'string'
          ? node.properties.success === 'true'
          : node.properties.success,
      latencyMs: node.properties.latencyMs,
      tokensUsed: node.properties.tokensUsed,
      tags: node.properties.tags ? JSON.parse(node.properties.tags) : [],
      metadata: node.properties.metadata ? JSON.parse(node.properties.metadata) : {},
      ts: Math.floor(node.properties.createdAt / 1000),
    };
  }

  /**
   * Convert database row to EpisodeWithEmbedding
   */
  private convertDatabaseEpisode(
    row: DatabaseRows.Episode,
    similarity?: number,
    embedding?: Float32Array
  ): EpisodeWithEmbedding {
    return {
      id: row.id,
      ts: row.ts,
      sessionId: row.session_id,
      task: row.task,
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      critique: row.critique ?? undefined,
      reward: row.reward,
      success: row.success === 1,
      latencyMs: row.latency_ms ?? undefined,
      tokensUsed: row.tokens_used ?? undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      embedding,
      similarity,
    };
  }

  /**
   * Get statistics for a task (cached)
   */
  getTaskStats(
    task: string,
    timeWindowDays?: number
  ): {
    totalAttempts: number;
    successRate: number;
    avgReward: number;
    avgLatency: number;
    improvementTrend: number;
  } {
    // Check cache first
    const cacheKey = this.queryCache.generateKey(
      'getTaskStats',
      [task, timeWindowDays],
      'task-stats'
    );

    const cached = this.queryCache.get<{
      totalAttempts: number;
      successRate: number;
      avgReward: number;
      avgLatency: number;
      improvementTrend: number;
    }>(cacheKey);

    if (cached) {
      return cached;
    }
    const windowFilter = timeWindowDays
      ? `AND ts > strftime('%s', 'now') - ${timeWindowDays * 86400}`
      : '';

    interface TaskStats {
      total: number;
      success_rate: number;
      avg_reward: number;
      avg_latency: number | null;
    }

    const stmt = this.db.prepare<TaskStats>(`
      SELECT
        COUNT(*) as total,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
        AVG(reward) as avg_reward,
        AVG(latency_ms) as avg_latency
      FROM episodes
      WHERE task = ? ${windowFilter}
    `);

    const stats = stmt.get(task);

    // Calculate improvement trend (recent vs older)
    const trendStmt = this.db.prepare(`
      SELECT
        AVG(CASE
          WHEN ts > strftime('%s', 'now') - ${7 * 86400} THEN reward
        END) as recent_reward,
        AVG(CASE
          WHEN ts <= strftime('%s', 'now') - ${7 * 86400} THEN reward
        END) as older_reward
      FROM episodes
      WHERE task = ? ${windowFilter}
    `);

    const trend = trendStmt.get(task) as any;
    const improvementTrend =
      trend.recent_reward && trend.older_reward
        ? (trend.recent_reward - trend.older_reward) / trend.older_reward
        : 0;

    const results = {
      totalAttempts: stats?.total ?? 0,
      successRate: stats?.success_rate ?? 0,
      avgReward: stats?.avg_reward ?? 0,
      avgLatency: stats?.avg_latency ?? 0,
      improvementTrend,
    };

    // Cache the results
    this.queryCache.set(cacheKey, results);
    return results;
  }

  /**
   * Build critique summary from similar failed episodes (cached)
   */
  async getCritiqueSummary(query: ReflexionQuery): Promise<string> {
    // Check cache first
    const cacheKey = this.queryCache.generateKey(
      'getCritiqueSummary',
      [query.task, query.k],
      'episodes'
    );

    const cached = this.queryCache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }
    const failures = await this.retrieveRelevant({
      ...query,
      onlyFailures: true,
      k: 3,
    });

    if (failures.length === 0) {
      return 'No prior failures found for this task.';
    }

    const critiques = failures
      .filter((ep) => ep.critique)
      .map((ep, i) => `${i + 1}. ${ep.critique} (reward: ${ep.reward.toFixed(2)})`)
      .join('\n');

    const result = `Prior failures and lessons learned:\n${critiques}`;

    // Cache the result
    this.queryCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get successful strategies for a task (cached)
   */
  async getSuccessStrategies(query: ReflexionQuery): Promise<string> {
    // Check cache first
    const cacheKey = this.queryCache.generateKey(
      'getSuccessStrategies',
      [query.task, query.k],
      'episodes'
    );

    const cached = this.queryCache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }
    const successes = await this.retrieveRelevant({
      ...query,
      onlySuccesses: true,
      minReward: 0.7,
      k: 3,
    });

    if (successes.length === 0) {
      return 'No successful strategies found for this task.';
    }

    const strategies = successes
      .map((ep, i) => {
        const approach = ep.output?.substring(0, 200) || 'No output recorded';
        return `${i + 1}. Approach (reward ${ep.reward.toFixed(2)}): ${approach}...`;
      })
      .join('\n');

    const result = `Successful strategies:\n${strategies}`;

    // Cache the result
    this.queryCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get recent episodes for a session
   */
  async getRecentEpisodes(sessionId: string, limit: number = 10): Promise<Episode[]> {
    const stmt = this.db.prepare<DatabaseRows.Episode>(`
      SELECT * FROM episodes
      WHERE session_id = ?
      ORDER BY ts DESC
      LIMIT ?
    `);

    const rows = stmt.all(sessionId, limit);

    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      sessionId: row.session_id,
      task: row.task,
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      critique: row.critique ?? undefined,
      reward: row.reward,
      success: row.success === 1,
      latencyMs: row.latency_ms ?? undefined,
      tokensUsed: row.tokens_used ?? undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Prune low-quality episodes based on TTL and quality threshold
   * Invalidates cache on completion
   */
  pruneEpisodes(config: {
    minReward?: number;
    maxAgeDays?: number;
    keepMinPerTask?: number;
  }): number {
    const { minReward = 0.3, maxAgeDays = 30, keepMinPerTask = 5 } = config;

    // Keep high-reward episodes and minimum per task
    const stmt = this.db.prepare(`
      DELETE FROM episodes
      WHERE id IN (
        SELECT id FROM (
          SELECT
            id,
            reward,
            ts,
            ROW_NUMBER() OVER (PARTITION BY task ORDER BY reward DESC) as rank
          FROM episodes
          WHERE reward < ?
            AND ts < strftime('%s', 'now') - ?
        ) WHERE rank > ?
      )
    `);

    const result = stmt.run(minReward, maxAgeDays * 86400, keepMinPerTask);

    // Invalidate caches after pruning
    if (result.changes > 0) {
      this.queryCache.invalidateCategory('episodes');
      this.queryCache.invalidateCategory('task-stats');
    }

    return result.changes;
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private buildEpisodeText(episode: Episode): string {
    const parts = [episode.task];
    if (episode.critique) parts.push(episode.critique);
    if (episode.output) parts.push(episode.output);
    return parts.join('\n');
  }

  private storeEmbedding(episodeId: number, embedding: Float32Array): void {
    const stmt = this.db.prepare(`
      INSERT INTO episode_embeddings (episode_id, embedding)
      VALUES (?, ?)
    `);

    stmt.run(episodeId, this.serializeEmbedding(embedding));
  }

  private serializeEmbedding(embedding: Float32Array): Buffer {
    // Handle empty/null embeddings
    if (!embedding || !embedding.buffer) {
      return Buffer.alloc(0);
    }
    return Buffer.from(embedding.buffer);
  }

  private deserializeEmbedding(buffer: Buffer): Float32Array {
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ========================================================================
  // GNN and Graph Integration Methods
  // ========================================================================

  /**
   * Create graph node for episode with relationships
   */
  private async createEpisodeGraphNode(
    episodeId: number,
    episode: Episode,
    embedding: Float32Array
  ): Promise<void> {
    if (!this.graphBackend) return;

    // Create episode node
    const nodeId = await this.graphBackend.createNode(
      ['Episode', episode.success ? 'Success' : 'Failure'],
      {
        episodeId,
        sessionId: episode.sessionId,
        task: episode.task,
        reward: episode.reward,
        success: episode.success,
        timestamp: episode.ts || Date.now(),
        latencyMs: episode.latencyMs,
        tokensUsed: episode.tokensUsed,
      }
    );

    // Find similar episodes using graph vector search
    const similarEpisodes = await this.graphBackend.vectorSearch(embedding, 5, nodeId);

    // Create similarity relationships to similar episodes
    for (const similar of similarEpisodes) {
      if (similar.id !== nodeId && similar.properties.episodeId !== episodeId) {
        await this.graphBackend.createRelationship(nodeId, similar.id, 'SIMILAR_TO', {
          similarity: this.cosineSimilarity(embedding, similar.embedding || new Float32Array()),
          createdAt: Date.now(),
        });
      }
    }

    // Create session relationship
    const sessionNodes = await this.graphBackend.execute(
      'MATCH (s:Session {sessionId: $sessionId}) RETURN s',
      { sessionId: episode.sessionId }
    );

    let sessionNodeId: string;
    if (sessionNodes.rows.length === 0) {
      // Create session node if doesn't exist
      sessionNodeId = await this.graphBackend.createNode(['Session'], {
        sessionId: episode.sessionId,
        startTime: episode.ts || Date.now(),
      });
    } else {
      sessionNodeId = sessionNodes.rows[0].s.id;
    }

    await this.graphBackend.createRelationship(nodeId, sessionNodeId, 'BELONGS_TO_SESSION', {
      timestamp: episode.ts || Date.now(),
    });

    // If episode has critique, create causal relationship to previous failures
    if (episode.critique && !episode.success) {
      const previousFailures = await this.graphBackend.execute(
        `MATCH (e:Episode:Failure {sessionId: $sessionId})
         WHERE e.timestamp < $timestamp
         RETURN e
         ORDER BY e.timestamp DESC
         LIMIT 3`,
        { sessionId: episode.sessionId, timestamp: episode.ts || Date.now() }
      );

      for (const prevFailure of previousFailures.rows) {
        await this.graphBackend.createRelationship(nodeId, prevFailure.e.id, 'LEARNED_FROM', {
          critique: episode.critique,
          improvementAttempt: true,
        });
      }
    }
  }

  /**
   * Enhance query embedding using GNN attention mechanism
   */
  private async enhanceQueryWithGNN(
    queryEmbedding: Float32Array,
    k: number
  ): Promise<Float32Array> {
    if (!this.learningBackend || !this.vectorBackend) {
      return queryEmbedding;
    }

    try {
      // Get initial neighbors
      const initialResults = this.vectorBackend.search(queryEmbedding, k * 2, {
        threshold: 0.0,
      });

      if (initialResults.length === 0) {
        return queryEmbedding;
      }

      // Fetch neighbor embeddings
      const neighborEmbeddings: Float32Array[] = [];
      const weights: number[] = [];

      const episodeIds = initialResults.map((r) => r.id);
      const placeholders = episodeIds.map(() => '?').join(',');
      const episodes = this.db
        .prepare(
          `
        SELECT ee.embedding, e.reward
        FROM episode_embeddings ee
        JOIN episodes e ON e.id = ee.episode_id
        WHERE ee.episode_id IN (${placeholders})
      `
        )
        .all(...episodeIds) as any[];

      for (const ep of episodes) {
        const embedding = this.deserializeEmbedding(ep.embedding);
        neighborEmbeddings.push(embedding);
        // Use reward as weight (higher reward = more important)
        weights.push(Math.max(0.1, ep.reward));
      }

      // Enhance query using GNN
      const enhanced = this.learningBackend.enhance(queryEmbedding, neighborEmbeddings, weights);

      return enhanced;
    } catch (error) {
      console.warn('[ReflexionMemory] GNN enhancement failed:', error);
      return queryEmbedding;
    }
  }

  /**
   * Get graph-based episode relationships
   */
  async getEpisodeRelationships(episodeId: number): Promise<{
    similar: number[];
    session: string;
    learnedFrom: number[];
  }> {
    if (!this.graphBackend) {
      return { similar: [], session: '', learnedFrom: [] };
    }

    const result = await this.graphBackend.execute(
      `MATCH (e:Episode {episodeId: $episodeId})
       OPTIONAL MATCH (e)-[:SIMILAR_TO]->(similar:Episode)
       OPTIONAL MATCH (e)-[:BELONGS_TO_SESSION]->(s:Session)
       OPTIONAL MATCH (e)-[:LEARNED_FROM]->(learned:Episode)
       RETURN e, collect(DISTINCT similar.episodeId) as similar,
              s.sessionId as session,
              collect(DISTINCT learned.episodeId) as learnedFrom`,
      { episodeId }
    );

    if (result.rows.length === 0) {
      return { similar: [], session: '', learnedFrom: [] };
    }

    const row = result.rows[0];
    return {
      similar: (row.similar || []).filter((id: any) => id != null),
      session: row.session || '',
      learnedFrom: (row.learnedFrom || []).filter((id: any) => id != null),
    };
  }

  /**
   * Train GNN model on accumulated samples
   */
  async trainGNN(options?: { epochs?: number }): Promise<void> {
    if (!this.learningBackend) {
      console.warn('[ReflexionMemory] No learning backend available for training');
      return;
    }

    const stats = this.learningBackend.getStats();
    if (stats.samplesCollected < 10) {
      console.warn('[ReflexionMemory] Not enough samples for training (need at least 10)');
      return;
    }

    const result = await this.learningBackend.train(options);
    console.log('[ReflexionMemory] GNN training complete:', {
      epochs: result.epochs,
      finalLoss: result.finalLoss.toFixed(4),
      improvement: `${(result.improvement * 100).toFixed(1)}%`,
      duration: `${result.duration}ms`,
    });
  }

  /**
   * Get learning backend statistics
   */
  getLearningStats() {
    if (!this.learningBackend) {
      return null;
    }
    return this.learningBackend.getStats();
  }

  /**
   * Get graph backend statistics
   */
  getGraphStats() {
    if (!this.graphBackend) {
      return null;
    }
    return this.graphBackend.getStats();
  }

  /**
   * Get query cache statistics
   */
  getCacheStats() {
    return this.queryCache.getStatistics();
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.queryCache.clear();
  }

  /**
   * Prune expired cache entries
   */
  pruneCache(): number {
    return this.queryCache.pruneExpired();
  }

  /**
   * Warm cache with common queries
   */
  async warmCache(sessionId?: string): Promise<void> {
    await this.queryCache.warm(async (cache) => {
      // Warm cache with recent sessions if sessionId provided
      if (sessionId) {
        const recent = await this.getRecentEpisodes(sessionId, 10);
        // Episodes are already loaded, cache will be populated on next access
      }
    });
  }

  /**
   * Delete an episode by id. Closes the gap from issue #150 (downstream:
   * ruflo#1784, RuVector#427) — once an episode is written there was no
   * first-class way to remove it through any backend.
   *
   * Strategy mirrors storeEpisode: when a graph backend is present we go
   * through it (`graphAdapter.deleteNode` / `graphBackend.deleteNode` —
   * both Cypher-backed under the hood), and we ALWAYS also purge the SQL
   * `episodes` and `episode_embeddings` rows so durable storage stays in
   * sync. Vector backend entries are removed too when present.
   *
   * @returns True if the episode existed in any backend and was removed.
   */
  async deleteEpisode(id: number | string): Promise<boolean> {
    const numericId = typeof id === 'number' ? id : parseInt(String(id), 10);
    const stringId = String(id);

    // Invalidate caches up front — failures below shouldn't leave stale reads.
    this.queryCache.invalidateCategory('episodes');
    this.queryCache.invalidateCategory('task-stats');

    let removed = false;

    // 1. Graph adapter (AgentDB v2 fast path)
    if (this.graphBackend && 'storeEpisode' in this.graphBackend) {
      const adapter = this.graphBackend as any;
      if (typeof adapter.deleteNode === 'function') {
        try {
          // Adapter accepts either the canonical "episode-<id>" key or a raw
          // id; try the canonical form first since that's what storeEpisode
          // emits.
          const r = await adapter.deleteNode(`episode-${numericId}`, { cascade: true });
          if (r?.deletedNode) removed = true;
          if (!removed) {
            const r2 = await adapter.deleteNode(stringId, { cascade: true });
            if (r2?.deletedNode) removed = true;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn(`[ReflexionMemory] deleteEpisode: graph adapter delete failed: ${msg}`);
        }
      }
    }
    // 2. Generic graph backend
    else if (this.graphBackend && typeof (this.graphBackend as any).deleteNode === 'function') {
      try {
        const r = await (this.graphBackend as any).deleteNode(stringId);
        if (r === true) removed = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[ReflexionMemory] deleteEpisode: graph backend delete failed: ${msg}`);
      }
    }

    // 3. Vector backend (HNSW/RuVector); some implementations don't expose
    //    delete — guard with a feature check.
    if (this.vectorBackend && typeof (this.vectorBackend as any).delete === 'function') {
      try {
        const r = await (this.vectorBackend as any).delete(String(numericId));
        if (r === true) removed = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[ReflexionMemory] deleteEpisode: vector backend delete failed: ${msg}`);
      }
    }

    // 4. SQL durable storage — always attempt so persistence stays clean
    //    even when the primary backend was a no-op.
    if (this.db && typeof this.db.prepare === 'function' && Number.isFinite(numericId)) {
      try {
        const embStmt = this.db.prepare(
          `DELETE FROM episode_embeddings WHERE episode_id = ?`
        );
        embStmt.run(numericId);
        const stmt = this.db.prepare(`DELETE FROM episodes WHERE id = ?`);
        const r = stmt.run(numericId);
        const changes = (r as any)?.changes ?? 0;
        if (changes > 0) removed = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/no such table/i.test(msg)) {
          // eslint-disable-next-line no-console
          console.warn(`[ReflexionMemory] deleteEpisode: SQL delete failed: ${msg}`);
        }
      }
    }

    return removed;
  }

  /**
   * Dual-write helper for issue #128.
   *
   * Inserts the given episode into the SQLite `episodes` and
   * `episode_embeddings` tables when the underlying connection supports it.
   * Used when a graph or vector backend handles the primary index but the
   * caller still wants restart-safe persistence.
   *
   * Errors are swallowed and logged — the primary write to the graph/vector
   * backend has already succeeded, and we don't want to fail the caller if
   * SQL persistence is unavailable (e.g. read-only DB, schema not present).
   */
  private dualWriteEpisodeToSQL(episode: Episode, embedding?: Float32Array): void {
    if (!this.db || typeof this.db.prepare !== 'function') return;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO episodes (
          session_id, task, input, output, critique, reward, success,
          latency_ms, tokens_used, tags, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tags = episode.tags ? JSON.stringify(episode.tags) : null;
      const metadata = episode.metadata ? JSON.stringify(episode.metadata) : null;
      const result = stmt.run(
        episode.sessionId,
        episode.task,
        episode.input ?? null,
        episode.output ?? null,
        episode.critique ?? null,
        episode.reward,
        episode.success ? 1 : 0,
        episode.latencyMs ?? null,
        episode.tokensUsed ?? null,
        tags,
        metadata
      );
      if (embedding) {
        const episodeId = normalizeRowId(result.lastInsertRowid);
        this.storeEmbedding(episodeId, embedding);
      }
    } catch (err) {
      // The expected failure here is "no such table: episodes" on databases
      // that intentionally don't carry the v1 schema. Don't escalate — the
      // primary backend already has the data.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/no such table/i.test(msg)) {
        // eslint-disable-next-line no-console
        console.warn('[ReflexionMemory] dualWriteEpisodeToSQL failed:', msg);
      }
    }
  }

  /**
   * Rebuild the in-memory vector index from the SQLite `episodes` /
   * `episode_embeddings` tables, going through the proper backend channels
   * so `retrieveRelevant()` sees the data afterwards.
   *
   * Fixes the user's recovery use-case from issue #129: rather than calling
   * `vectorBackend.getInner().insert()` directly (which bypasses the
   * GuardedBackend wrapper and confuses retrieveRelevant), call this method
   * to re-hydrate the vector and graph indices from durable storage.
   *
   * Returns the number of episodes re-indexed. No-ops cleanly when the SQL
   * tables are empty or absent.
   */
  async rebuildIndex(options: { fromTimestamp?: number } = {}): Promise<number> {
    if (!this.db || typeof this.db.prepare !== 'function') return 0;

    const where = options.fromTimestamp !== undefined ? 'WHERE e.ts >= ?' : '';
    const params: any[] = options.fromTimestamp !== undefined ? [options.fromTimestamp] : [];
    let rows: any[] = [];
    try {
      const stmt = this.db.prepare(`
        SELECT
          e.id, e.ts, e.session_id, e.task, e.input, e.output, e.critique,
          e.reward, e.success, e.latency_ms, e.tokens_used, e.tags, e.metadata,
          ee.embedding
        FROM episodes e
        LEFT JOIN episode_embeddings ee ON ee.episode_id = e.id
        ${where}
        ORDER BY e.id ASC
      `);
      rows = stmt.all(...params) as any[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no such table/i.test(msg)) return 0;
      throw err;
    }

    let reindexed = 0;
    for (const row of rows) {
      const episode: Episode = {
        id: row.id,
        ts: row.ts,
        sessionId: row.session_id,
        task: row.task,
        input: row.input ?? undefined,
        output: row.output ?? undefined,
        critique: row.critique ?? undefined,
        reward: row.reward,
        success: row.success === 1,
        latencyMs: row.latency_ms ?? undefined,
        tokensUsed: row.tokens_used ?? undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };

      // Prefer the stored embedding; fall back to recomputing if missing.
      let embedding: Float32Array | undefined;
      if (row.embedding) {
        const buf: Buffer = row.embedding;
        embedding = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      } else {
        embedding = await this.embedder.embed(this.buildEpisodeText(episode));
      }

      // Re-insert through the proper public APIs so the GuardedBackend
      // wrapper, graph adapter, and HNSW all stay in sync.
      if (this.vectorBackend) {
        try {
          this.vectorBackend.insert(String(row.id), embedding, {
            type: 'episode',
            sessionId: episode.sessionId,
            reward: episode.reward,
            success: episode.success,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn(`[ReflexionMemory] rebuildIndex: vector insert failed for ${row.id}: ${msg}`);
        }
      }

      if (this.graphBackend && 'storeEpisode' in this.graphBackend) {
        const adapter = this.graphBackend as any as GraphDatabaseAdapter;
        try {
          await adapter.storeEpisode(
            {
              id: `episode-${row.id}`,
              sessionId: episode.sessionId,
              task: episode.task,
              reward: episode.reward,
              success: episode.success,
              input: episode.input,
              output: episode.output,
              critique: episode.critique,
              createdAt: (episode.ts ?? Date.now() / 1000) * 1000,
              tokensUsed: episode.tokensUsed,
              latencyMs: episode.latencyMs,
            },
            embedding
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn(`[ReflexionMemory] rebuildIndex: graph store failed for ${row.id}: ${msg}`);
        }
      }

      reindexed++;
    }

    // Bust any stale read caches so the next retrieveRelevant sees the
    // freshly-rebuilt index.
    this.queryCache.invalidateCategory('episodes');
    this.queryCache.invalidateCategory('task-stats');

    return reindexed;
  }
}
