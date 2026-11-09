/**
 * AgentDB-ONNX - High-Performance AI Agent Memory with ONNX Embeddings
 *
 * 100% local, GPU-accelerated embeddings with AgentDB vector storage
 */

import { createDatabase, ReasoningBank, ReflexionMemory, type EmbeddingService } from 'agentdb';
import { ONNXEmbeddingService } from './services/ONNXEmbeddingService.js';

export { ONNXEmbeddingService } from './services/ONNXEmbeddingService.js';

export type {
  ONNXConfig,
  EmbeddingResult,
  BatchEmbeddingResult
} from './services/ONNXEmbeddingService.js';

/**
 * Adapter to make ONNXEmbeddingService compatible with AgentDB's EmbeddingService interface
 */
class ONNXEmbeddingAdapter implements Partial<EmbeddingService> {
  constructor(private onnxService: ONNXEmbeddingService) {}

  async embed(text: string): Promise<Float32Array> {
    const result = await this.onnxService.embed(text);
    return result.embedding;
  }

  getDimension(): number {
    return this.onnxService.getDimension();
  }

  // AgentDB-compatible embedBatch
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const result = await this.onnxService.embedBatch(texts);
    return result.embeddings;
  }

  // agentdb 3.x controllers embed by role (query vs passage). The MiniLM/BGE
  // feature-extraction pipelines used here have no role templates, so both
  // roles map to the same embedding.
  embedQuery(text: string): Promise<Float32Array> {
    return this.embed(text);
  }

  embedPassage(text: string): Promise<Float32Array> {
    return this.embed(text);
  }

  embedFor(_role: string, text: string): Promise<Float32Array> {
    return this.embed(text);
  }

  embedQueryBatch(texts: string[]): Promise<Float32Array[]> {
    return this.embedBatch(texts);
  }

  embedPassageBatch(texts: string[]): Promise<Float32Array[]> {
    return this.embedBatch(texts);
  }

  clearCache(): void {
    this.onnxService.clearCache();
  }

  // Expose ONNX-specific methods directly on the service
  get onnx() {
    return this.onnxService;
  }
}

/**
 * Create optimized AgentDB with ONNX embeddings
 */
export async function createONNXAgentDB(config: {
  dbPath: string;
  modelName?: string;
  useGPU?: boolean;
  batchSize?: number;
  cacheSize?: number;
}) {
  // Initialize ONNX embedder
  const onnxEmbedder = new ONNXEmbeddingService({
    modelName: config.modelName || 'Xenova/all-MiniLM-L6-v2',
    useGPU: config.useGPU ?? true,
    batchSize: config.batchSize || 32,
    cacheSize: config.cacheSize || 10000
  });

  await onnxEmbedder.initialize();
  await onnxEmbedder.warmup();

  // Create adapter for AgentDB compatibility
  const embedder = new ONNXEmbeddingAdapter(onnxEmbedder);

  // Create database
  const db = await createDatabase(config.dbPath);

  // Initialize schema for ReflexionMemory (episodes table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER DEFAULT (strftime('%s', 'now')),
      session_id TEXT NOT NULL,
      task TEXT NOT NULL,
      input TEXT,
      output TEXT,
      critique TEXT,
      reward REAL NOT NULL,
      success INTEGER NOT NULL,
      latency_ms INTEGER,
      tokens_used INTEGER,
      tags TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task);
    CREATE INDEX IF NOT EXISTS idx_episodes_reward ON episodes(reward);
    CREATE INDEX IF NOT EXISTS idx_episodes_success ON episodes(success);

    CREATE TABLE IF NOT EXISTS episode_embeddings (
      episode_id INTEGER PRIMARY KEY,
      embedding BLOB NOT NULL,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
    );
  `);

  // Create AgentDB controllers with ONNX embeddings
  const reasoningBank = new ReasoningBank(db, embedder as any);
  const reflexionMemory = new ReflexionMemory(db, embedder as any);

  return {
    db,
    embedder: onnxEmbedder,  // Return the raw ONNX service for advanced usage
    reasoningBank,
    reflexionMemory,

    async close() {
      onnxEmbedder.clearCache();
      // agentdb 3.x: persistent backends flush on closeAsync(); sql.js has close()
      if (typeof db.closeAsync === 'function') {
        await db.closeAsync();
      } else {
        db.close();
      }
    },

    getStats() {
      return {
        embedder: onnxEmbedder.getStats(),
        // Database stats are not available in sql.js wrapper
        database: {
          type: 'sql.js',
          path: config.dbPath
        }
      };
    }
  };
}
