/**
 * MemorySynchronizer - Sync memory between ephemeral agents and persistent storage
 *
 * Features:
 * - Batched writes for performance
 * - Conflict resolution (last-write-wins)
 * - Cache frequently accessed memories
 * - Async background sync
 */

import { Memory, SyncBatch, CacheEntry } from './types.js';
import { MemoryPersistenceLayer } from './MemoryPersistenceLayer.js';
import { EventEmitter } from 'events';

export interface SyncConfig {
  batchSize?: number;
  batchInterval?: number; // milliseconds
  cacheSize?: number;
  cacheTTL?: number; // milliseconds
  enableCompression?: boolean;
  conflictStrategy?: 'last-write-wins' | 'merge' | 'reject';
}

export class MemorySynchronizer extends EventEmitter {
  private persistence: MemoryPersistenceLayer;
  private config: Required<SyncConfig>;
  private pendingWrites: Map<string, Memory>;
  private pendingDeletes: Set<string>;
  private cache: Map<string, CacheEntry>;
  private syncTimer?: NodeJS.Timeout;
  private lastSyncTime: number;

  constructor(persistence: MemoryPersistenceLayer, config: SyncConfig = {}) {
    super();
    this.persistence = persistence;
    this.config = {
      batchSize: 100,
      batchInterval: 1000, // 1 second
      cacheSize: 1000,
      cacheTTL: 60000, // 1 minute
      enableCompression: false,
      conflictStrategy: 'last-write-wins',
      ...config
    };

    this.pendingWrites = new Map();
    this.pendingDeletes = new Set();
    this.cache = new Map();
    this.lastSyncTime = Date.now();

    this.startBatchSync();
  }

  /**
   * Queue a memory write (will be batched)
   */
  async write(agentId: string, key: string, value: any): Promise<void> {
    const memory: Memory = {
      key,
      value,
      namespace: 'default',
      agentId,
      tenantId: '', // Will be set by persistence layer
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.pendingWrites.set(key, memory);

    // Remove from delete queue if present
    this.pendingDeletes.delete(key);

    // Update cache
    this.cacheSet(key, value);

    // If batch is full, sync immediately
    if (this.pendingWrites.size >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Queue a memory delete (will be batched)
   */
  async delete(key: string): Promise<void> {
    this.pendingDeletes.add(key);
    this.pendingWrites.delete(key);

    // Remove from cache
    this.cache.delete(key);

    // If batch is full, sync immediately
    if (this.pendingDeletes.size >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Read memory (with caching)
   */
  async read(key: string): Promise<any | null> {
    // Check cache first
    const cached = this.cacheGet(key);
    if (cached !== null) {
      return cached;
    }

    // Check pending writes
    const pending = this.pendingWrites.get(key);
    if (pending) {
      this.cacheSet(key, pending.value);
      return pending.value;
    }

    // Read from persistence
    const value = await this.persistence.getMemory(key);

    if (value !== null) {
      this.cacheSet(key, value);
    }

    return value;
  }

  /**
   * Read multiple memories (batched)
   */
  async readBatch(keys: string[]): Promise<Map<string, any>> {
    const results = new Map<string, any>();

    // Collect from cache and pending
    const uncached: string[] = [];

    for (const key of keys) {
      const cached = this.cacheGet(key);
      if (cached !== null) {
        results.set(key, cached);
        continue;
      }

      const pending = this.pendingWrites.get(key);
      if (pending) {
        results.set(key, pending.value);
        this.cacheSet(key, pending.value);
        continue;
      }

      uncached.push(key);
    }

    // Read uncached from persistence
    for (const key of uncached) {
      const value = await this.persistence.getMemory(key);
      if (value !== null) {
        results.set(key, value);
        this.cacheSet(key, value);
      }
    }

    return results;
  }

  /**
   * Search memories with semantic similarity
   */
  async search(query: string, k: number = 5): Promise<any[]> {
    const results = await this.persistence.searchMemories(query, k);
    return results.map(r => r.value);
  }

  /**
   * Flush all pending writes and deletes
   */
  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0 && this.pendingDeletes.size === 0) {
      return;
    }

    const startTime = Date.now();

    try {
      // Process writes
      const writes = Array.from(this.pendingWrites.values());
      for (const memory of writes) {
        await this.persistence.setMemory(
          memory.agentId,
          memory.key,
          memory.value
        );
      }

      // Process deletes
      for (const key of this.pendingDeletes) {
        await this.persistence.deleteMemory(key);
      }

      // Clear pending queues
      this.pendingWrites.clear();
      this.pendingDeletes.clear();

      const duration = Date.now() - startTime;
      this.lastSyncTime = Date.now();

      this.emit('sync', {
        writes: writes.length,
        deletes: this.pendingDeletes.size,
        duration
      });
    } catch (error: any) {
      this.emit('error', {
        message: 'Sync failed',
        error: error.message,
        pendingWrites: this.pendingWrites.size,
        pendingDeletes: this.pendingDeletes.size
      });
      throw error;
    }
  }

  /**
   * Preload memories into cache
   */
  async preload(keys: string[]): Promise<void> {
    const memories = await this.readBatch(keys);

    for (const [key, value] of memories.entries()) {
      this.cacheSet(key, value);
    }
  }

  /**
   * Get cache hit rate
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hits, 0);
    const avgHits = entries.length > 0 ? totalHits / entries.length : 0;

    return {
      size: this.cache.size,
      maxSize: this.config.cacheSize,
      hitRate: avgHits
    };
  }

  /**
   * Get sync statistics
   */
  getSyncStats(): {
    pendingWrites: number;
    pendingDeletes: number;
    lastSyncTime: number;
    timeSinceLastSync: number;
  } {
    return {
      pendingWrites: this.pendingWrites.size,
      pendingDeletes: this.pendingDeletes.size,
      lastSyncTime: this.lastSyncTime,
      timeSinceLastSync: Date.now() - this.lastSyncTime
    };
  }

  /**
   * Cache get with TTL check
   */
  private cacheGet(key: string): any | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Increment hit counter
    entry.hits++;

    return entry.value;
  }

  /**
   * Cache set with LRU eviction
   */
  private cacheSet(key: string, value: any): void {
    // Evict if cache is full
    if (this.cache.size >= this.config.cacheSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry = {
      value,
      expiresAt: Date.now() + this.config.cacheTTL,
      hits: 0
    };

    this.cache.set(key, entry);
  }

  /**
   * Evict least recently used cache entry
   */
  private evictLRU(): void {
    let minHits = Infinity;
    let lruKey: string | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < minHits) {
        minHits = entry.hits;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  /**
   * Start background batch sync
   */
  private startBatchSync(): void {
    this.syncTimer = setInterval(async () => {
      try {
        await this.flush();
      } catch (error) {
        // Error already emitted in flush()
      }
    }, this.config.batchInterval);
  }

  /**
   * Stop synchronization and flush pending data
   */
  async stop(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }

    // Final flush
    await this.flush();

    // Clear cache
    this.cache.clear();
  }
}
