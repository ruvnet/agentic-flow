/**
 * Attention Module Fallbacks
 *
 * Since @ruvector/attention is completely broken, provide JavaScript fallbacks
 * Performance will be slower but functionality will work
 */

import { nativeAttentionCpuCheck } from '../utils/native-cpu.js';

export interface AttentionConfig {
  hiddenDim: number;
  numHeads?: number;
  dropoutRate?: number;
  useFlash?: boolean;
}

/**
 * Scaled Dot-Product Attention
 * The core attention mechanism
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
  const weight = expScore; // Simplified for single K,V pair

  // Weighted value
  const output = value.map(v => v * weight);

  return { output, weights: [weight] };
}

/**
 * Multi-Head Attention (JavaScript fallback)
 *
 * Replaces broken @ruvector/attention.multiHeadAttention
 */
export class MultiHeadAttention {
  private numHeads: number;
  private hiddenDim: number;
  private headDim: number;
  private queryWeights: number[][][];
  private keyWeights: number[][][];
  private valueWeights: number[][][];
  private outputWeights: number[][];

  constructor(config: AttentionConfig) {
    this.numHeads = config.numHeads || 8;
    this.hiddenDim = config.hiddenDim;
    this.headDim = Math.floor(this.hiddenDim / this.numHeads);

    // Initialize weights (random)
    this.queryWeights = this.initializeWeights();
    this.keyWeights = this.initializeWeights();
    this.valueWeights = this.initializeWeights();
    this.outputWeights = this.initializeOutputWeights();
  }

  private initializeWeights(): number[][][] {
    const weights: number[][][] = [];
    for (let h = 0; h < this.numHeads; h++) {
      const headWeights: number[][] = [];
      for (let i = 0; i < this.headDim; i++) {
        const row: number[] = [];
        for (let j = 0; j < this.hiddenDim; j++) {
          row.push((Math.random() - 0.5) * 0.1);
        }
        headWeights.push(row);
      }
      weights.push(headWeights);
    }
    return weights;
  }

  private initializeOutputWeights(): number[][] {
    const weights: number[][] = [];
    for (let i = 0; i < this.hiddenDim; i++) {
      const row: number[] = [];
      for (let j = 0; j < this.hiddenDim; j++) {
        row.push((Math.random() - 0.5) * 0.1);
      }
      weights.push(row);
    }
    return weights;
  }

  forward(
    query: number[],
    key: number[],
    value: number[],
    mask?: number[]
  ): { output: number[]; attentionWeights: number[][] } {
    const headOutputs: number[][] = [];
    const allWeights: number[][] = [];

    // Process each head
    for (let h = 0; h < this.numHeads; h++) {
      // Project to head dimension
      const q = this.project(query, this.queryWeights[h]);
      const k = this.project(key, this.keyWeights[h]);
      const v = this.project(value, this.valueWeights[h]);

      // Attention for this head
      const { output, weights } = scaledDotProductAttention(q, k, v, mask);

      headOutputs.push(output);
      allWeights.push(weights);
    }

    // Concatenate heads
    const concatenated = headOutputs.flat();

    // Output projection
    const output = this.project(concatenated, this.outputWeights);

    return { output, attentionWeights: allWeights };
  }

  private project(input: number[], weights: number[][]): number[] {
    const output: number[] = [];
    for (let i = 0; i < weights.length; i++) {
      let sum = 0;
      for (let j = 0; j < input.length; j++) {
        sum += input[j] * weights[i][j];
      }
      output.push(sum);
    }
    return output;
  }
}

/**
 * Flash Attention (optimized fallback)
 *
 * Replaces broken @ruvector/attention.flashAttention
 * Uses tiling/chunking for better memory efficiency
 */
export class FlashAttention {
  private hiddenDim: number;
  private blockSize: number;

  constructor(config: AttentionConfig) {
    this.hiddenDim = config.hiddenDim;
    this.blockSize = Math.min(64, this.hiddenDim); // Tile size
  }

  forward(
    query: number[][],
    key: number[][],
    value: number[][],
    numHeads: number = 8
  ): { output: number[][]; attentionScores: number[][] } {
    const seqLen = query.length;
    const headDim = this.hiddenDim / numHeads;

    const output: number[][] = [];
    const attentionScores: number[][] = [];

    // Process in blocks for memory efficiency
    for (let i = 0; i < seqLen; i += this.blockSize) {
      const blockEnd = Math.min(i + this.blockSize, seqLen);

      for (let qi = i; qi < blockEnd; qi++) {
        const scores: number[] = [];
        let maxScore = -Infinity;

        // Compute attention scores for this query
        for (let ki = 0; ki < seqLen; ki++) {
          let score = 0;
          for (let d = 0; d < query[qi].length; d++) {
            score += query[qi][d] * key[ki][d];
          }
          score /= Math.sqrt(headDim);
          scores.push(score);
          maxScore = Math.max(maxScore, score);
        }

        // Numerically stable softmax
        const expScores = scores.map(s => Math.exp(s - maxScore));
        const sumExp = expScores.reduce((a, b) => a + b, 0);
        const weights = expScores.map(e => e / sumExp);

        // Weighted sum of values
        const outputRow = new Array(value[0].length).fill(0);
        for (let vi = 0; vi < seqLen; vi++) {
          for (let d = 0; d < value[vi].length; d++) {
            outputRow[d] += weights[vi] * value[vi][d];
          }
        }

        output.push(outputRow);
        attentionScores.push(weights);
      }
    }

    return { output, attentionScores };
  }
}

/**
 * Linear Attention (fallback)
 *
 * O(n) complexity approximation of attention
 */
export class LinearAttention {
  private hiddenDim: number;
  private featureMap: (x: number) => number;

  constructor(config: AttentionConfig) {
    this.hiddenDim = config.hiddenDim;
    // ELU feature map
    this.featureMap = (x: number) => (x > 0 ? x : Math.exp(x) - 1);
  }

  forward(
    query: number[][],
    key: number[][],
    value: number[][]
  ): { output: number[][] } {
    const seqLen = query.length;
    const dim = value[0].length;

    // Apply feature map
    const queryMapped = query.map(q => q.map(this.featureMap));
    const keyMapped = key.map(k => k.map(this.featureMap));

    // Compute K^T V (dimension: [dim, valueDim])
    const ktv: number[][] = Array.from({ length: this.hiddenDim }, () =>
      Array(dim).fill(0)
    );

    for (let i = 0; i < seqLen; i++) {
      for (let d1 = 0; d1 < this.hiddenDim; d1++) {
        for (let d2 = 0; d2 < dim; d2++) {
          ktv[d1][d2] += keyMapped[i][d1] * value[i][d2];
        }
      }
    }

    // Compute Q (K^T V)
    const output: number[][] = [];
    for (let i = 0; i < seqLen; i++) {
      const row: number[] = [];
      for (let d2 = 0; d2 < dim; d2++) {
        let sum = 0;
        for (let d1 = 0; d1 < this.hiddenDim; d1++) {
          sum += queryMapped[i][d1] * ktv[d1][d2];
        }
        row.push(sum);
      }

      // Normalize
      const normSum = queryMapped[i].reduce((a, b) => a + b, 0);
      output.push(row.map(v => v / (normSum + 1e-8)));
    }

    return { output };
  }
}

/**
 * Hyperbolic Attention (simplified fallback)
 *
 * Approximation using hyperbolic geometry
 */
export class HyperbolicAttention {
  private hiddenDim: number;
  private curvature: number;

  constructor(config: AttentionConfig) {
    this.hiddenDim = config.hiddenDim;
    this.curvature = -1.0; // Poincaré ball curvature
  }

  forward(
    query: number[],
    key: number[],
    value: number[]
  ): { output: number[]; distance: number } {
    // Hyperbolic distance (simplified)
    const distance = this.hyperbolicDistance(query, key);

    // Attention weight based on hyperbolic distance
    const weight = Math.exp(-distance);

    // Weighted value
    const output = value.map(v => v * weight);

    return { output, distance };
  }

  private hyperbolicDistance(a: number[], b: number[]): number {
    // Simplified hyperbolic distance in Poincaré ball
    let normDiffSq = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      normDiffSq += diff * diff;
    }

    const normASq = a.reduce((sum, v) => sum + v * v, 0);
    const normBSq = b.reduce((sum, v) => sum + v * v, 0);

    const numerator = normDiffSq;
    const denominator = (1 - normASq) * (1 - normBSq);

    return Math.acosh(1 + (2 * numerator) / denominator);
  }
}

/**
 * MoE (Mixture of Experts) Attention (fallback)
 *
 * Routes to different expert attention modules
 */
export class MoEAttention {
  private experts: MultiHeadAttention[];
  private numExperts: number;
  private gatingWeights: number[][];

  constructor(config: AttentionConfig & { numExperts?: number }) {
    this.numExperts = config.numExperts || 4;
    this.experts = Array.from(
      { length: this.numExperts },
      () => new MultiHeadAttention(config)
    );

    // Initialize gating network weights
    this.gatingWeights = Array.from({ length: this.numExperts }, () =>
      Array.from({ length: config.hiddenDim }, () => (Math.random() - 0.5) * 0.1)
    );
  }

  forward(
    query: number[],
    key: number[],
    value: number[],
    topK: number = 2
  ): { output: number[]; expertWeights: number[] } {
    // Compute gating scores
    const gatingScores = this.gatingWeights.map(weights => {
      let score = 0;
      for (let i = 0; i < query.length; i++) {
        score += query[i] * weights[i];
      }
      return score;
    });

    // Softmax over top-K experts
    const expScores = gatingScores.map(s => Math.exp(s));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const expertWeights = expScores.map(e => e / sumExp);

    // Get top-K experts
    const expertIndices = expertWeights
      .map((weight, idx) => ({ weight, idx }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topK);

    // Weighted combination of expert outputs
    const output = new Array(query.length).fill(0);

    for (const { weight, idx } of expertIndices) {
      const expertOutput = this.experts[idx].forward(query, key, value).output;
      for (let i = 0; i < output.length; i++) {
        output[i] += weight * expertOutput[i];
      }
    }

    return { output, expertWeights };
  }
}

/**
 * Check if native attention is available
 */
export function isNativeAttentionAvailable(): boolean {
  if (!nativeAttentionCpuCheck().ok) return false;
  try {
    const attention = require('@ruvector/attention');
    // Try a simple operation
    const result = attention.flashAttention(
      new Float32Array([1, 0]),
      new Float32Array([1, 0]),
      new Float32Array([1, 0]),
      1
    );
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
