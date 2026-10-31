/**
 * Issue #246: a failed model load used to reset the init promise, so the next
 * call retried. One process could then embed some texts with the hash fallback
 * and later ones with the model, and compare vectors from the two spaces.
 *
 * The space is now fixed by the first embedding and only changes through
 * resetEmbeddingBackend(). The transformers pipeline is a fake whose first
 * load fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DIMS = 384;
let loads = 0;
let failLoads = 0;
let failGeneration = false;

function fakeVector(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  for (let i = 0; i < text.length; i++) v[(text.charCodeAt(i) * 31 + i) % DIMS] += 1;
  v[0] += text.length;
  return v;
}

vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: async () => {
    loads++;
    if (failLoads > 0) {
      failLoads--;
      throw new Error('model download failed');
    }
    return async (input: string | string[]) => {
      if (failGeneration) throw new Error('inference failed');
      const texts = Array.isArray(input) ? input : [input];
      const data = new Float32Array(texts.length * DIMS);
      texts.forEach((t, i) => data.set(fakeVector(t), i * DIMS));
      return { data, dims: [texts.length, DIMS] };
    };
  },
}));

const emb = await import('../../src/reasoningbank/utils/embeddings.ts');

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

describe('embedding space is fixed for the life of the process (#246)', () => {
  beforeEach(() => {
    emb.resetEmbeddingBackend?.();
    loads = 0;
    failLoads = 0;
    failGeneration = false;
  });

  it('after a failed first load, later embeddings stay in the hash space', async () => {
    failLoads = 1; // first load fails, any later load would succeed

    const before = await emb.computeEmbedding('the same text');
    expect(emb.isSemanticEmbedding()).toBe(false);

    // Another text, then the cache is dropped and the first text re-embedded.
    await emb.computeEmbedding('another text');
    emb.clearEmbeddingCache();
    const after = await emb.computeEmbedding('the same text');

    expect(cosine(before, after)).toBeCloseTo(1, 6);
    expect(loads).toBe(1); // no silent retry of the model
    expect(emb.isSemanticEmbedding()).toBe(false);
    expect(emb.getEmbeddingKind()).toBe('hash');

    const batch = await emb.computeEmbeddingBatch(['the same text', 'third']);
    expect(cosine(batch[0], before)).toBeCloseTo(1, 6);
    expect(loads).toBe(1);
  });

  it('resetEmbeddingBackend() retries the model and clears the cache', async () => {
    failLoads = 1;
    const hashVec = await emb.computeEmbedding('retry me');
    expect(emb.getEmbeddingKind()).toBe('hash');

    emb.resetEmbeddingBackend();
    expect(emb.getEmbeddingKind()).toBe(null);

    const modelVec = await emb.computeEmbedding('retry me');
    expect(loads).toBe(2);
    expect(emb.isSemanticEmbedding()).toBe(true);
    expect(emb.getEmbeddingKind()).toBe('local');
    // A cached hash vector must not survive the reset.
    expect(Array.from(modelVec)).toEqual(Array.from(fakeVector('retry me')));
    expect(cosine(hashVec, modelVec)).toBeLessThan(0.99);
  });

  it('a model failure after model vectors were produced is an error, not a hash vector', async () => {
    await emb.computeEmbedding('first');
    expect(emb.getEmbeddingKind()).toBe('local');

    failGeneration = true;
    await expect(emb.computeEmbedding('second')).rejects.toThrow(/not substituting a hash vector/);
    await expect(emb.computeEmbeddingBatch(['third', 'fourth'])).rejects.toThrow(/not substituting a hash vector/);
    expect(emb.isSemanticEmbedding()).toBe(true);
    expect(emb.getEmbeddingKind()).toBe('local');
  });
});
