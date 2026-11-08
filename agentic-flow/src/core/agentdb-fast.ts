/**
 * AgentDB Fast API
 *
 * Provides programmatic access to AgentDB without CLI overhead
 * Eliminates 2.3s overhead from process spawning and transformers.js init
 */

import { AgentDB } from 'agentdb';
import { EventEmitter } from 'events';
import { getOnnxWasmEmbedder, ONNX_WASM_DIMENSION } from '../integrations/onnx-wasm-embedder.js';
import { filteredVectorSearch, MAX_FALLBACK_K, type MetadataQuery } from './agentdb-filtered-search.js';

/**
 * Thrown by storeEpisode/storePattern on the rvf backend when a metadata
 * field's type differs from its first stored type; nothing was written.
 */
export { RvfMetadataTypeConflictError } from 'agentdb/backends';

/**
 * How AgentDBFast embeds text:
 * - 'auto' (default): all-MiniLM-L6-v2 via ruvector-onnx-embeddings-wasm when the
 *   package and model are available and vectorDimensions is 384, else hash
 * - 'onnx-wasm': same, but emit a 'warning' event when it is unavailable
 * - 'hash': deterministic hash vectors (no semantics; fast, offline)
 */
export type FastEmbeddingMode = 'auto' | 'onnx-wasm' | 'hash';

export interface Episode {
  id?: string;
  sessionId: string;
  task: string;
  trajectory: string[];
  reward: number;
  quality?: number;
  embedding?: number[];
  context?: Record<string, any>;
  timestamp?: number;
}

export interface EpisodeSearchOptions {
  task?: string;
  minReward?: number;
  maxReward?: number;
  sessionId?: string;
  k?: number;
  filter?: Record<string, any>;
}

export interface Pattern {
  id?: string;
  task: string;
  input: string;
  output: string;
  quality: number;
  embedding?: number[];
  context?: Record<string, any>;
  timestamp?: number;
}

/**
 * Fast AgentDB client that avoids CLI overhead
 *
 * Performance:
 * - CLI: ~2,350ms per operation
 * - Direct API: ~10-50ms per operation
 * - Speedup: ~50-200x faster
 */
export class AgentDBFast extends EventEmitter {
  private db: AgentDB | null = null;
  private backend: any = null;
  private config: {
    path: string;
    vectorDimensions: number;
    enableHNSW: boolean;
    hnswM?: number;
    hnswEfConstruction?: number;
    embeddings: FastEmbeddingMode;
  };
  private initialized: boolean = false;
  private embeddingCache: Map<string, number[]> = new Map();
  private embeddingSource: 'onnx-wasm' | 'hash' | null = null;
  private semanticEmbedder: Promise<{ embed(text: string): Promise<Float32Array> } | null> | null = null;

  constructor(config: {
    path?: string;
    vectorDimensions?: number;
    enableHNSW?: boolean;
    hnswM?: number;
    hnswEfConstruction?: number;
    embeddings?: FastEmbeddingMode;
  } = {}) {
    super();

    this.config = {
      path: config.path || '.agentdb-fast',
      vectorDimensions: config.vectorDimensions || 384,
      enableHNSW: config.enableHNSW !== false,
      hnswM: config.hnswM || 16,
      hnswEfConstruction: config.hnswEfConstruction || 200,
      embeddings: config.embeddings ?? (process.env.AGENTIC_FLOW_EMBEDDINGS === 'hash' ? 'hash' : 'auto'),
    };
  }

  /**
   * Initialize database connection (lazy)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Create AgentDB instance - use any for flexible config
      // agentdb reads `vectorDimension` (singular); the index is in-memory.
      this.db = new AgentDB({
        vectorDimension: this.config.vectorDimensions,
      } as any);

      await this.db.initialize();

      // Access the vector backend as a direct property
      if (this.db.vectorBackend) {
        this.backend = this.db.vectorBackend;
      } else {
        throw new Error('Vector backend not available');
      }

      this.initialized = true;
      this.emit('initialized');
    } catch (error: any) {
      throw new Error(`Failed to initialize AgentDB: ${error.message}`);
    }
  }

  /**
   * Store an episode (fast, no CLI overhead)
   */
  async storeEpisode(episode: Episode): Promise<string> {
    await this.initialize();

    // Generate embedding if not provided
    if (!episode.embedding) {
      episode.embedding = await this.getEmbedding(episode.task);
    }

    const episodeId = episode.id || this.generateId('episode');

    // Use backend insert method
    if (!this.backend) {
      throw new Error('Backend not initialized');
    }

    await this.insertVector(
      episodeId,
      new Float32Array(episode.embedding),
      {
        type: 'episode',
        sessionId: episode.sessionId,
        task: episode.task,
        trajectory: JSON.stringify(episode.trajectory),
        reward: episode.reward,
        quality: episode.quality,
        context: episode.context,
        timestamp: episode.timestamp || Date.now()
      }
    );

    this.emit('episode:stored', episodeId);
    return episodeId;
  }

  /**
   * Retrieve episodes by task similarity (fast)
   */
  async retrieveEpisodes(options: EpisodeSearchOptions): Promise<Episode[]> {
    await this.initialize();

    const dimensions = this.config.vectorDimensions ?? 384;
    const queryEmbedding = options.task
      ? await this.getEmbedding(options.task)
      : Array(dimensions).fill(1 / Math.sqrt(dimensions)); // no task: any direction

    const k = options.k || 5;

    // Filter in agentdb (always by type, so patterns never come back as episodes)
    const query: MetadataQuery = { equals: { type: 'episode' } };
    if (options.sessionId) query.equals!.sessionId = options.sessionId;
    if (options.minReward !== undefined || options.maxReward !== undefined) {
      query.ranges = { reward: { min: options.minReward, max: options.maxReward } };
    }
    const results = await this.search(queryEmbedding, k, query);

    return results.map((result: any) => ({
      id: result.id,
      sessionId: result.metadata.sessionId,
      task: result.metadata.task,
      trajectory: JSON.parse(result.metadata.trajectory || '[]'),
      reward: result.metadata.reward,
      quality: result.metadata.quality,
      embedding: result.vector, // agentdb search results carry no vector
      context: result.metadata.context,
      timestamp: result.metadata.timestamp
    }));
  }

  /**
   * Store a pattern (for ReasoningBank)
   */
  async storePattern(pattern: Pattern): Promise<string> {
    await this.initialize();

    if (!pattern.embedding) {
      pattern.embedding = await this.getEmbedding(`${pattern.input} ${pattern.output}`);
    }

    const patternId = pattern.id || this.generateId('pattern');

    if (!this.backend) {
      throw new Error('Backend not initialized');
    }

    await this.insertVector(
      patternId,
      new Float32Array(pattern.embedding),
      {
        type: 'pattern',
        task: pattern.task,
        input: pattern.input,
        output: pattern.output,
        quality: pattern.quality,
        context: pattern.context,
        timestamp: pattern.timestamp || Date.now()
      }
    );

    this.emit('pattern:stored', patternId);
    return patternId;
  }

  /**
   * Search for similar patterns
   */
  async searchPatterns(
    query: string,
    k: number = 5,
    minQuality?: number
  ): Promise<Pattern[]> {
    await this.initialize();

    const queryEmbedding = await this.getEmbedding(query);

    const filter: MetadataQuery = { equals: { type: 'pattern' } };
    if (minQuality !== undefined) {
      filter.ranges = { quality: { min: minQuality } };
    }
    const results = await this.search(queryEmbedding, k, filter);

    return results.map((result: any) => ({
      id: result.id,
      task: result.metadata.task,
      input: result.metadata.input,
      output: result.metadata.output,
      quality: result.metadata.quality,
      embedding: result.vector, // agentdb search results carry no vector
      context: result.metadata.context,
      timestamp: result.metadata.timestamp
    }));
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    totalVectors: number;
    totalEpisodes: number;
    totalPatterns: number;
    avgQuality: number;
  }> {
    await this.initialize();

    if (!this.backend) {
      throw new Error('Backend not initialized');
    }

    const stats = typeof this.backend.getStatsAsync === 'function'
      ? await this.backend.getStatsAsync()
      : this.backend.getStats();
    const total: number = stats?.count ?? 0;

    // Count by type with agentdb's filtered search (exact on rvf). Any
    // non-zero probe works; a zero vector has no cosine direction.
    const probe = new Array(this.config.vectorDimensions).fill(1 / Math.sqrt(this.config.vectorDimensions));
    const k = Math.min(Math.max(total, 1), MAX_FALLBACK_K);
    const [episodes, patterns] = await Promise.all([
      this.search(probe, k, { equals: { type: 'episode' } }, true),
      this.search(probe, k, { equals: { type: 'pattern' } }, true),
    ]);

    const avgQuality =
      patterns.reduce((sum: number, p: any) => sum + (p.metadata?.quality || 0), 0) /
      (patterns.length || 1);

    return {
      totalVectors: total,
      totalEpisodes: episodes.length,
      totalPatterns: patterns.length,
      avgQuality
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    this.removeAllListeners();
    this.embeddingCache.clear();

    if (this.db) {
      // closeAsync (agentdb >= 3.7.0, rvf) flushes queued writes and waits for
      // the writer lock to be released; AgentDB.close() does not wait.
      if (typeof this.backend?.closeAsync === 'function') {
        await this.backend.closeAsync();
        (this.db as any).vectorBackend = null;
      }
      await this.db.close();
      this.db = null;
      this.backend = null;
    }

    this.initialized = false;
  }

  /** Which embedder produced vectors so far: 'onnx-wasm', 'hash', or null before the first. */
  getEmbeddingSource(): 'onnx-wasm' | 'hash' | null {
    return this.embeddingSource;
  }

  private getSemanticEmbedder() {
    if (!this.semanticEmbedder) {
      this.semanticEmbedder =
        this.config.embeddings !== 'hash' && this.config.vectorDimensions === ONNX_WASM_DIMENSION
          ? getOnnxWasmEmbedder()
          : Promise.resolve(null);
    }
    return this.semanticEmbedder;
  }

  /**
   * Generate embedding for text (with caching).
   *
   * Real all-MiniLM-L6-v2 vectors when ruvector-onnx-embeddings-wasm is
   * available (see FastEmbeddingMode), deterministic hash vectors otherwise.
   * The source is fixed by the first embedding so one store never mixes both.
   */
  private async getEmbedding(text: string): Promise<number[]> {
    // Check cache
    if (this.embeddingCache.has(text)) {
      return this.embeddingCache.get(text)!;
    }

    let embedding: number[] | null = null;
    if (this.embeddingSource !== 'hash') {
      const semantic = await this.getSemanticEmbedder();
      if (semantic) {
        embedding = Array.from(await semantic.embed(text));
        this.embeddingSource = 'onnx-wasm';
      } else if (this.config.embeddings === 'onnx-wasm') {
        this.emit('warning', new Error('onnx-wasm embeddings requested but unavailable; using hash embeddings'));
      }
    }
    if (!embedding) {
      embedding = this.simpleHashEmbedding(text);
      this.embeddingSource = 'hash';
    }

    // Cache it
    this.embeddingCache.set(text, embedding);
    if (this.embeddingCache.size > 1000) {
      // LRU-style cleanup
      const firstKey = this.embeddingCache.keys().next().value as string | undefined;
      if (firstKey) {
        this.embeddingCache.delete(firstKey);
      }
    }

    return embedding;
  }

  /**
   * Deterministic hash-based embedding: the offline fallback. It carries no
   * semantics (similar texts do not get similar vectors).
   */
  private simpleHashEmbedding(text: string): number[] {
    const embedding = new Array(this.config.vectorDimensions);

    // Seed with text hash
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash = hash & hash;
    }

    // Generate pseudo-random embedding
    for (let i = 0; i < this.config.vectorDimensions; i++) {
      const seed = hash + i * 2654435761;
      const x = Math.sin(seed) * 10000;
      embedding[i] = x - Math.floor(x);
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / norm);
  }

  /** Write through the async API so an rvf type conflict rejects this call */
  private async insertVector(id: string, embedding: Float32Array, metadata: Record<string, unknown>): Promise<void> {
    if (!this.backend) {
      throw new Error('Backend not initialized');
    }
    const clean = Object.fromEntries(Object.entries(metadata).filter(([, v]) => v !== undefined));
    if (typeof this.backend.insertAsync === 'function') {
      await this.backend.insertAsync(id, embedding, clean);
    } else {
      this.backend.insert(id, embedding, clean);
    }
  }

  /** agentdb filtered search (see agentdb-filtered-search.ts for the fallback) */
  private async search(embedding: number[], k: number, query: MetadataQuery, forceExact = false): Promise<any[]> {
    if (!this.backend) {
      throw new Error('Backend not initialized');
    }
    const { hits } = await filteredVectorSearch(this.backend, new Float32Array(embedding), k, query, { forceExact });
    return hits;
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Convenience function to create a fast AgentDB client
 */
export function createFastAgentDB(config?: {
  path?: string;
  vectorDimensions?: number;
  enableHNSW?: boolean;
  embeddings?: FastEmbeddingMode;
}): AgentDBFast {
  return new AgentDBFast(config);
}

/**
 * Performance comparison helper
 */
export async function benchmarkAgentDB(): Promise<{
  cli: { store: number; retrieve: number };
  api: { store: number; retrieve: number };
  speedup: { store: number; retrieve: number };
}> {
  const client = createFastAgentDB({ path: '.agentdb-benchmark' });

  // API benchmark
  const apiStoreStart = Date.now();
  const episodeId = await client.storeEpisode({
    sessionId: 'test-session',
    task: 'test-task',
    trajectory: ['step1', 'step2'],
    reward: 0.8
  });
  const apiStoreTime = Date.now() - apiStoreStart;

  const apiRetrieveStart = Date.now();
  await client.retrieveEpisodes({ task: 'test-task', k: 5 });
  const apiRetrieveTime = Date.now() - apiRetrieveStart;

  await client.close();

  // CLI times from benchmarks
  const cliStoreTime = 2350;
  const cliRetrieveTime = 2400;

  return {
    cli: {
      store: cliStoreTime,
      retrieve: cliRetrieveTime
    },
    api: {
      store: apiStoreTime,
      retrieve: apiRetrieveTime
    },
    speedup: {
      store: cliStoreTime / apiStoreTime,
      retrieve: cliRetrieveTime / apiRetrieveTime
    }
  };
}
