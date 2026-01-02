/**
 * VectorBackend - Unified interface for vector database backends
 *
 * Provides abstraction over different vector search implementations
 * (RuVector, hnswlib-node) for AgentDB v2.
 *
 * Design:
 * - String-based IDs for all operations (backends handle label mapping internally)
 * - Consistent SearchResult format across backends
 * - Save/load with metadata persistence
 * - Backend-specific optimizations hidden behind interface
 */

export interface VectorConfig {
  /** Vector dimension (e.g., 384, 768, 1536) */
  dimension?: number;
  /** Alias for dimension (backward compatibility) */
  dimensions?: number;

  /** Distance metric: 'cosine', 'l2' (Euclidean), 'ip' (inner product) */
  metric: 'cosine' | 'l2' | 'ip';

  /** Maximum number of elements (default: 100000) */
  maxElements?: number;

  /** HNSW M parameter - connections per layer (default: 16) */
  M?: number;

  /** HNSW efConstruction - build quality (default: 200) */
  efConstruction?: number;

  /** HNSW efSearch - search quality (default: 100) */
  efSearch?: number;
}

export interface SearchResult {
  /** String ID of the vector */
  id: string;

  /** Raw distance value from backend */
  distance: number;

  /** Normalized similarity (0-1, higher is more similar) */
  similarity: number;

  /** Optional metadata attached to vector */
  metadata?: Record<string, any>;
}

export interface SearchOptions {
  /** Minimum similarity threshold (0-1) */
  threshold?: number;

  /** Override efSearch for this query */
  efSearch?: number;

  /** Metadata filters (post-filtering) */
  filter?: Record<string, any>;
}

export interface VectorStats {
  /** Number of vectors in index */
  count: number;

  /** Vector dimension */
  dimension: number;

  /** Distance metric */
  metric: string;

  /** Backend name */
  backend: 'ruvector' | 'hnswlib';

  /** Memory usage in bytes (0 if not available) */
  memoryUsage: number;
}

/**
 * VectorBackend - Interface for vector search implementations
 *
 * All backends must:
 * 1. Accept string IDs and handle label mapping internally
 * 2. Normalize distances to similarities (0-1 range)
 * 3. Support save/load with metadata persistence
 * 4. Provide stats for monitoring
 */
export interface VectorBackend {
  /** Backend name for detection and logging */
  readonly name: 'ruvector' | 'hnswlib';

  /**
   * Initialize the backend and underlying engine
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<void>;

  /**
   * Insert a single vector with optional metadata
   * @param id - Unique string identifier
   * @param embedding - Vector as Float32Array
   * @param metadata - Optional metadata to store with vector
   */
  insert(id: string, embedding: Float32Array, metadata?: Record<string, any>): void;

  /**
   * Insert multiple vectors in batch (more efficient)
   * @param items - Array of {id, embedding, metadata?}
   */
  insertBatch(items: Array<{
    id: string;
    embedding: Float32Array;
    metadata?: Record<string, any>;
  }>): void;

  /**
   * Search for k-nearest neighbors
   * @param query - Query vector
   * @param k - Number of results
   * @param options - Search options (threshold, efSearch, filters)
   * @returns Sorted results (most similar first)
   */
  search(query: Float32Array, k: number, options?: SearchOptions): SearchResult[];

  /**
   * Remove a vector by ID
   * @param id - Vector ID to remove
   * @returns true if removed, false if not found
   */
  remove(id: string): boolean;

  /**
   * Get backend statistics
   * @returns Stats object with count, dimension, backend name, etc.
   */
  getStats(): VectorStats;

  /**
   * Save index to disk
   * @param path - File path (backend adds extensions as needed)
   */
  save(path: string): Promise<void>;

  /**
   * Load index from disk
   * @param path - File path (backend looks for associated files)
   */
  load(path: string): Promise<void>;

  /**
   * Close and cleanup resources
   */
  close(): void;
}
