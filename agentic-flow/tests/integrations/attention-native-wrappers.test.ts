/**
 * src/core/attention-native.ts against the real @ruvector/attention 2.x.
 * Before 3.5.1 every class failed: FlashAttention(dim) / HyperbolicAttention(dim)
 * / MoEAttention(dim) did not construct (2.x needs a block size, a curvature,
 * and a config object), and MultiHead / Linear passed flat arrays where 2.x
 * takes key and value rows.
 */
import { describe, it, expect } from 'vitest';
import * as native from '../../src/core/attention-native.js';

const DIM = 16;
const vec = (seed: number) => Float32Array.from({ length: DIM }, (_, i) => Math.sin(seed * 7.1 + i) * 0.1);
const keys = [vec(1), vec(2), vec(3)];
const values = [vec(4), vec(5), vec(6)];

/** Softmax(q.k / sqrt(d)) weighted sum: what single-head attention must return. */
function reference(q: Float32Array, ks: Float32Array[], vs: Float32Array[]): number[] {
  const s = ks.map((k) => k.reduce((acc, x, i) => acc + x * q[i], 0) / Math.sqrt(DIM));
  const m = Math.max(...s);
  const e = s.map((x) => Math.exp(x - m));
  const z = e.reduce((a, b) => a + b, 0);
  return Array.from({ length: DIM }, (_, i) => vs.reduce((acc, v, j) => acc + (e[j] / z) * v[i], 0));
}

function finite(out: number[]): void {
  expect(out).toHaveLength(DIM);
  for (const x of out) expect(Number.isFinite(x)).toBe(true);
}

describe('attention-native on @ruvector/attention 2.x', () => {
  it('loads the native package', () => {
    expect(native.attentionAvailable).toBe(true);
    expect(native.isNativeAttentionAvailable()).toBe(true);
  });

  it('MultiHeadAttention: one query over key/value rows', () => {
    const a = new native.MultiHeadAttention({ hiddenDim: DIM, numHeads: 4 });
    const { output } = a.forward(vec(0), keys, values);
    finite(output);
    expect(a.dim).toBe(DIM);
    // a single key: the output is a function of that one value row
    const one = a.forward(vec(0), keys[0], values[0]).output;
    finite(one);
    // mask drops keys: masking all but the first equals attending to the first alone
    const masked = a.forward(vec(0), keys, values, [1, 0, 0]).output;
    masked.forEach((x, i) => expect(x).toBeCloseTo(one[i], 5));
  });

  it('FlashAttention matches exact single-head attention', () => {
    const a = new native.FlashAttention({ hiddenDim: DIM, blockSize: 2 });
    const q = [vec(0), vec(9)];
    const { output } = a.forward(q, keys, values);
    expect(output).toHaveLength(2);
    output.forEach((row, r) => {
      const ref = reference(q[r], keys, values);
      row.forEach((x, i) => expect(x).toBeCloseTo(ref[i], 4));
    });
  });

  it('LinearAttention returns one row per query', () => {
    const a = new native.LinearAttention({ hiddenDim: DIM });
    const { output } = a.forward([vec(0), vec(1)], keys, values);
    expect(output).toHaveLength(2);
    output.forEach(finite);
  });

  it('HyperbolicAttention returns output and a finite distance', () => {
    const a = new native.HyperbolicAttention({ hiddenDim: DIM, curvature: 1 });
    const { output, distance } = a.forward(vec(0), keys, values);
    finite(output);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(0);
  });

  it('MoEAttention constructs from hiddenDim and honours topK', () => {
    const a = new native.MoEAttention({ hiddenDim: DIM, numExperts: 4 });
    finite(a.forward(vec(0), keys, values).output);
    finite(a.forward(vec(0), keys, values, 1).output);
  });

  it('createAttention builds every kind', () => {
    for (const t of ['multi-head', 'flash', 'linear', 'hyperbolic', 'moe'] as const) {
      expect(native.createAttention(t, { hiddenDim: DIM, numHeads: 4 })).toBeTruthy();
    }
  });

  it('rejects a wrong dimension with a clear error', () => {
    const a = new native.MultiHeadAttention({ hiddenDim: DIM, numHeads: 4 });
    expect(() => a.forward(new Float32Array(8), keys, values)).toThrow(/dimension 8, expected 16/);
  });
});
