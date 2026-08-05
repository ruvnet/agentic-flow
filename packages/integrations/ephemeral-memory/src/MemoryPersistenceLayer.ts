/**
 * MemoryPersistenceLayer - Interface to AgentDB for persistent storage
 *
 * Features:
 * - Namespace memory by agent type and session
 * - Memory consolidation (deduplicate similar memories)
 * - Semantic search for relevant past memories
 * - Tenant isolation
 */

import Database from 'better-sqlite3';
import { Memory, MemorySearchResult } from './types.js';

export interface MemoryPersistenceConfig {
  dbPath?: string;
  namespace?: string;
  tenantId: string;
  enableConsolidation?: boolean;
  similarityThreshold?: number;
}

export class MemoryPersistenceLayer {
  private db: Database.Database;
  private config: MemoryPersistenceConfig;
  private embeddings: Map<string, number[]>;

  constructor(config: MemoryPersistenceConfig) {
    this.config = {
      dbPath: ':memory:',
      namespace: 'default',
      enableConsolidation: true,
      similarityThreshold: 0.95,
      ...config
    };

    this.db = new Database(this.config.dbPath || ':memory:');
    this.embeddings = new Map();
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        namespace TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        PRIMARY KEY (key, namespace, tenant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_tenant ON memories(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace, tenant_id);
      CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, tenant_id);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        key TEXT NOT NULL,
        namespace TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        PRIMARY KEY (key, namespace, tenant_id),
        FOREIGN KEY (key, namespace, tenant_id)
          REFERENCES memories(key, namespace, tenant_id)
          ON DELETE CASCADE
      );
    `);
  }

  /**
   * Store memory with automatic embedding generation
   */
  async setMemory(agentId: string, key: string, value: any): Promise<void> {
    const now = Date.now();
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    // Serialize value
    const serialized = JSON.stringify(value);

    // Check for consolidation
    if (this.config.enableConsolidation) {
      const similar = await this.findSimilarMemory(key, serialized);
      if (similar) {
        // Update existing similar memory instead of creating new one
        key = similar.key;
      }
    }

    // Insert or update memory
    const stmt = this.db.prepare(`
      INSERT INTO memories (key, value, namespace, agent_id, tenant_id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key, namespace, tenant_id)
      DO UPDATE SET
        value = excluded.value,
        agent_id = excluded.agent_id,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      key,
      serialized,
      namespace,
      agentId,
      tenantId,
      now,
      now,
      JSON.stringify({})
    );

    // Generate and store embedding for semantic search
    await this.generateAndStoreEmbedding(key, serialized);
  }

  /**
   * Retrieve memory by key
   */
  async getMemory(key: string): Promise<any | null> {
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    const stmt = this.db.prepare(`
      SELECT value FROM memories
      WHERE key = ? AND namespace = ? AND tenant_id = ?
    `);

    const row = stmt.get(key, namespace, tenantId) as { value: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  /**
   * Search memories by semantic similarity
   */
  async searchMemories(query: string, k: number = 5): Promise<MemorySearchResult[]> {
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Get all memories with embeddings
    const stmt = this.db.prepare(`
      SELECT m.key, m.value, e.embedding
      FROM memories m
      JOIN memory_embeddings e ON
        m.key = e.key AND
        m.namespace = e.namespace AND
        m.tenant_id = e.tenant_id
      WHERE m.namespace = ? AND m.tenant_id = ?
      ORDER BY m.updated_at DESC
      LIMIT 1000
    `);

    const rows = stmt.all(namespace, tenantId) as Array<{
      key: string;
      value: string;
      embedding: Buffer;
    }>;

    // Calculate cosine similarity for each memory
    const results: MemorySearchResult[] = [];

    for (const row of rows) {
      const embedding = this.deserializeEmbedding(row.embedding);
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);

      if (similarity > 0.5) { // Threshold for relevance
        results.push({
          key: row.key,
          value: JSON.parse(row.value),
          similarity
        });
      }
    }

    // Sort by similarity and return top k
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  /**
   * Get all memories for an agent
   */
  async getAgentMemories(agentId: string): Promise<Memory[]> {
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE agent_id = ? AND namespace = ? AND tenant_id = ?
      ORDER BY updated_at DESC
    `);

    const rows = stmt.all(agentId, namespace, tenantId) as Array<{
      key: string;
      value: string;
      namespace: string;
      agent_id: string;
      tenant_id: string;
      created_at: number;
      updated_at: number;
      metadata: string;
    }>;

    return rows.map(row => ({
      key: row.key,
      value: JSON.parse(row.value),
      namespace: row.namespace,
      agentId: row.agent_id,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata || '{}')
    }));
  }

  /**
   * Delete memory by key
   */
  async deleteMemory(key: string): Promise<void> {
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    const stmt = this.db.prepare(`
      DELETE FROM memories
      WHERE key = ? AND namespace = ? AND tenant_id = ?
    `);

    stmt.run(key, namespace, tenantId);
  }

  /**
   * Delete all memories for an agent
   */
  async deleteAgentMemories(agentId: string): Promise<void> {
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    const stmt = this.db.prepare(`
      DELETE FROM memories
      WHERE agent_id = ? AND namespace = ? AND tenant_id = ?
    `);

    stmt.run(agentId, namespace, tenantId);
  }

  /**
   * Consolidate similar memories to reduce duplication
   */
  async consolidate(): Promise<number> {
    if (!this.config.enableConsolidation) {
      return 0;
    }

    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    // Get all memories with embeddings
    const stmt = this.db.prepare(`
      SELECT m.key, m.value, e.embedding
      FROM memories m
      JOIN memory_embeddings e ON
        m.key = e.key AND
        m.namespace = e.namespace AND
        m.tenant_id = e.tenant_id
      WHERE m.namespace = ? AND m.tenant_id = ?
    `);

    const rows = stmt.all(namespace, tenantId) as Array<{
      key: string;
      value: string;
      embedding: Buffer;
    }>;

    let consolidated = 0;
    const seen = new Set<string>();

    // Find and merge similar memories
    for (let i = 0; i < rows.length; i++) {
      if (seen.has(rows[i].key)) continue;

      const emb1 = this.deserializeEmbedding(rows[i].embedding);

      for (let j = i + 1; j < rows.length; j++) {
        if (seen.has(rows[j].key)) continue;

        const emb2 = this.deserializeEmbedding(rows[j].embedding);
        const similarity = this.cosineSimilarity(emb1, emb2);

        if (similarity >= (this.config.similarityThreshold || 0.95)) {
          // Merge j into i (keep most recent value)
          await this.deleteMemory(rows[j].key);
          seen.add(rows[j].key);
          consolidated++;
        }
      }

      seen.add(rows[i].key);
    }

    return consolidated;
  }

  /**
   * Generate embedding for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Simple hash-based embedding for demo
    // In production, use @xenova/transformers or external API
    const hash = this.simpleHash(text);
    const embedding = new Array(384).fill(0);

    for (let i = 0; i < 384; i++) {
      embedding[i] = Math.sin(hash * (i + 1)) * 0.5 + 0.5;
    }

    return embedding;
  }

  /**
   * Generate and store embedding for a memory
   */
  private async generateAndStoreEmbedding(key: string, value: string): Promise<void> {
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    const embedding = await this.generateEmbedding(value);
    const serialized = this.serializeEmbedding(embedding);

    const stmt = this.db.prepare(`
      INSERT INTO memory_embeddings (key, namespace, tenant_id, embedding)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key, namespace, tenant_id)
      DO UPDATE SET embedding = excluded.embedding
    `);

    stmt.run(key, namespace, tenantId, serialized);
  }

  /**
   * Find similar memory by content
   */
  private async findSimilarMemory(key: string, value: string): Promise<{ key: string } | null> {
    const results = await this.searchMemories(value, 1);

    if (results.length > 0 && results[0].similarity >= (this.config.similarityThreshold || 0.95)) {
      return { key: results[0].key };
    }

    return null;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

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

  /**
   * Serialize embedding to buffer
   */
  private serializeEmbedding(embedding: number[]): Buffer {
    const buffer = Buffer.allocUnsafe(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }
    return buffer;
  }

  /**
   * Deserialize embedding from buffer
   */
  private deserializeEmbedding(buffer: Buffer): number[] {
    const embedding = new Array(buffer.length / 4);
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] = buffer.readFloatLE(i * 4);
    }
    return embedding;
  }

  /**
   * Simple hash function for demo purposes
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Get statistics about memory usage
   */
  getStats(): {
    totalMemories: number;
    totalSize: number;
    oldestMemory: number;
    newestMemory: number;
  } {
    const namespace = this.config.namespace || 'default';
    const tenantId = this.config.tenantId;

    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(LENGTH(value)) as size,
        MIN(created_at) as oldest,
        MAX(updated_at) as newest
      FROM memories
      WHERE namespace = ? AND tenant_id = ?
    `);

    const row = stmt.get(namespace, tenantId) as {
      total: number;
      size: number;
      oldest: number;
      newest: number;
    };

    return {
      totalMemories: row.total,
      totalSize: row.size,
      oldestMemory: row.oldest,
      newestMemory: row.newest
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
