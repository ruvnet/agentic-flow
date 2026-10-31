/**
 * Embedding generation for semantic similarity
 * Uses local transformers.js - no API key required!
 *
 * Logs go to stderr so that stdout stays clean for callers that pipe
 * structured output (CLIs, MCP stdio servers).
 */

import { pipeline, env } from '@huggingface/transformers';
import { loadConfig } from './config.js';

// Configure transformers.js to use WASM backend only (avoid ONNX runtime issues)
// The native ONNX runtime causes "DefaultLogger not registered" errors in Node.js
env.backends.onnx.wasm.proxy = false; // Disable ONNX runtime proxy
env.backends.onnx.wasm.numThreads = 1; // Single thread for stability

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_DIMS = 384;
const CACHE_MAX_ENTRIES = 1000;
// Texts per pipeline call in computeEmbeddingBatch. Bounds padding waste and
// peak memory when a batch mixes short and long texts.
//
// The q8 model quantizes activations dynamically with one scale per tensor, so
// a batched vector depends slightly on its batch-mates: cosine vs. the same
// text embedded alone is ~0.99 (min ~0.985 measured). fp32 weights are exact
// but slower for single texts and change every stored vector.
const BATCH_CHUNK_SIZE = 32;

let embeddingPipeline: any = null;
let initializationPromise: Promise<void> | null = null;

/**
 * LRU cache with lazy TTL expiry. No timers: an expired entry is dropped when
 * it is next read, so the cache never keeps the event loop alive.
 */
interface CacheEntry {
  vector: Float32Array;
  expiresAt: number;
}
const embeddingCache = new Map<string, CacheEntry>();

function cacheGet(key: string): Float32Array | undefined {
  const entry = embeddingCache.get(key);
  if (!entry) return undefined;
  embeddingCache.delete(key);
  if (entry.expiresAt <= Date.now()) return undefined;
  embeddingCache.set(key, entry); // move to most-recently-used
  return entry.vector;
}

function cacheSet(key: string, vector: Float32Array, ttlSeconds: number): void {
  embeddingCache.delete(key);
  embeddingCache.set(key, { vector, expiresAt: Date.now() + ttlSeconds * 1000 });
  while (embeddingCache.size > CACHE_MAX_ENTRIES) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest === undefined) break;
    embeddingCache.delete(oldest);
  }
}

function cacheTtlSeconds(): number {
  return loadConfig()?.embeddings?.cache_ttl_seconds || 3600;
}

/**
 * Initialize the embedding pipeline (lazy load)
 * RACE CONDITION FIX: Use promise-based initialization instead of busy-wait
 */
async function initializeEmbeddings(): Promise<void> {
  // Already initialized
  if (embeddingPipeline) return;

  // Initialization in progress - await existing promise
  if (initializationPromise) {
    return initializationPromise;
  }

  // RACE CONDITION FIX: Create promise for concurrent callers to await
  initializationPromise = (async () => {
    console.error(`[Embeddings] Initializing local embedding model (${MODEL_ID})...`);
    console.error('[Embeddings] First run will download ~23MB model...');

    try {
      embeddingPipeline = await pipeline(
        'feature-extraction',
        MODEL_ID,
        { dtype: 'q8' } // quantized weights
      );
      console.error(`[Embeddings] Local model ready! (${MODEL_DIMS} dimensions)`);
    } catch (error: any) {
      console.error('[Embeddings] Failed to initialize:', error?.message || error);
      console.error('[Embeddings] Falling back to hash-based embeddings (not semantic)');
      // Reset promise so retry is possible
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * True when embeddings come from the transformer model; false when they come
 * from the deterministic hash fallback, whose vectors carry no semantic
 * similarity. Returns false until the first embedding call has initialized the
 * model.
 */
export function isSemanticEmbedding(): boolean {
  return embeddingPipeline !== null;
}

/**
 * Compute embedding for text using local model
 */
export async function computeEmbedding(text: string): Promise<Float32Array> {
  const cached = cacheGet(`local:${text}`) ?? cacheGet(`hash:${text}`);
  if (cached) return cached;

  // Initialize if needed
  await initializeEmbeddings();

  let embedding: Float32Array;
  let kind: 'local' | 'hash' = 'local';

  if (embeddingPipeline) {
    try {
      const output = await embeddingPipeline(text, {
        pooling: 'mean',
        normalize: true
      });
      embedding = new Float32Array(output.data);
    } catch (error: any) {
      console.error('[Embeddings] Generation failed:', error?.message || error);
      embedding = hashEmbed(text, MODEL_DIMS);
      kind = 'hash';
    }
  } else {
    const dims = loadConfig()?.embeddings?.dimensions || MODEL_DIMS;
    embedding = hashEmbed(text, dims);
    kind = 'hash';
  }

  cacheSet(`${kind}:${text}`, embedding, cacheTtlSeconds());
  return embedding;
}

/**
 * Batch compute embeddings. Cache misses are embedded with one pipeline call
 * per chunk of texts rather than one call per text.
 */
export async function computeEmbeddingBatch(texts: string[]): Promise<Float32Array[]> {
  await initializeEmbeddings();
  if (!embeddingPipeline) {
    return Promise.all(texts.map(text => computeEmbedding(text)));
  }

  const results: Float32Array[] = new Array(texts.length);
  const missing = new Map<string, number[]>(); // text -> result indices

  texts.forEach((text, i) => {
    const cached = cacheGet(`local:${text}`);
    if (cached) {
      results[i] = cached;
      return;
    }
    const indices = missing.get(text);
    if (indices) indices.push(i);
    else missing.set(text, [i]);
  });

  const ttl = cacheTtlSeconds();
  const uniqueTexts = Array.from(missing.keys());

  for (let start = 0; start < uniqueTexts.length; start += BATCH_CHUNK_SIZE) {
    const chunk = uniqueTexts.slice(start, start + BATCH_CHUNK_SIZE);
    let vectors: Float32Array[];
    let kind: 'local' | 'hash' = 'local';

    try {
      const output = await embeddingPipeline(chunk, { pooling: 'mean', normalize: true });
      const dims = output.dims[output.dims.length - 1];
      const data = output.data as Float32Array;
      vectors = chunk.map((_, j) => new Float32Array(data.subarray(j * dims, (j + 1) * dims)));
    } catch (error: any) {
      console.error('[Embeddings] Batch generation failed:', error?.message || error);
      vectors = chunk.map(text => hashEmbed(text, MODEL_DIMS));
      kind = 'hash';
    }

    chunk.forEach((text, j) => {
      cacheSet(`${kind}:${text}`, vectors[j], ttl);
      for (const i of missing.get(text)!) results[i] = vectors[j];
    });
  }

  return results;
}

/**
 * Get embedding dimensions
 */
export function getEmbeddingDimensions(): number {
  return MODEL_DIMS; // all-MiniLM-L6-v2 uses 384 dimensions
}

/**
 * Deterministic hash-based embedding (fallback)
 */
function hashEmbed(text: string, dims: number): Float32Array {
  const hash = simpleHash(text);
  const vec = new Float32Array(dims);

  // Generate deterministic pseudo-random vector from hash
  for (let i = 0; i < dims; i++) {
    vec[i] = Math.sin(hash * (i + 1) * 0.01) + Math.cos(hash * i * 0.02);
  }

  return normalize(vec);
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Normalize vector to unit length
 */
function normalize(vec: Float32Array): Float32Array {
  let mag = 0;
  for (let i = 0; i < vec.length; i++) {
    mag += vec[i] * vec[i];
  }
  mag = Math.sqrt(mag);

  if (mag === 0) return vec;

  for (let i = 0; i < vec.length; i++) {
    vec[i] /= mag;
  }
  return vec;
}

/**
 * Clear embedding cache
 */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}
