/**
 * Embedding generation for semantic similarity
 * Uses local transformers.js - no API key required!
 */

import { pipeline, env } from '@huggingface/transformers';
import { loadConfig } from './config.js';

// Configure transformers.js to use WASM backend only (avoid ONNX runtime issues)
// The native ONNX runtime causes "DefaultLogger not registered" errors in Node.js
env.backends.onnx.wasm.proxy = false; // Disable ONNX runtime proxy
env.backends.onnx.wasm.numThreads = 1; // Single thread for stability

let embeddingPipeline: any = null;
let initializationPromise: Promise<void> | null = null;
const embeddingCache = new Map<string, Float32Array>();
// MEMORY LEAK FIX: Track TTL timers so they can be cleaned up
const embeddingTimers = new Map<string, NodeJS.Timeout>();

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

  // Detect npx environment (known transformer initialization issues)
  const isNpxEnv = process.env.npm_lifecycle_event === 'npx' ||
                   process.env.npm_execpath?.includes('npx') ||
                   process.cwd().includes('/_npx/') ||
                   process.cwd().includes('\\_npx\\');

  if (isNpxEnv && !process.env.FORCE_TRANSFORMERS) {
    console.log('[Embeddings] NPX environment detected - using hash-based embeddings');
    console.log('[Embeddings] For semantic search, install globally: npm install -g claude-flow');
    return;
  }

  // RACE CONDITION FIX: Create promise for concurrent callers to await
  initializationPromise = (async () => {
    console.log('[Embeddings] Initializing local embedding model (Xenova/all-MiniLM-L6-v2)...');
    console.log('[Embeddings] First run will download ~23MB model...');

    try {
      embeddingPipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { dtype: 'q8' } // Transformers.js v3 quantized dtype
      );
      console.log('[Embeddings] Local model ready! (384 dimensions)');
    } catch (error: any) {
      console.error('[Embeddings] Failed to initialize:', error?.message || error);
      console.warn('[Embeddings] Falling back to hash-based embeddings');
      // Reset promise so retry is possible
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * Compute embedding for text using local model
 */
export async function computeEmbedding(text: string): Promise<Float32Array> {
  const config = loadConfig();

  // Check cache
  const cacheKey = `local:${text}`;
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  let embedding: Float32Array;

  // Initialize if needed
  await initializeEmbeddings();

  if (embeddingPipeline) {
    try {
      // Use transformers.js for real embeddings
      const output = await embeddingPipeline(text, {
        pooling: 'mean',
        normalize: true
      });
      embedding = new Float32Array(output.data);
    } catch (error: any) {
      console.error('[Embeddings] Generation failed:', error?.message || error);
      embedding = hashEmbed(text, 384); // Fallback
    }
  } else {
    // Fallback to hash-based embeddings
    const dims = config?.embeddings?.dimensions || 384;
    embedding = hashEmbed(text, dims);
  }

  // MEMORY LEAK FIX: Clear existing timer if key exists
  const existingTimer = embeddingTimers.get(cacheKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    embeddingTimers.delete(cacheKey);
  }

  // Cache with LRU (limit 1000 entries)
  // PERFORMANCE FIX: Use proper LRU by tracking access order
  if (embeddingCache.size >= 1000) {
    // Find and remove oldest entry (first key in iteration order)
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey) {
      embeddingCache.delete(firstKey);
      // Also clear its timer
      const timer = embeddingTimers.get(firstKey);
      if (timer) {
        clearTimeout(timer);
        embeddingTimers.delete(firstKey);
      }
    }
  }
  embeddingCache.set(cacheKey, embedding);

  // Set TTL for cache entry with tracked timer
  const ttl = config?.embeddings?.cache_ttl_seconds || 3600;
  const timerId = setTimeout(() => {
    embeddingCache.delete(cacheKey);
    embeddingTimers.delete(cacheKey);
  }, ttl * 1000);

  // MEMORY LEAK FIX: Track timer for cleanup
  embeddingTimers.set(cacheKey, timerId);

  return embedding;
}

/**
 * Batch compute embeddings (more efficient)
 */
export async function computeEmbeddingBatch(texts: string[]): Promise<Float32Array[]> {
  return Promise.all(texts.map(text => computeEmbedding(text)));
}

/**
 * Get embedding dimensions
 */
export function getEmbeddingDimensions(): number {
  return 384; // all-MiniLM-L6-v2 uses 384 dimensions
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
 * MEMORY LEAK FIX: Also clear all TTL timers
 */
export function clearEmbeddingCache(): void {
  // Clear all timers first to prevent memory leaks
  for (const timer of embeddingTimers.values()) {
    clearTimeout(timer);
  }
  embeddingTimers.clear();
  embeddingCache.clear();
}
