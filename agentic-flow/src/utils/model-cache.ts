/**
 * Global Model Cache
 *
 * Caches loaded models in memory to avoid repeated initialization overhead.
 * Supports ONNX embeddings, transformers.js pipelines, and other heavy models.
 */

interface CachedModel {
  model: any;
  loadedAt: number;
  lastUsed: number;
  useCount: number;
  sizeEstimate: number; // bytes
}

interface CacheStats {
  models: number;
  totalSize: number;
  size?: number;
  totalHits: number;
  totalMisses: number;
  hits: number;
  misses: number;
  hitRate: number;
}

class ModelCache {
  private cache = new Map<string, CachedModel>();
  private maxSize: number; // Max cache size in bytes
  private totalHits = 0;
  private totalMisses = 0;

  constructor(maxSizeMB: number = 512) {
    this.maxSize = maxSizeMB * 1024 * 1024;
  }

  /**
   * Get a cached model or load it
   */
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    sizeEstimate: number = 50 * 1024 * 1024 // Default 50MB estimate
  ): Promise<T> {
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
      cached.useCount++;
      this.totalHits++;
      return cached.model as T;
    }

    this.totalMisses++;

    // Evict if needed
    this.evictIfNeeded(sizeEstimate);

    // Load model
    const model = await loader();

    this.cache.set(key, {
      model,
      loadedAt: Date.now(),
      lastUsed: Date.now(),
      useCount: 1,
      sizeEstimate
    });

    return model;
  }

  /**
   * Check if model is cached
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Get cached model without loading
   */
  get<T>(key: string): T | undefined {
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
      cached.useCount++;
      return cached.model as T;
    }
    return undefined;
  }

  /**
   * Manually cache a model
   */
  set(key: string, model: any, sizeEstimate: number = 50 * 1024 * 1024): void {
    this.evictIfNeeded(sizeEstimate);
    this.cache.set(key, {
      model,
      loadedAt: Date.now(),
      lastUsed: Date.now(),
      useCount: 1,
      sizeEstimate
    });
  }

  /**
   * Remove a model from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached models
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let totalSize = 0;
    for (const cached of this.cache.values()) {
      totalSize += cached.sizeEstimate;
    }
    const hits = this.totalHits;
    const misses = this.totalMisses;
    const total = hits + misses;
    return {
      models: this.cache.size,
      totalSize,
      size: this.cache.size,
      totalHits: hits,
      totalMisses: misses,
      hits,
      misses,
      hitRate: total > 0 ? hits / total : 0
    };
  }

  /**
   * Evict least recently used models if cache is full
   */
  private evictIfNeeded(newSize: number): void {
    let currentSize = 0;
    for (const cached of this.cache.values()) {
      currentSize += cached.sizeEstimate;
    }

    if (currentSize + newSize <= this.maxSize) {
      return;
    }

    // Sort by last used time (LRU)
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    // Evict until we have space
    for (const [key, cached] of entries) {
      if (currentSize + newSize <= this.maxSize) {
        break;
      }
      this.cache.delete(key);
      currentSize -= cached.sizeEstimate;
    }
  }
}

// Global singleton
export const modelCache = new ModelCache();

// Convenience functions
export async function getCachedOnnxEmbedder(): Promise<any> {
  return modelCache.getOrLoad(
    'onnx-embeddings',
    async () => {
      // Suppress experimental warning for WASM
      const originalEmit = process.emit;
      // @ts-ignore
      process.emit = function (name, data, ...args) {
        if (name === 'warning' && typeof data === 'object' &&
            (data as any).name === 'ExperimentalWarning' &&
            (data as any).message?.includes('Import')) {
          return false;
        }
        // @ts-ignore
        return originalEmit.apply(process, [name, data, ...args]);
      };

      try {
        const onnxModule = await import('ruvector-onnx-embeddings-wasm') as any;
        const EmbedderClass = onnxModule.OnnxEmbeddings || onnxModule.default;
        if (EmbedderClass) {
          const embedder = new EmbedderClass();
          await embedder.initialize?.();
          return embedder;
        }
      } finally {
        process.emit = originalEmit;
      }
      return null;
    },
    100 * 1024 * 1024 // 100MB estimate for ONNX model
  );
}

export async function getCachedTransformersPipeline(
  task: string = 'feature-extraction',
  model: string = 'Xenova/all-MiniLM-L6-v2'
): Promise<any> {
  return modelCache.getOrLoad(
    `transformers:${task}:${model}`,
    async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline(task as any, model);
    },
    200 * 1024 * 1024 // 200MB estimate for transformers model
  );
}

export async function getCachedRuvectorCore(): Promise<any> {
  return modelCache.getOrLoad(
    'ruvector-core',
    async () => {
      const ruvector = await import('ruvector');
      return ruvector;
    },
    50 * 1024 * 1024
  );
}
