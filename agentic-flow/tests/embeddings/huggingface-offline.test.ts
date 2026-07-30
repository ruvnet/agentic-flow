import { describe, expect, it } from 'vitest';

describe('@huggingface/transformers packaging', () => {
  it('loads its embedding API with remote models disabled', async () => {
    const transformers = await import('@huggingface/transformers');
    transformers.env.allowRemoteModels = false;
    expect(transformers.env.allowRemoteModels).toBe(false);
    expect(typeof transformers.pipeline).toBe('function');
  });
});
