/**
 * ONNX Embeddings WASM Integration
 *
 * Provides browser-compatible embeddings using ruvector-onnx-embeddings-wasm.
 *
 * Features:
 * - Pure WASM: No native dependencies, runs in browser
 * - all-MiniLM-L6-v2: 384-dimensional semantic embeddings
 * - SIMD Acceleration: Uses WebAssembly SIMD when available
 * - Small Bundle: Optimized WASM binary size
 *
 * Use Cases:
 * - Browser-based semantic search
 * - Client-side RAG applications
 * - Edge computing (Cloudflare Workers, Deno Deploy)
 * - Offline-first applications
 *
 * Performance:
 * - ~50ms per embedding (SIMD enabled)
 * - ~200ms per embedding (SIMD disabled)
 * - Batch processing: ~30ms per embedding
 */

import { logger } from '../utils/logger.js';

// Module state
let wasmModule: OnnxEmbeddingsModule | null = null;
let initialized = false;
let initPromise: Promise<boolean> | null = null;

/**
 * ONNX Embeddings WASM module interface
 */
interface OnnxEmbeddingsModule {
  // Core functions
  embed: (text: string) => Promise<Float32Array>;
  embedBatch: (texts: string[]) => Promise<Float32Array[]>;
  similarity: (text1: string, text2: string) => Promise<number>;
  cosineSimilarity: (a: Float32Array, b: Float32Array) => number;

  // Model management
  loadModel: (modelPath?: string) => Promise<void>;
  isModelLoaded: () => boolean;
  getModelInfo: () => ModelInfo;

  // Utilities
  isAvailable: () => boolean;
  isSIMDEnabled: () => boolean;
  getVersion: () => string;

  // Lifecycle
  initialize: () => Promise<void>;
  shutdown: () => Promise<void>;
}

interface ModelInfo {
  name: string;
  dimension: number;
  vocabSize: number;
  maxSequenceLength: number;
}

export interface OnnxEmbeddingResult {
  embedding: Float32Array;
  timeMs: number;
  source: 'wasm' | 'fallback';
}

export interface OnnxBatchResult {
  embeddings: Float32Array[];
  totalTimeMs: number;
  avgTimeMs: number;
  source: 'wasm' | 'fallback';
}

export interface OnnxEmbeddingsStats {
  available: boolean;
  simdEnabled: boolean;
  modelLoaded: boolean;
  modelInfo?: ModelInfo;
  totalEmbeddings: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

// Stats tracking
let stats = {
  totalEmbeddings: 0,
  totalLatencyMs: 0,
};

/**
 * Initialize ONNX Embeddings WASM module
 */
export async function initOnnxEmbeddingsWasm(): Promise<boolean> {
  if (initialized) return wasmModule !== null;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // The package's own exports are WasmEmbedder/cosineSimilarity and its
      // published glue cannot be import()ed directly; adapt the shared loader
      // to this module's interface.
      const { getOnnxWasmEmbedder, loadOnnxWasmModule } = await import('../integrations/onnx-wasm-embedder.js');
      const [mod, embedder] = await Promise.all([loadOnnxWasmModule(), getOnnxWasmEmbedder()]);
      if (!mod || !embedder) throw new Error('ruvector-onnx-embeddings-wasm or its model is unavailable');
      wasmModule = {
        embed: (text: string) => embedder.embed(text),
        embedBatch: (texts: string[]) => embedder.embedBatch(texts),
        similarity: async (a: string, b: string) =>
          mod.cosineSimilarity(await embedder.embed(a), await embedder.embed(b)),
        cosineSimilarity: (a: Float32Array, b: Float32Array) => mod.cosineSimilarity(a, b),
        loadModel: async () => {},
        isModelLoaded: () => true,
        getModelInfo: () => ({ name: 'all-MiniLM-L6-v2', dimension: embedder.dimension, vocabSize: 30522, maxSequenceLength: 256 }),
        isAvailable: () => true,
        isSIMDEnabled: () => Boolean((mod as any).simd_available?.()),
        getVersion: () => mod.version(),
        initialize: async () => {},
        shutdown: async () => {},
      };

      initialized = true;

      logger.info('ONNX Embeddings WASM initialized', {
        version: wasmModule.getVersion?.() || 'unknown',
        simd: wasmModule.isSIMDEnabled?.() ?? false,
        modelLoaded: wasmModule.isModelLoaded?.() ?? false,
      });

      return true;
    } catch (error) {
      logger.debug('ONNX Embeddings WASM not available', { error });
      initialized = true;
      return false;
    }
  })();

  return initPromise;
}

/**
 * Check if ONNX WASM embeddings are available
 */
export function isOnnxWasmAvailable(): boolean {
  return wasmModule !== null && (wasmModule.isAvailable?.() ?? false);
}

/**
 * Check if SIMD acceleration is enabled
 */
export function isSIMDEnabled(): boolean {
  return wasmModule?.isSIMDEnabled?.() ?? false;
}

/**
 * Generate embedding for text using WASM
 */
export async function embed(text: string): Promise<OnnxEmbeddingResult> {
  if (!initialized) {
    await initOnnxEmbeddingsWasm();
  }

  const startTime = performance.now();

  if (wasmModule && wasmModule.isModelLoaded?.()) {
    try {
      const embedding = await wasmModule.embed(text);
      const timeMs = performance.now() - startTime;

      stats.totalEmbeddings++;
      stats.totalLatencyMs += timeMs;

      return {
        embedding,
        timeMs,
        source: 'wasm',
      };
    } catch (error) {
      logger.warn('WASM embedding failed, using fallback', { error });
    }
  }

  // Fallback to simple hash-based embedding
  const embedding = simpleEmbed(text);
  const timeMs = performance.now() - startTime;

  stats.totalEmbeddings++;
  stats.totalLatencyMs += timeMs;

  return {
    embedding,
    timeMs,
    source: 'fallback',
  };
}

/**
 * Generate embeddings for multiple texts (batch processing)
 */
export async function embedBatch(texts: string[]): Promise<OnnxBatchResult> {
  if (!initialized) {
    await initOnnxEmbeddingsWasm();
  }

  const startTime = performance.now();

  if (wasmModule && wasmModule.embedBatch && wasmModule.isModelLoaded?.()) {
    try {
      const embeddings = await wasmModule.embedBatch(texts);
      const totalTimeMs = performance.now() - startTime;

      stats.totalEmbeddings += texts.length;
      stats.totalLatencyMs += totalTimeMs;

      return {
        embeddings,
        totalTimeMs,
        avgTimeMs: totalTimeMs / texts.length,
        source: 'wasm',
      };
    } catch (error) {
      logger.warn('WASM batch embedding failed, using fallback', { error });
    }
  }

  // Fallback to sequential simple embeddings
  const embeddings = texts.map((text) => simpleEmbed(text));
  const totalTimeMs = performance.now() - startTime;

  stats.totalEmbeddings += texts.length;
  stats.totalLatencyMs += totalTimeMs;

  return {
    embeddings,
    totalTimeMs,
    avgTimeMs: totalTimeMs / texts.length,
    source: 'fallback',
  };
}

/**
 * Compute similarity between two texts
 */
export async function similarity(text1: string, text2: string): Promise<number> {
  if (wasmModule && wasmModule.similarity) {
    try {
      return await wasmModule.similarity(text1, text2);
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback
  const [result1, result2] = await Promise.all([embed(text1), embed(text2)]);
  return cosineSimilarity(result1.embedding, result2.embedding);
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (wasmModule?.cosineSimilarity) {
    return wasmModule.cosineSimilarity(a, b);
  }

  // JS fallback
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Get embedding statistics
 */
export function getStats(): OnnxEmbeddingsStats {
  const modelInfo = wasmModule?.getModelInfo?.();

  return {
    available: isOnnxWasmAvailable(),
    simdEnabled: isSIMDEnabled(),
    modelLoaded: wasmModule?.isModelLoaded?.() ?? false,
    modelInfo,
    totalEmbeddings: stats.totalEmbeddings,
    totalLatencyMs: stats.totalLatencyMs,
    avgLatencyMs: stats.totalEmbeddings > 0 ? stats.totalLatencyMs / stats.totalEmbeddings : 0,
  };
}

/**
 * Shutdown WASM module
 */
export async function shutdown(): Promise<void> {
  if (wasmModule?.shutdown) {
    await wasmModule.shutdown();
  }
  wasmModule = null;
  initialized = false;
  initPromise = null;
}

/**
 * Reset stats (for testing)
 */
export function resetStats(): void {
  stats = { totalEmbeddings: 0, totalLatencyMs: 0 };
}

/**
 * Simple hash-based embedding fallback
 * Not semantic, but provides consistent embeddings for testing
 */
function simpleEmbed(text: string, dim: number = 384): Float32Array {
  const embedding = new Float32Array(dim);

  // Multi-pass hash for better distribution
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    embedding[i % dim] += code / 255;
    embedding[(i * 7) % dim] += (code * 0.3) / 255;
    embedding[(i * 13) % dim] += (code * 0.2) / 255;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) {
    embedding[i] /= norm;
  }

  return embedding;
}

/**
 * OnnxEmbeddingsWasm class for object-oriented usage
 */
export class OnnxEmbeddingsWasm {
  private initialized = false;

  async init(): Promise<boolean> {
    this.initialized = await initOnnxEmbeddingsWasm();
    return this.initialized;
  }

  async embed(text: string): Promise<OnnxEmbeddingResult> {
    if (!this.initialized) await this.init();
    return embed(text);
  }

  async embedBatch(texts: string[]): Promise<OnnxBatchResult> {
    if (!this.initialized) await this.init();
    return embedBatch(texts);
  }

  async similarity(text1: string, text2: string): Promise<number> {
    if (!this.initialized) await this.init();
    return similarity(text1, text2);
  }

  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    return cosineSimilarity(a, b);
  }

  isAvailable(): boolean {
    return isOnnxWasmAvailable();
  }

  isSIMDEnabled(): boolean {
    return isSIMDEnabled();
  }

  getStats(): OnnxEmbeddingsStats {
    return getStats();
  }

  async shutdown(): Promise<void> {
    await shutdown();
    this.initialized = false;
  }
}

// Singleton instance
let instance: OnnxEmbeddingsWasm | null = null;

/**
 * Get singleton OnnxEmbeddingsWasm instance
 */
export function getOnnxEmbeddingsWasm(): OnnxEmbeddingsWasm {
  if (!instance) {
    instance = new OnnxEmbeddingsWasm();
  }
  return instance;
}

export default {
  OnnxEmbeddingsWasm,
  getOnnxEmbeddingsWasm,
  initOnnxEmbeddingsWasm,
  isOnnxWasmAvailable,
  isSIMDEnabled,
  embed,
  embedBatch,
  similarity,
  cosineSimilarity,
  getStats,
  shutdown,
  resetStats,
};
