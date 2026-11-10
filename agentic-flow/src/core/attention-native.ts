/**
 * Native Attention Wrappers
 *
 * Wraps the @ruvector/attention 2.x NAPI classes. Every 2.x kernel takes
 * `compute(query: Float32Array, keys: Float32Array[], values: Float32Array[])`
 * and returns one Float32Array; the constructors take positional sizes
 * (MultiHead, Flash, Linear, Hyperbolic) or a config object (MoE).
 *
 * Note: @ruvector/attention is optional - the classes throw a clear error
 * when it is missing; use attention-fallbacks.ts for the JS versions.
 */

import { nativeAttentionCpuCheck } from '../utils/native-cpu.js';

let nativeAttention: any = null;
let attentionAvailable = false;

try {
  // Skip the native load on arm64 CPUs its binary would SIGILL on (Pi 4).
  const cpu = nativeAttentionCpuCheck();
  if (!cpu.ok) throw new Error(cpu.reason);
  const mod: any = await import('@ruvector/attention');
  // The package is CommonJS; take the named exports, or the default object.
  nativeAttention = mod?.MultiHeadAttention ? mod : mod?.default;
  attentionAvailable = !!nativeAttention?.MultiHeadAttention;
} catch {
  console.warn('[attention-native] @ruvector/attention not available');
}

export { attentionAvailable };

export interface AttentionConfig {
  hiddenDim: number;
  numHeads?: number;
  dropoutRate?: number;
  useFlash?: boolean;
  /** FlashAttention tile size (default 64) */
  blockSize?: number;
  /** LinearAttention random-feature count (default hiddenDim) */
  numFeatures?: number;
  /** HyperbolicAttention curvature (default 1.0) */
  curvature?: number;
}

type Vec = number[] | Float32Array;

function toFloat32Array(input: Vec): Float32Array {
  return input instanceof Float32Array ? input : new Float32Array(input);
}

function toArray(input: Float32Array): number[] {
  return Array.from(input);
}

/** One vector, or a list of vectors, as a list of Float32Array rows. */
function toRows(input: Vec | Vec[]): Float32Array[] {
  const list = input as unknown[];
  if (list.length > 0 && (Array.isArray(list[0]) || list[0] instanceof Float32Array)) {
    return (input as Vec[]).map(toFloat32Array);
  }
  return [toFloat32Array(input as Vec)];
}

function requireNative(name: string): any {
  const ctor = nativeAttention?.[name];
  if (typeof ctor !== 'function') {
    throw new Error(`Failed to initialize native ${name}: @ruvector/attention is not installed`);
  }
  return ctor;
}

function checkDim(dim: number, rows: Float32Array[], what: string): void {
  for (const r of rows) {
    if (r.length !== dim) throw new Error(`${what} has dimension ${r.length}, expected ${dim}`);
  }
}

/**
 * Native Multi-Head Attention: one query attends over key/value rows.
 */
export class MultiHeadAttention {
  private nativeInstance: any;
  private hiddenDim: number;
  private numHeads: number;

  constructor(config: AttentionConfig) {
    this.hiddenDim = config.hiddenDim;
    this.numHeads = config.numHeads || 8;
    const Ctor = requireNative('MultiHeadAttention');
    try {
      this.nativeInstance = new Ctor(this.hiddenDim, this.numHeads);
    } catch (error: any) {
      throw new Error(`Failed to initialize native MultiHeadAttention: ${error.message}`);
    }
  }

  /**
   * @param query - one vector of hiddenDim
   * @param key - one key vector or a list of key rows
   * @param value - one value vector or a list of value rows (same count as keys)
   * @param mask - optional per-key mask (0 drops the key)
   */
  forward(query: Vec, key: Vec | Vec[], value: Vec | Vec[], mask?: Vec): { output: number[]; attentionWeights: number[][] } {
    try {
      const q = toFloat32Array(query);
      let k = toRows(key);
      let v = toRows(value);
      if (k.length !== v.length) throw new Error(`${k.length} keys but ${v.length} values`);
      if (mask) {
        const keep = k.map((_, i) => mask[i] !== 0);
        k = k.filter((_, i) => keep[i]);
        v = v.filter((_, i) => keep[i]);
        if (k.length === 0) return { output: new Array(this.hiddenDim).fill(0), attentionWeights: [[]] };
      }
      checkDim(this.hiddenDim, [q, ...k, ...v], 'input');
      const result: Float32Array = this.nativeInstance.compute(q, k, v);
      return {
        output: toArray(result),
        attentionWeights: [[]], // the native kernel does not return weights
      };
    } catch (error: any) {
      throw new Error(`MultiHeadAttention forward failed: ${error.message}`);
    }
  }

  get dim(): number {
    return this.nativeInstance.dim;
  }

  get headDim(): number {
    return this.nativeInstance.headDim;
  }
}

/** Shared batch form: every query row attends over the same key/value rows. */
function computeRows(instance: any, dim: number, query: Vec[] | Vec, key: Vec[] | Vec, value: Vec[] | Vec): number[][] {
  const q = toRows(query);
  const k = toRows(key);
  const v = toRows(value);
  if (k.length !== v.length) throw new Error(`${k.length} keys but ${v.length} values`);
  checkDim(dim, [...q, ...k, ...v], 'input');
  return q.map((row) => toArray(instance.compute(row, k, v)));
}

/**
 * Native Flash Attention (tiled, memory-efficient)
 */
export class FlashAttention {
  private nativeInstance: any;
  private hiddenDim: number;

  constructor(config: AttentionConfig) {
    this.hiddenDim = config.hiddenDim;
    const Ctor = requireNative('FlashAttention');
    try {
      this.nativeInstance = new Ctor(this.hiddenDim, config.blockSize ?? 64);
    } catch (error: any) {
      throw new Error(`Failed to initialize native FlashAttention: ${error.message}`);
    }
  }

  /**
   * @param query - query rows (or one query vector)
   * @param key - key rows
   * @param value - value rows
   * @param _numHeads - unused (flash attention here is single-head)
   */
  forward(query: Vec[] | Vec, key: Vec[] | Vec, value: Vec[] | Vec, _numHeads: number = 8): { output: number[][]; attentionScores: number[][] } {
    try {
      return { output: computeRows(this.nativeInstance, this.hiddenDim, query, key, value), attentionScores: [[]] };
    } catch (error: any) {
      throw new Error(`FlashAttention forward failed: ${error.message}`);
    }
  }
}

/**
 * Native Linear Attention: O(n) random-feature approximation
 */
export class LinearAttention {
  private nativeInstance: any;
  private hiddenDim: number;

  constructor(config: AttentionConfig) {
    this.hiddenDim = config.hiddenDim;
    const Ctor = requireNative('LinearAttention');
    try {
      this.nativeInstance = new Ctor(this.hiddenDim, config.numFeatures ?? this.hiddenDim);
    } catch (error: any) {
      throw new Error(`Failed to initialize native LinearAttention: ${error.message}`);
    }
  }

  forward(query: Vec[] | Vec, key: Vec[] | Vec, value: Vec[] | Vec): { output: number[][] } {
    try {
      return { output: computeRows(this.nativeInstance, this.hiddenDim, query, key, value) };
    } catch (error: any) {
      throw new Error(`LinearAttention forward failed: ${error.message}`);
    }
  }
}

/** Poincare-ball distance for curvature c > 0. */
function poincareDistance(a: Float32Array, b: Float32Array, c: number): number {
  let diff = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    diff += (a[i] - b[i]) ** 2;
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = (1 - c * na) * (1 - c * nb);
  if (denom <= 0) return Infinity; // a point on or outside the ball
  return Math.acosh(1 + (2 * c * diff) / denom) / Math.sqrt(c);
}

/**
 * Native Hyperbolic Attention (Poincare ball)
 */
export class HyperbolicAttention {
  private nativeInstance: any;
  private hiddenDim: number;
  private curvature: number;

  constructor(config: AttentionConfig) {
    this.hiddenDim = config.hiddenDim;
    this.curvature = config.curvature ?? 1.0;
    const Ctor = requireNative('HyperbolicAttention');
    try {
      this.nativeInstance = new Ctor(this.hiddenDim, this.curvature);
    } catch (error: any) {
      throw new Error(`Failed to initialize native HyperbolicAttention: ${error.message}`);
    }
  }

  /**
   * @returns output, and `distance`: the hyperbolic distance from the query
   *   to its nearest key
   */
  forward(query: Vec, key: Vec | Vec[], value: Vec | Vec[]): { output: number[]; distance: number } {
    try {
      const q = toFloat32Array(query);
      const k = toRows(key);
      const v = toRows(value);
      if (k.length !== v.length) throw new Error(`${k.length} keys but ${v.length} values`);
      checkDim(this.hiddenDim, [q, ...k, ...v], 'input');
      const result: Float32Array = this.nativeInstance.compute(q, k, v);
      const distance = Math.min(...k.map((row) => poincareDistance(q, row, this.curvature)));
      return { output: toArray(result), distance };
    } catch (error: any) {
      throw new Error(`HyperbolicAttention forward failed: ${error.message}`);
    }
  }
}

/**
 * Native MoE Attention: mixture of experts with top-k routing
 */
export class MoEAttention {
  private instances = new Map<number, any>();
  private hiddenDim: number;
  private numExperts: number;
  private Ctor: any;

  constructor(config: AttentionConfig & { numExperts?: number; topK?: number }) {
    this.hiddenDim = config.hiddenDim;
    this.numExperts = config.numExperts || 4;
    this.Ctor = requireNative('MoEAttention');
    try {
      this.instance(config.topK ?? 2);
    } catch (error: any) {
      throw new Error(`Failed to initialize native MoEAttention: ${error.message}`);
    }
  }

  /** The native kernel fixes topK at construction; keep one per topK. */
  private instance(topK: number): any {
    const k = Math.max(1, Math.min(Math.floor(topK), this.numExperts));
    let inst = this.instances.get(k);
    if (!inst) {
      inst = new this.Ctor({ dim: this.hiddenDim, numExperts: this.numExperts, topK: k });
      this.instances.set(k, inst);
    }
    return inst;
  }

  /**
   * @returns output; `expertWeights` is empty (the native kernel does not
   *   expose its routing weights)
   */
  forward(query: Vec, key: Vec | Vec[], value: Vec | Vec[], topK: number = 2): { output: number[]; expertWeights: number[] } {
    try {
      const q = toFloat32Array(query);
      const k = toRows(key);
      const v = toRows(value);
      if (k.length !== v.length) throw new Error(`${k.length} keys but ${v.length} values`);
      checkDim(this.hiddenDim, [q, ...k, ...v], 'input');
      const result: Float32Array = this.instance(topK).compute(q, k, v);
      return { output: toArray(result), expertWeights: [] };
    } catch (error: any) {
      throw new Error(`MoEAttention forward failed: ${error.message}`);
    }
  }
}

/**
 * Scaled Dot-Product Attention (pure JavaScript, always works)
 */
export function scaledDotProductAttention(
  query: number[],
  key: number[],
  value: number[],
  mask?: number[]
): { output: number[]; weights: number[] } {
  const dk = query.length;

  // Compute attention scores: Q · K^T / sqrt(dk)
  let score = 0;
  for (let i = 0; i < dk; i++) {
    score += query[i] * key[i];
  }
  score /= Math.sqrt(dk);

  // Apply mask if provided
  if (mask && mask[0] === 0) {
    score = -Infinity;
  }

  // Softmax (single score version)
  const expScore = Math.exp(score);
  const weight = expScore;

  // Weighted value
  const output = value.map(v => v * weight);

  return { output, weights: [weight] };
}

/**
 * Check if native attention is available
 */
export function isNativeAttentionAvailable(): boolean {
  try {
    const test = new nativeAttention.MultiHeadAttention(128, 4);
    return true;
  } catch {
    return false;
  }
}

/**
 * Factory function to create appropriate attention module
 */
export function createAttention(
  type: 'multi-head' | 'flash' | 'linear' | 'hyperbolic' | 'moe',
  config: AttentionConfig
): MultiHeadAttention | FlashAttention | LinearAttention | HyperbolicAttention | MoEAttention {
  switch (type) {
    case 'multi-head':
      return new MultiHeadAttention(config);
    case 'flash':
      return new FlashAttention(config);
    case 'linear':
      return new LinearAttention(config);
    case 'hyperbolic':
      return new HyperbolicAttention(config);
    case 'moe':
      return new MoEAttention(config);
    default:
      return new MultiHeadAttention(config);
  }
}
