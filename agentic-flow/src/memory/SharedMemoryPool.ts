/**
 * SharedMemoryPool — singleton resource pool that backs HybridReasoningBank
 * and AdvancedMemorySystem.
 *
 * Centralises a single SQLite database handle (better-sqlite3) and a single
 * `EmbeddingService` instance so multiple memory consumers share the same
 * underlying tables / embedding cache without conflicting writes.
 *
 * The pool is constructed lazily on first `getInstance()` call. All heavy
 * resources (sqlite handle, embedder pipeline) are created on demand inside
 * `ensureInitialized()` so simply importing this module is side-effect free.
 *
 * Used by:
 *   - reasoningbank/HybridBackend.ts   (HybridReasoningBank)
 *   - reasoningbank/AdvancedMemory.ts  (AdvancedMemorySystem)
 *
 * Fixes issue #102 — this file was previously imported but missing on disk,
 * which broke `import 'agentic-flow'` at the top level.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { EmbeddingService } from 'agentdb';

type DatabaseHandle = any;
type EmbedderHandle = EmbeddingService;

export interface SharedMemoryPoolOptions {
  /** SQLite database path. Defaults to `~/.agentic-flow/reasoningbank.db`. */
  dbPath?: string;
  /** Embedding model id. Defaults to `Xenova/all-MiniLM-L6-v2`. */
  embeddingModel?: string;
  /** Embedding vector dimension. Defaults to 384 (MiniLM-L6). */
  embeddingDimension?: number;
  /** Embedding provider. Defaults to `'transformers'`. */
  embeddingProvider?: 'transformers' | 'openai' | 'local';
}

const DEFAULT_OPTIONS: Required<SharedMemoryPoolOptions> = {
  dbPath: join(homedir(), '.agentic-flow', 'reasoningbank.db'),
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  embeddingDimension: 384,
  embeddingProvider: 'transformers',
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface SharedMemoryPoolStats {
  initialized: boolean;
  dbPath: string;
  embeddingModel: string;
  embeddingDimension: number;
  cache: {
    entries: number;
    hits: number;
    misses: number;
    evictions: number;
  };
}

export class SharedMemoryPool {
  private static _instance: SharedMemoryPool | null = null;

  private readonly options: Required<SharedMemoryPoolOptions>;
  private db: DatabaseHandle | null = null;
  private embedder: EmbedderHandle | null = null;
  private initPromise: Promise<void> | null = null;

  // Lightweight in-process query cache used by HybridReasoningBank to avoid
  // re-running the same retrieval across consumers in one session.
  private cache = new Map<string, CacheEntry<unknown>>();
  private cacheStats = { hits: 0, misses: 0, evictions: 0 };

  private constructor(options: SharedMemoryPoolOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Singleton accessor. The first caller wins for option overrides; later
   * callers always get the existing pool. To reconfigure, call `reset()`.
   */
  static getInstance(options?: SharedMemoryPoolOptions): SharedMemoryPool {
    if (!SharedMemoryPool._instance) {
      SharedMemoryPool._instance = new SharedMemoryPool(options);
    }
    return SharedMemoryPool._instance;
  }

  /** Tear down the singleton — primarily for tests. */
  static reset(): void {
    if (SharedMemoryPool._instance) {
      SharedMemoryPool._instance.close();
    }
    SharedMemoryPool._instance = null;
  }

  /**
   * Idempotently ensure the database and embedder are ready. Subsequent calls
   * return the same in-flight promise so concurrent consumers share init.
   */
  async ensureInitialized(): Promise<void> {
    if (this.db && this.embedder) return;
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    // Dynamic import keeps node:fs, better-sqlite3, and the embedding pipeline
    // out of the import graph for callers that never use them.
    const Database = await loadBetterSqlite3();

    mkdirSync(dirname(this.options.dbPath), { recursive: true });
    this.db = new Database(this.options.dbPath);
    // Reasonable defaults for an embedded reasoning database.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');

    this.applySchema(this.db);

    this.embedder = new EmbeddingService({
      model: this.options.embeddingModel,
      dimension: this.options.embeddingDimension,
      provider: this.options.embeddingProvider,
    });
    await this.embedder.initialize();
  }

  /** Apply the minimum schema that ReflexionMemory / SkillLibrary require. */
  private applySchema(db: DatabaseHandle): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        session_id   TEXT NOT NULL,
        task         TEXT NOT NULL,
        input        TEXT,
        output       TEXT,
        critique     TEXT,
        reward       REAL NOT NULL,
        success      INTEGER NOT NULL,
        latency_ms   INTEGER,
        tokens_used  INTEGER,
        tags         TEXT,
        metadata     TEXT
      );

      CREATE TABLE IF NOT EXISTS episode_embeddings (
        episode_id   INTEGER PRIMARY KEY,
        embedding    BLOB NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_task    ON episodes(task);
      CREATE INDEX IF NOT EXISTS idx_episodes_ts      ON episodes(ts);
      CREATE INDEX IF NOT EXISTS idx_episodes_success ON episodes(success);

      CREATE TABLE IF NOT EXISTS skills (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        name         TEXT NOT NULL,
        description  TEXT,
        precondition TEXT,
        action       TEXT,
        outcome      TEXT,
        success_rate REAL,
        uses         INTEGER DEFAULT 0,
        tags         TEXT,
        metadata     TEXT,
        UNIQUE(name)
      );

      CREATE TABLE IF NOT EXISTS skill_embeddings (
        skill_id     INTEGER PRIMARY KEY,
        embedding    BLOB NOT NULL,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS causal_edges (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ts              INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        from_memory_id   INTEGER NOT NULL,
        from_memory_type TEXT NOT NULL,
        to_memory_id     INTEGER NOT NULL,
        to_memory_type   TEXT NOT NULL,
        similarity      REAL,
        uplift          REAL,
        confidence      REAL,
        sample_size     INTEGER,
        metadata        TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_causal_from ON causal_edges(from_memory_id, from_memory_type);
      CREATE INDEX IF NOT EXISTS idx_causal_to   ON causal_edges(to_memory_id, to_memory_type);
    `);
  }

  /**
   * Synchronous accessor for the database handle. Throws if init hasn't run —
   * call `ensureInitialized()` first. Provided for compatibility with
   * controllers that take a `Database` instance in their constructor.
   */
  getDatabase(): DatabaseHandle {
    if (!this.db) {
      throw new Error(
        'SharedMemoryPool: database not initialised. Call ensureInitialized() first.'
      );
    }
    return this.db;
  }

  /**
   * Synchronous accessor for the embedder. Throws if init hasn't run.
   */
  getEmbedder(): EmbedderHandle {
    if (!this.embedder) {
      throw new Error(
        'SharedMemoryPool: embedder not initialised. Call ensureInitialized() first.'
      );
    }
    return this.embedder;
  }

  /**
   * Cache a query result with a TTL (milliseconds). Keys are arbitrary
   * strings; consumers (HybridReasoningBank) typically encode the query
   * shape into the key.
   */
  cacheQuery<T>(key: string, value: T, ttlMs: number): void {
    if (!key || ttlMs <= 0) return;
    this.cache.set(key, {
      value: value as unknown,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Read a cached query result. Returns the cached value if present and not
   * expired; lazily evicts expired entries on lookup.
   *
   * The default `T` is `any` for ergonomic interop with the existing
   * HybridReasoningBank call sites that expect a loose return type.
   * Pass an explicit type parameter (`getCachedQuery<MyShape>(...)`) when
   * you want stricter typing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCachedQuery<T = any>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.cacheStats.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.cacheStats.evictions++;
      this.cacheStats.misses++;
      return undefined;
    }
    this.cacheStats.hits++;
    return entry.value as T;
  }

  /** Drop all cached query results. */
  invalidateCache(): void {
    this.cacheStats.evictions += this.cache.size;
    this.cache.clear();
  }

  /** Diagnostic stats for telemetry / health endpoints. */
  getStats(): SharedMemoryPoolStats {
    return {
      initialized: this.db !== null && this.embedder !== null,
      dbPath: this.options.dbPath,
      embeddingModel: this.options.embeddingModel,
      embeddingDimension: this.options.embeddingDimension,
      cache: {
        entries: this.cache.size,
        hits: this.cacheStats.hits,
        misses: this.cacheStats.misses,
        evictions: this.cacheStats.evictions,
      },
    };
  }

  /** Close the underlying database handle and clear cached state. */
  close(): void {
    try {
      this.db?.close?.();
    } catch {
      /* swallow — closing twice is benign */
    }
    this.db = null;
    this.embedder = null;
    this.initPromise = null;
    this.cache.clear();
    this.cacheStats = { hits: 0, misses: 0, evictions: 0 };
  }
}

async function loadBetterSqlite3(): Promise<any> {
  // better-sqlite3 is a heavy native module; load it lazily so the rest of the
  // package can be imported even when this optional dep is unavailable.
  try {
    const mod: any = await import('better-sqlite3');
    return mod.default ?? mod;
  } catch (err: any) {
    throw new Error(
      `SharedMemoryPool requires 'better-sqlite3' but it could not be loaded: ${err?.message || err}. ` +
        `Install it with: npm install better-sqlite3`
    );
  }
}
