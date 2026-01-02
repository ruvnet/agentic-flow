/**
 * HNSWLibBackend - Vector backend adapter for hnswlib-node
 *
 * Wraps existing HNSWIndex controller to implement VectorBackend interface.
 * Handles string ID to numeric label mapping required by hnswlib.
 *
 * Features:
 * - String ID support (maps to hnswlib numeric labels)
 * - Metadata storage alongside vectors
 * - Persistent save/load with mappings
 * - Backward compatible with existing HNSWIndex usage
 *
 * Note: hnswlib-node doesn't support true deletion - removed IDs are
 * tracked but vectors remain until rebuild.
 */

import type {
  VectorBackend,
  VectorConfig,
  SearchResult,
  SearchOptions,
  VectorStats,
} from '../VectorBackend.js';
import hnswlibNode from 'hnswlib-node';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

const { HierarchicalNSW } = hnswlibNode as any;

interface SavedMappings {
  idToLabel: Record<string, number>;
  labelToId: Record<string, string>;
  metadata: Record<string, Record<string, any>>;
  nextLabel: number;
  config: VectorConfig;
}

export class HNSWLibBackend implements VectorBackend {
  readonly name = 'hnswlib' as const;

  private index: any | null = null;
  private config: VectorConfig;

  // String ID <-> Numeric Label mappings (hnswlib requires numeric labels)
  private idToLabel: Map<string, number> = new Map();
  private labelToId: Map<number, string> = new Map();
  private metadata: Map<string, Record<string, any>> = new Map();
  private nextLabel: number = 0;

  // Tracking for deletions (hnswlib doesn't support true deletion)
  private deletedIds: Set<string> = new Set();

  constructor(config: VectorConfig) {
    // Handle both dimension and dimensions for backward compatibility
    const dimension = config.dimension ?? config.dimensions;
    if (!dimension) {
      throw new Error('Vector dimension is required (use dimension or dimensions)');
    }
    this.config = {
      maxElements: 100000,
      M: 16,
      efConstruction: 200,
      efSearch: 100,
      ...config,
      dimension,  // Ensure dimension (singular) is always set
    };
  }

  /**
   * Initialize the HNSW index
   * Must be called after construction
   */
  async initialize(): Promise<void> {
    // Map metric names to hnswlib format
    const metricMap: Record<string, string> = {
      cosine: 'cosine',
      l2: 'l2',
      ip: 'ip',
    };

    const metric = metricMap[this.config.metric] || 'cosine';

    // Create new HNSW index
    this.index = new HierarchicalNSW(metric, this.config.dimension);
    this.index.initIndex(
      this.config.maxElements!,
      this.config.M!,
      this.config.efConstruction!
    );
    this.index.setEf(this.config.efSearch!);

    console.log(
      `[HNSWLibBackend] Initialized with dimension=${this.config.dimension}, ` +
        `metric=${metric}, M=${this.config.M}, efConstruction=${this.config.efConstruction}`
    );
  }

  /**
   * Insert a single vector with optional metadata
   */
  insert(id: string, embedding: Float32Array, metadata?: Record<string, any>): void {
    if (!this.index) {
      throw new Error('Backend not initialized. Call initialize() first.');
    }

    // Check if ID already exists
    if (this.idToLabel.has(id)) {
      if (this.deletedIds.has(id)) {
        // ID was "deleted", so we can overwrite it.
        // We must assign a NEW label because hnswlib doesn't support overwriting vectors at old labels easily.
        // The old vector at the old label remains in memory (leak) but is unreachable.
      } else {
        throw new Error(`Vector with ID '${id}' already exists`);
      }
    }

    // Allocate numeric label
    const label = this.nextLabel++;

    // Add to index (hnswlib requires number[] not Float32Array)
    this.index.addPoint(Array.from(embedding), label);

    // Store mappings
    this.idToLabel.set(id, label);
    this.labelToId.set(label, id);

    // Store metadata if provided
    if (metadata) {
      this.metadata.set(id, metadata);
    }

    // Remove from deleted set if re-inserting
    this.deletedIds.delete(id);
  }

  /**
   * Insert multiple vectors in batch
   */
  insertBatch(
    items: Array<{
      id: string;
      embedding: Float32Array;
      metadata?: Record<string, any>;
    }>
  ): void {
    for (const item of items) {
      this.insert(item.id, item.embedding, item.metadata);
    }
  }

  /**
   * Search for k-nearest neighbors
   */
  search(query: Float32Array, k: number, options?: SearchOptions): SearchResult[] {
    if (!this.index) {
      throw new Error('Backend not initialized. Call initialize() first.');
    }

    // Update efSearch if specified
    if (options?.efSearch) {
      this.index.setEf(options.efSearch);
    }

    // Perform HNSW search
    const result = this.index.searchKnn(Array.from(query), k);

    const results: SearchResult[] = [];

    for (let i = 0; i < result.neighbors.length; i++) {
      const label = result.neighbors[i];
      const distance = result.distances[i];

      // Map label back to ID
      const id = this.labelToId.get(label);
      if (!id) {
        console.warn(`[HNSWLibBackend] Label ${label} not found in mapping`);
        continue;
      }

      // Skip deleted IDs
      if (this.deletedIds.has(id)) {
        continue;
      }

      // Convert distance to similarity
      const similarity = this.distanceToSimilarity(distance);

      // Apply threshold if specified
      if (options?.threshold !== undefined && similarity < options.threshold) {
        continue;
      }

      results.push({
        id,
        distance,
        similarity,
        metadata: this.metadata.get(id),
      });
    }

    // Apply metadata filters if specified (post-filtering)
    if (options?.filter) {
      return this.applyFilters(results, options.filter);
    }

    return results;
  }

  /**
   * Remove a vector by ID
   * Note: hnswlib doesn't support true deletion - we mark as deleted
   */
  remove(id: string): boolean {
    const label = this.idToLabel.get(id);
    if (label === undefined) {
      return false; // Not found
    }

    // Mark as deleted (can't actually remove from hnswlib)
    this.deletedIds.add(id);
    this.metadata.delete(id);

    // Note: We keep idToLabel/labelToId mappings for consistency
    // A full rebuild would be needed to reclaim space

    return true;
  }

  /**
   * Get backend statistics
   */
  getStats(): VectorStats {
    const activeCount = this.idToLabel.size - this.deletedIds.size;

    return {
      count: activeCount,
      dimension: this.config.dimension || 384,
      metric: this.config.metric,
      backend: 'hnswlib',
      memoryUsage: 0, // hnswlib doesn't expose memory usage
    };
  }

  /**
   * Save index to disk with mappings
   */
  async save(savePath: string): Promise<void> {
    if (!this.index) {
      throw new Error('No index to save');
    }

    try {
      // Create directory if needed
      const indexDir = path.dirname(savePath);
      if (!fsSync.existsSync(indexDir)) {
        await fs.mkdir(indexDir, { recursive: true });
      }

      // Save HNSW index
      this.index.writeIndex(savePath);

      // Save mappings and metadata
      const mappingsPath = savePath + '.mappings.json';
      const mappings: SavedMappings = {
        idToLabel: Object.fromEntries(this.idToLabel.entries()),
        labelToId: Object.fromEntries(
          Array.from(this.labelToId.entries()).map(([k, v]) => [k.toString(), v])
        ),
        metadata: Object.fromEntries(this.metadata.entries()),
        nextLabel: this.nextLabel,
        config: this.config,
      };

      await fs.writeFile(mappingsPath, JSON.stringify(mappings, null, 2));

      console.log(`[HNSWLibBackend] Index saved to ${savePath}`);
      console.log(`[HNSWLibBackend] Mappings saved to ${mappingsPath}`);
    } catch (error) {
      console.error('[HNSWLibBackend] Failed to save index:', error);
      throw error;
    }
  }

  /**
   * Load index from disk with mappings
   */
  async load(loadPath: string): Promise<void> {
    if (!fsSync.existsSync(loadPath)) {
      throw new Error(`Index file not found: ${loadPath}`);
    }

    try {
      console.log(`[HNSWLibBackend] Loading index from ${loadPath}...`);

      // Initialize index first
      const metricMap: Record<string, string> = {
        cosine: 'cosine',
        l2: 'l2',
        ip: 'ip',
      };
      const metric = metricMap[this.config.metric] || 'cosine';

      this.index = new HierarchicalNSW(metric, this.config.dimension);

      // Load HNSW index
      this.index.readIndex(loadPath);
      this.index.setEf(this.config.efSearch!);

      // Load mappings and metadata
      const mappingsPath = loadPath + '.mappings.json';
      if (fsSync.existsSync(mappingsPath)) {
        const mappingsData: SavedMappings = JSON.parse(
          await fs.readFile(mappingsPath, 'utf-8')
        );

        // Restore mappings
        this.idToLabel = new Map(Object.entries(mappingsData.idToLabel));
        this.labelToId = new Map(
          Object.entries(mappingsData.labelToId).map(([k, v]) => [Number(k), v])
        );
        this.metadata = new Map(Object.entries(mappingsData.metadata || {}));
        this.nextLabel = mappingsData.nextLabel;

        // Update config if saved
        if (mappingsData.config) {
          this.config = { ...this.config, ...mappingsData.config };
        }

        console.log(
          `[HNSWLibBackend] ✅ Index loaded successfully (${this.idToLabel.size} vectors)`
        );
      } else {
        console.warn(
          '[HNSWLibBackend] No mappings file found - index loaded without ID mappings'
        );
      }
    } catch (error) {
      console.error('[HNSWLibBackend] Failed to load index:', error);
      this.index = null;
      throw error;
    }
  }

  /**
   * Close and cleanup resources
   */
  close(): void {
    this.index = null;
    this.idToLabel.clear();
    this.labelToId.clear();
    this.metadata.clear();
    this.deletedIds.clear();
    this.nextLabel = 0;
  }

  /**
   * Convert distance to similarity based on metric
   * Maps to [0, 1] range where 1 = most similar
   */
  private distanceToSimilarity(distance: number): number {
    switch (this.config.metric) {
      case 'cosine':
        // Cosine distance is 1 - similarity, so invert
        return 1 - distance;

      case 'l2':
        // Euclidean distance: use exponential decay
        return Math.exp(-distance);

      case 'ip':
        // Inner product: use Sigmoid to map [-inf, +inf] to [0, 1]
        // Higher IP = Higher Similarity
        return 1 / (1 + Math.exp(-distance));

      default:
        return 1 - distance;
    }
  }

  /**
   * Apply metadata filters (post-filtering)
   */
  private applyFilters(
    results: SearchResult[],
    filters: Record<string, any>
  ): SearchResult[] {
    return results.filter((result) => {
      if (!result.metadata) return false;

      // Check if all filter conditions match
      return Object.entries(filters).every(([key, value]) => {
        return result.metadata![key] === value;
      });
    });
  }

  /**
   * Check if needs rebuilding (for backward compat with HNSWIndex)
   * @param updateThreshold - Percentage of deletes to trigger rebuild (default: 0.1)
   */
  needsRebuild(updateThreshold: number = 0.1): boolean {
    if (this.idToLabel.size === 0) return false;

    const deletePercentage = this.deletedIds.size / this.idToLabel.size;
    return deletePercentage > updateThreshold;
  }

  /**
   * Update efSearch parameter
   */
  setEfSearch(ef: number): void {
    if (this.index) {
      this.index.setEf(ef);
      this.config.efSearch = ef;
      console.log(`[HNSWLibBackend] efSearch updated to ${ef}`);
    }
  }

  /**
   * Check if backend is ready
   */
  isReady(): boolean {
    return this.index !== null;
  }
}
