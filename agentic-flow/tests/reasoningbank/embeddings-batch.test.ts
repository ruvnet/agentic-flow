/**
 * computeEmbeddingBatch must embed cache misses with batched pipeline calls,
 * not one pipeline call per text, and keep every row aligned with its input.
 * The transformers pipeline is replaced by a deterministic fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DIMS = 384;
const calls: string[][] = [];

function fakeVector(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  for (let i = 0; i < text.length; i++) v[(text.charCodeAt(i) * 31 + i) % DIMS] += 1;
  v[0] += text.length; // keeps every row distinct
  return v;
}

vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: async () => async (input: string | string[]) => {
    const texts = Array.isArray(input) ? input : [input];
    calls.push(texts);
    const data = new Float32Array(texts.length * DIMS);
    texts.forEach((t, i) => data.set(fakeVector(t), i * DIMS));
    return { data, dims: Array.isArray(input) ? [texts.length, DIMS] : [1, DIMS] };
  },
}));

const { computeEmbeddingBatch, computeEmbedding, clearEmbeddingCache, isSemanticEmbedding } =
  await import('../../src/reasoningbank/utils/embeddings.ts');

describe('computeEmbeddingBatch', () => {
  beforeEach(() => {
    clearEmbeddingCache();
    calls.length = 0;
  });

  it('embeds 256 texts in a handful of pipeline calls, rows aligned to inputs', async () => {
    const texts = Array.from({ length: 256 }, (_, i) => `text number ${i}`);
    const out = await computeEmbeddingBatch(texts);

    expect(out).toHaveLength(256);
    expect(calls.length).toBeLessThanOrEqual(16);
    expect(calls.flat()).toHaveLength(256);
    texts.forEach((t, i) => expect(Array.from(out[i])).toEqual(Array.from(fakeVector(t))));
    expect(isSemanticEmbedding()).toBe(true);
  });

  it('skips cached texts and embeds duplicates once', async () => {
    await computeEmbedding('already cached');
    calls.length = 0;

    const out = await computeEmbeddingBatch(['already cached', 'new', 'new', 'other']);

    expect(calls.flat().sort()).toEqual(['new', 'other']);
    expect(out[1]).toBe(out[2]);
    expect(Array.from(out[0])).toEqual(Array.from(fakeVector('already cached')));
  });
});
