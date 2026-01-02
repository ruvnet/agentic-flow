/**
 * RuVectorBackend - High-Performance Vector Storage
 *
 * Implements VectorBackend using @ruvector/core with optional GNN support.
 * Provides <100µs search latency with native SIMD optimizations.
 *
 * Features:
 * - Automatic fallback when @ruvector packages not installed
 * - Separate metadata storage for rich queries
 * - Distance-to-similarity conversion for all metrics
 * - Batch operations for optimal throughput
 * - Persistent storage with separate metadata files
 */

import type { VectorBackend, VectorConfig, SearchResult, SearchOptions, VectorStats } from '../VectorBackend.js';

export class RuVectorBackend implements VectorBackend {
  readonly name = 'ruvector' as const;
  private db: any; // VectorDB from @ruvector/core
  private config: VectorConfig;
  private metadata: Map<string, Record<string, any>> = new Map();
  private initialized = false;

  constructor(config: VectorConfig) {
    // Handle both dimension and dimensions for backward compatibility
    const dimension = config.dimension ?? config.dimensions;
    if (!dimension) {
      throw new Error('Vector dimension is required (use dimension or dimensions)');
    }
    // Store both forms for compatibility with different backends
    this.config = { ...config, dimension, dimensions: dimension };
  }

  /**
   * Initialize RuVector database with optional dependency handling
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Try main ruvector package first (includes core, gnn, graph)
      let VectorDB;
      try {
        const ruvector = await import('ruvector');
        VectorDB = ruvector.VectorDB || ruvector.default?.VectorDB;
      } catch {
        // Fallback to @ruvector/core for backward compatibility
        const core = await import('@ruvector/core');
        // ESM and CommonJS both export as VectorDB (capital 'DB')
        VectorDB = core.VectorDB || core.default?.VectorDB;
      }

      if (!VectorDB) {
        throw new Error('Could not find VectorDB export in @ruvector/core');
      }

      // Handle both 'dimension' and 'dimensions' for backward compatibility
      const dimensions = this.config.dimension ?? this.config.dimensions;
      if (!dimensions) {
        throw new Error('Vector dimension is required (use dimension or dimensions)');
      }

      // RuVector VectorDB constructor signature
      this.db = new VectorDB({
        dimensions: dimensions,  // Note: config object, not positional arg
        metric: this.config.metric,
        maxElements: this.config.maxElements || 100000,
        efConstruction: this.config.efConstruction || 200,
        m: this.config.M || 16  // Note: lowercase 'm'
      });

      this.initialized = true;
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Special handling for path validation errors (from ruvector package)
      // When using :memory:, ruvector may reject it as a path traversal attempt
      // This is expected and not critical - users should use file-based paths for ruvector persistence
      if (errorMessage.includes('Path traversal') || errorMessage.includes('Invalid path')) {
        throw new Error(
          `RuVector does not support :memory: database paths.\n` +
          `Use a file path instead, or RuVector will be skipped and fallback backend will be used.\n` +
          `Original error: ${errorMessage}`
        );
      }

      throw new Error(
        `RuVector initialization failed. Please install: npm install ruvector\n` +
        `Or legacy packages: npm install @ruvector/core\n` +
        `Error: ${errorMessage}`
      );
    }
  }

  /**
   * Insert single vector with optional metadata
   */
  insert(id: string, embedding: Float32Array, metadata?: Record<string, any>): void {
    this.ensureInitialized();

    // RuVector v0.1.30+ uses object API with 'vector' field
    // Native VectorDB requires Float32Array, not regular array
    this.db.insert({
      id: id,
      vector: embedding instanceof Float32Array ? embedding : new Float32Array(embedding),
      metadata: metadata
    });

    if (metadata) {
      this.metadata.set(id, metadata);
    }
  }

  /**
   * Batch insert for optimal performance
   */
  insertBatch(items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, any> }>): void {
    this.ensureInitialized();

    for (const item of items) {
      this.insert(item.id, item.embedding, item.metadata);
    }
  }

  /**
   * Search for k-nearest neighbors with optional filtering
   */
  search(query: Float32Array, k: number, options?: SearchOptions): SearchResult[] {
    this.ensureInitialized();

    // Apply efSearch parameter if provided
    if (options?.efSearch) {
      this.db.setEfSearch(options.efSearch);
    }

    // RuVector v0.1.30+ supports both object API and legacy positional args
    // Use object API for consistency with insert
    // Native VectorDB requires Float32Array, not regular array
    const results = this.db.search({
      vector: query instanceof Float32Array ? query : new Float32Array(query),
      k: k,
      threshold: options?.threshold,
      filter: options?.filter
    });

    // Convert results and apply filtering
    return results
      .map((r: { id: string; distance: number }) => ({
        id: r.id,
        distance: r.distance,
        similarity: this.distanceToSimilarity(r.distance),
        metadata: this.metadata.get(r.id)
      }))
      .filter((r: SearchResult) => {
        // Apply similarity threshold
        if (options?.threshold && r.similarity < options.threshold) {
          return false;
        }

        // Apply metadata filters
        if (options?.filter && r.metadata) {
          return Object.entries(options.filter).every(
            ([key, value]) => r.metadata![key] === value
          );
        }

        return true;
      });
  }

  /**
   * Remove vector by ID
   */
  remove(id: string): boolean {
    this.ensureInitialized();

    this.metadata.delete(id);

    try {
      return this.db.remove(id);
    } catch {
      return false;
    }
  }

  /**
   * Get database statistics
   */
  getStats(): VectorStats {
    this.ensureInitialized();

    return {
      count: this.db.count(),
      dimension: this.config.dimension || 384,
      metric: this.config.metric,
      backend: 'ruvector',
      memoryUsage: this.db.memoryUsage?.() || 0
    };
  }

  /**
   * Save index and metadata to disk
   */
  async save(path: string): Promise<void> {
    this.ensureInitialized();

    // Save vector index
    this.db.save(path);

    // Save metadata separately as JSON
    const metadataPath = path + '.meta.json';
    const fs = await import('fs/promises');
    await fs.writeFile(
      metadataPath,
      JSON.stringify(Object.fromEntries(this.metadata), null, 2)
    );
  }

  /**
   * Load index and metadata from disk
   */
  async load(path: string): Promise<void> {
    this.ensureInitialized();

    // Load vector index
    this.db.load(path);

    // Load metadata
    const metadataPath = path + '.meta.json';
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(metadataPath, 'utf-8');
      this.metadata = new Map(Object.entries(JSON.parse(data)));
    } catch {
      // No metadata file - this is okay for backward compatibility
      console.debug(`[RuVectorBackend] No metadata file found at ${metadataPath}`);
    }
  }

  /**
   * Close and cleanup resources
   */
  close(): void {
    // RuVector cleanup if needed
    this.metadata.clear();
  }

  /**
   * Convert distance to similarity score based on metric
   *
   * Cosine: distance is already in [0, 2], where 0 = identical
   * L2: exponential decay for unbounded distances
   * IP: negative inner product, so negate for similarity
   */
  private distanceToSimilarity(distance: number): number {
    switch (this.config.metric) {
      case 'cosine':
        return 1 - distance; // cosine distance is 1 - similarity
      case 'l2':
        return Math.exp(-distance); // exponential decay
      case 'ip':
        // Inner product: use Sigmoid to map [-inf, +inf] to [0, 1]
        // Higher IP = Higher Similarity
        return 1 / (1 + Math.exp(-distance));
      default:
        return 1 - distance;
    }
  }

  /**
   * Ensure database is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RuVectorBackend not initialized. Call initialize() first.');
    }
  }
}
