/**
 * AgentDB Bridge
 *
 * Interface to agentdb package for frontier memory features
 * Provides 150x faster vector search with 29 MCP tools
 */

import { BridgeConfig, BridgeResult, BridgeError, BridgeErrorCode, Logger } from '../types/common.js';
import { AgentDBMetrics } from '../types/metrics.js';
import { createLogger } from '../utils/logger.js';
import { withRetry, withTimeout } from '../utils/retry.js';
import { validateRequired, validatePositiveNumber } from '../utils/validation.js';

/**
 * AgentDB configuration
 */
export interface AgentDBConfig extends BridgeConfig {
  /** Database path */
  dbPath?: string;
  /** Enable WASM acceleration */
  enableWASM?: boolean;
  /** Enable HNSW indexing (needs `vectorDimension` and hnswlib-node) */
  enableHNSW?: boolean;
  /**
   * Vector dimension. agentdb 3.x sizes its HNSW index up front, so the HNSW
   * path is only used when this is set; otherwise search is exact (brute force).
   */
  vectorDimension?: number;
}

/** Columns of the bridge's vectors table that agentdb 3.x accepts as filters. */
const FILTER_COLUMNS = new Set(['namespace']);

/**
 * Vector insertion request
 */
export interface VectorInsertRequest {
  vector: number[];
  metadata: Record<string, any>;
  namespace?: string;
}

/**
 * Vector search request
 */
export interface VectorSearchRequest {
  query: number[];
  k: number;
  threshold?: number;
  namespace?: string;
  filters?: Record<string, any>;
}

/**
 * Search result
 */
export interface VectorSearchResult {
  id: number;
  similarity: number;
  distance: number;
  metadata: Record<string, any>;
}

/**
 * Pattern storage request
 */
export interface PatternStoreRequest {
  pattern: string;
  category: string;
  embedding?: number[];
  metadata?: Record<string, any>;
}

/**
 * AgentDB Bridge implementation
 *
 * Performance Target: <50ms search latency
 */
export class AgentDBBridge {
  private config: Required<Omit<AgentDBConfig, 'vectorDimension'>> & { vectorDimension?: number };
  private hnswBuilt: boolean = false;
  private logger: Logger;
  private initialized: boolean = false;
  private db: any = null;
  private vectorSearch: any = null;
  private hnswIndex: any = null;
  private metrics: AgentDBMetrics = {
    insertLatencyMs: 0,
    searchLatencyMs: 0,
    patternStoreLatencyMs: 0,
    vectorsIndexed: 0,
    resultsFound: 0,
    successRate: 1.0,
    dbSizeMb: 0,
  };
  private operationCount: number = 0;
  private successCount: number = 0;

  constructor(config: AgentDBConfig = {}) {
    this.config = {
      debug: config.debug ?? false,
      timeoutMs: config.timeoutMs ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      dbPath: config.dbPath ?? './agentdb.db',
      enableWASM: config.enableWASM ?? true,
      enableHNSW: config.enableHNSW ?? true,
      vectorDimension: config.vectorDimension,
    };

    this.logger = createLogger('[AgentDBBridge]', this.config.debug);
  }

  /**
   * Initialize the bridge
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Bridge already initialized');
      return;
    }

    this.logger.info('Initializing AgentDB bridge...');

    try {
      // Import AgentDB controllers
      const agentdb = await import('agentdb');

      // Create database
      this.db = await agentdb.createDatabase(this.config.dbPath);
      // agentdb 3.x vector search reads `pattern_id` + `embedding` columns
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS vectors (
          pattern_id INTEGER PRIMARY KEY AUTOINCREMENT,
          embedding BLOB NOT NULL,
          metadata TEXT,
          namespace TEXT DEFAULT 'default'
        )
      `);
      this.logger.info('Database initialized');

      // Initialize WASM vector search if enabled
      if (this.config.enableWASM) {
        try {
          this.vectorSearch = new agentdb.WASMVectorSearch(this.db, {
            enableWASM: true,
            enableSIMD: true,
          });
          this.logger.info('WASM vector search enabled (150x faster)');
        } catch (error) {
          this.logger.warn('WASM vector search not available');
        }
      }

      // Initialize HNSW index if enabled
      if (this.config.enableHNSW && this.config.vectorDimension) {
        try {
          this.hnswIndex = new agentdb.HNSWIndex(this.db, {
            dimension: this.config.vectorDimension,
            maxElements: 10000,
            M: 16,
            efConstruction: 200,
          });
          this.logger.info('HNSW index initialized');
        } catch (error) {
          this.logger.warn('HNSW index not available');
        }
      }

      this.initialized = true;
      this.logger.info('AgentDB bridge initialized successfully');
    } catch (error) {
      throw new BridgeError(
        BridgeErrorCode.NOT_INITIALIZED,
        `Failed to initialize AgentDB bridge: ${(error as Error).message}`,
        error
      );
    }
  }

  /**
   * Insert vector with metadata
   */
  async insert(request: VectorInsertRequest): Promise<BridgeResult<number>> {
    this.ensureInitialized();

    validateRequired(request.vector, 'vector');
    validateRequired(request.metadata, 'metadata');

    const startTime = Date.now();
    this.operationCount++;

    try {
      const id = await withTimeout(
        () => withRetry(
          async () => this.performInsert(request),
          { maxAttempts: this.config.maxRetries, delayMs: this.config.retryDelayMs },
          this.logger
        ),
        this.config.timeoutMs,
        'Insert operation timed out'
      );

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      this.successCount++;
      this.metrics.insertLatencyMs = latencyMs;
      this.metrics.vectorsIndexed++;
      this.metrics.successRate = this.successCount / this.operationCount;

      return {
        success: true,
        data: id,
        metrics: {
          latencyMs,
          startTime,
          endTime,
          successRate: this.metrics.successRate,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = (error as Error).message;

      this.logger.error('Insert operation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metrics: {
          latencyMs: endTime - startTime,
          startTime,
          endTime,
          successRate: this.successCount / this.operationCount,
        },
      };
    }
  }

  /**
   * Search vectors by similarity
   * Target: <50ms latency
   */
  async search(request: VectorSearchRequest): Promise<BridgeResult<VectorSearchResult[]>> {
    this.ensureInitialized();

    validateRequired(request.query, 'query');
    validatePositiveNumber(request.k, 'k');
    this.resolveFilters(request); // reject unsupported filter fields before retrying

    const startTime = Date.now();
    this.operationCount++;

    try {
      const results = await withTimeout(
        () => withRetry(
          async () => this.performSearch(request),
          { maxAttempts: this.config.maxRetries, delayMs: this.config.retryDelayMs },
          this.logger
        ),
        this.config.timeoutMs,
        'Search operation timed out'
      );

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      this.successCount++;
      this.metrics.searchLatencyMs = latencyMs;
      this.metrics.resultsFound += results.length;
      this.metrics.successRate = this.successCount / this.operationCount;

      return {
        success: true,
        data: results,
        metrics: {
          latencyMs,
          startTime,
          endTime,
          successRate: this.metrics.successRate,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = (error as Error).message;

      this.logger.error('Search operation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metrics: {
          latencyMs: endTime - startTime,
          startTime,
          endTime,
          successRate: this.successCount / this.operationCount,
        },
      };
    }
  }

  /**
   * Store pattern with embedding
   */
  async patternStore(request: PatternStoreRequest): Promise<BridgeResult<boolean>> {
    this.ensureInitialized();

    validateRequired(request.pattern, 'pattern');
    validateRequired(request.category, 'category');

    const startTime = Date.now();
    this.operationCount++;

    try {
      const result = await withTimeout(
        () => withRetry(
          async () => this.performPatternStore(request),
          { maxAttempts: this.config.maxRetries, delayMs: this.config.retryDelayMs },
          this.logger
        ),
        this.config.timeoutMs,
        'Pattern store operation timed out'
      );

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      this.successCount++;
      this.metrics.patternStoreLatencyMs = latencyMs;
      this.metrics.successRate = this.successCount / this.operationCount;

      return {
        success: true,
        data: result,
        metrics: {
          latencyMs,
          startTime,
          endTime,
          successRate: this.metrics.successRate,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = (error as Error).message;

      this.logger.error('Pattern store operation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metrics: {
          latencyMs: endTime - startTime,
          startTime,
          endTime,
          successRate: this.successCount / this.operationCount,
        },
      };
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): AgentDBMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      insertLatencyMs: 0,
      searchLatencyMs: 0,
      patternStoreLatencyMs: 0,
      vectorsIndexed: 0,
      resultsFound: 0,
      successRate: 1.0,
      dbSizeMb: 0,
    };
    this.operationCount = 0;
    this.successCount = 0;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      if (typeof this.db.closeAsync === 'function') {
        await this.db.closeAsync();
      } else {
        this.db.close();
      }
      this.db = null;
      this.hnswIndex = null;
      this.vectorSearch = null;
      this.hnswBuilt = false;
      this.initialized = false;
      this.logger.info('Database closed');
    }
  }

  /**
   * Perform vector insertion
   */
  private async performInsert(request: VectorInsertRequest): Promise<number> {
    const embedding = new Float32Array(request.vector);
    const result = this.db.prepare(`
      INSERT INTO vectors (embedding, metadata, namespace)
      VALUES (?, ?, ?)
    `).run(
      Buffer.from(embedding.buffer),
      JSON.stringify(request.metadata),
      request.namespace || 'default'
    );
    const id = Number(result.lastInsertRowid);

    // agentdb 3.x: addVector(id, embedding) is sync and only valid once built
    if (this.hnswBuilt && this.hnswIndex?.isReady()) {
      try {
        this.hnswIndex.addVector(id, embedding);
      } catch (error) {
        this.logger.debug('HNSW addVector failed; index will be rebuilt on next search');
        this.hnswBuilt = false;
      }
    }

    return id;
  }

  /**
   * agentdb 3.x filters are column names (`field = value`), not metadata paths.
   */
  private resolveFilters(request: VectorSearchRequest): Record<string, any> {
    const filters: Record<string, any> = { ...(request.filters ?? {}) };
    if (request.namespace) filters.namespace = request.namespace;
    for (const key of Object.keys(filters)) {
      if (!FILTER_COLUMNS.has(key)) {
        throw new BridgeError(
          BridgeErrorCode.INVALID_INPUT,
          `Unsupported filter field "${key}" (supported: ${[...FILTER_COLUMNS].join(', ')})`
        );
      }
    }
    return filters;
  }

  /**
   * Perform vector search
   */
  private async performSearch(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const query = new Float32Array(request.query);

    const filters = this.resolveFilters(request);
    const hasFilters = Object.keys(filters).length > 0;

    let hits: Array<{ id: number; similarity: number; distance: number }> | null = null;

    // HNSW (approximate) only for unfiltered searches: its post-filter reads
    // agentdb's own pattern_embeddings table, not this bridge's vectors table
    if (this.hnswIndex && !hasFilters) {
      try {
        if (!this.hnswBuilt) {
          await this.hnswIndex.buildIndex('vectors');
          this.hnswBuilt = this.hnswIndex.isReady();
        }
        if (this.hnswBuilt) {
          hits = await this.hnswIndex.search(query, request.k, { threshold: request.threshold });
        }
      } catch (error) {
        this.logger.debug('HNSW search failed, using exact search');
        hits = null;
      }
    }

    if (!hits && this.vectorSearch) {
      hits = await this.vectorSearch.findKNN(query, request.k, 'vectors', {
        threshold: request.threshold,
        filters: hasFilters ? filters : undefined,
      });
    }

    if (!hits || hits.length === 0) return [];

    // findKNN/HNSW return ids + scores; hydrate metadata from the table
    const ids = hits.map((h) => h.id);
    const rows = this.db.prepare(
      `SELECT pattern_id, metadata FROM vectors WHERE pattern_id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids) as Array<{ pattern_id: number; metadata: string | null }>;
    const meta = new Map(rows.map((r) => [Number(r.pattern_id), r.metadata]));

    return hits.map((h) => {
      let metadata: Record<string, any> = {};
      const raw = meta.get(Number(h.id));
      if (raw) {
        try { metadata = JSON.parse(raw); } catch { /* keep {} */ }
      }
      return { id: Number(h.id), similarity: h.similarity, distance: h.distance, metadata };
    });
  }

  /**
   * Perform pattern storage
   */
  private async performPatternStore(request: PatternStoreRequest): Promise<boolean> {
    // Create patterns table if it doesn't exist
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pattern TEXT NOT NULL,
          category TEXT NOT NULL,
          embedding BLOB,
          metadata TEXT
        )
      `);
    } catch (error) {
      // Table might already exist
    }

    const stmt = this.db.prepare(`
      INSERT INTO patterns (pattern, category, embedding, metadata)
      VALUES (?, ?, ?, ?)
    `);

    const embedding = request.embedding
      ? Buffer.from(new Float32Array(request.embedding).buffer)
      : null;

    stmt.run(
      request.pattern,
      request.category,
      embedding,
      JSON.stringify(request.metadata || {})
    );

    return true;
  }

  /**
   * Ensure bridge is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new BridgeError(
        BridgeErrorCode.NOT_INITIALIZED,
        'AgentDB bridge not initialized. Call initialize() first.'
      );
    }
  }
}
