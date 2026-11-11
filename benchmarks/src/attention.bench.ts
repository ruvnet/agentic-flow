/**
 * Attention Mechanism Performance Benchmarks
 * Target: <20ms P50 for 512 tokens
 */

import { benchmark, benchmarkSuite, formatDuration } from '../utils/benchmark';

/**
 * Mock Attention mechanism for benchmarking
 */
class AttentionMechanism {
  readonly embedDim: number;
  private numHeads: number;

  constructor(embedDim: number = 768, numHeads: number = 12) {
    this.embedDim = embedDim;
    this.numHeads = numHeads;
  }

  /**
   * Compute self-attention
   * Q, K, V are query, key, value matrices
   */
  async computeAttention(
    query: number[][],
    key: number[][],
    value: number[][]
  ): Promise<number[][]> {
    const seqLen = query.length;
    const headDim = this.embedDim / this.numHeads;

    // Compute attention scores: Q * K^T / sqrt(d_k)
    const scores: number[][] = [];
    for (let i = 0; i < seqLen; i++) {
      scores[i] = [];
      for (let j = 0; j < seqLen; j++) {
        let score = 0;
        for (let k = 0; k < this.embedDim; k++) {
          score += query[i][k] * key[j][k];
        }
        scores[i][j] = score / Math.sqrt(headDim);
      }
    }

    // Apply softmax
    const attnWeights = this.softmax(scores);

    // Compute weighted sum: attention_weights * V
    const output: number[][] = [];
    for (let i = 0; i < seqLen; i++) {
      output[i] = new Array(this.embedDim).fill(0);
      for (let j = 0; j < seqLen; j++) {
        for (let k = 0; k < this.embedDim; k++) {
          output[i][k] += attnWeights[i][j] * value[j][k];
        }
      }
    }

    return output;
  }

  /**
   * Softmax function
   */
  private softmax(scores: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < scores.length; i++) {
      const row = scores[i];
      const max = Math.max(...row);
      const exps = row.map(x => Math.exp(x - max));
      const sum = exps.reduce((a, b) => a + b, 0);
      result[i] = exps.map(x => x / sum);
    }
    return result;
  }
}

/**
 * Generate random embedding matrix
 */
function generateEmbeddings(seqLen: number, embedDim: number): number[][] {
  const embeddings: number[][] = [];
  for (let i = 0; i < seqLen; i++) {
    embeddings[i] = [];
    for (let j = 0; j < embedDim; j++) {
      embeddings[i][j] = Math.random() * 2 - 1; // Range: -1 to 1
    }
  }
  return embeddings;
}

/**
 * Attention Mechanism Benchmark
 * Target: <20ms P50 for 512 tokens
 */
export async function runAttentionBenchmark(): Promise<void> {
  console.log('\n🧠 Attention Mechanism Performance Benchmark');
  console.log('Target: <20ms P50 for 512 tokens');
  console.log('─'.repeat(80));

  const attention = new AttentionMechanism(768, 12);
  const seqLen = 512;
  const embedDim = 768;

  // Generate test data
  const query = generateEmbeddings(seqLen, embedDim);
  const key = generateEmbeddings(seqLen, embedDim);
  const value = generateEmbeddings(seqLen, embedDim);

  const result = await benchmark(
    async () => {
      await attention.computeAttention(query, key, value);
    },
    {
      iterations: 500,
      warmup: 50,
      name: 'attention-512-tokens',
    }
  );

  const targetP50 = 20; // ms
  const targetMet = result.p50 <= targetP50;
  const improvement = ((targetP50 - result.p50) / targetP50) * 100;

  console.log(`\n🎯 Target Analysis:`);
  console.table({
    'Target P50': `${targetP50}ms`,
    'Actual P50': formatDuration(result.p50),
    'Status': targetMet ? '✅ PASS' : '❌ FAIL',
    'Margin': targetMet
      ? `${improvement.toFixed(1)}% faster than target`
      : `${Math.abs(improvement).toFixed(1)}% slower than target`,
  });

  if (targetMet) {
    console.log('\n✅ Attention mechanism benchmark PASSED!');
  } else {
    console.log('\n⚠️  Attention mechanism benchmark did not meet target');
  }
}

/**
 * Variable Sequence Length Benchmark
 */
export async function runVariableSequenceBenchmark(): Promise<void> {
  console.log('\n📏 Variable Sequence Length Benchmark');
  console.log('─'.repeat(80));

  const attention = new AttentionMechanism(768, 12);
  const sequenceLengths = [64, 128, 256, 512, 1024];
  const embedDim = 768;
  const results = [];

  for (const seqLen of sequenceLengths) {
    const query = generateEmbeddings(seqLen, embedDim);
    const key = generateEmbeddings(seqLen, embedDim);
    const value = generateEmbeddings(seqLen, embedDim);

    const result = await benchmark(
      async () => {
        await attention.computeAttention(query, key, value);
      },
      {
        iterations: seqLen > 512 ? 100 : 500,
        warmup: seqLen > 512 ? 10 : 50,
        name: `attention-${seqLen}-tokens`,
        silent: true,
      }
    );

    results.push({ seqLen, result });
  }

  console.log('\n📊 Attention Performance by Sequence Length:');
  console.table(
    results.map(({ seqLen, result }) => ({
      'Sequence Length': seqLen,
      'P50': formatDuration(result.p50),
      'P95': formatDuration(result.p95),
      'P99': formatDuration(result.p99),
      'Throughput': `${result.opsPerSecond.toFixed(2)} ops/sec`,
    }))
  );
}

/**
 * Multi-head Attention Benchmark
 */
export async function runMultiHeadBenchmark(): Promise<void> {
  console.log('\n👥 Multi-head Attention Benchmark');
  console.log('─'.repeat(80));

  const headCounts = [1, 4, 8, 12, 16];
  const seqLen = 256;
  const embedDim = 768;
  const results = [];

  for (const numHeads of headCounts) {
    const attention = new AttentionMechanism(embedDim, numHeads);
    const query = generateEmbeddings(seqLen, embedDim);
    const key = generateEmbeddings(seqLen, embedDim);
    const value = generateEmbeddings(seqLen, embedDim);

    const result = await benchmark(
      async () => {
        await attention.computeAttention(query, key, value);
      },
      {
        iterations: 500,
        warmup: 50,
        name: `attention-${numHeads}-heads`,
        silent: true,
      }
    );

    results.push({ numHeads, result });
  }

  console.log('\n📊 Attention Performance by Number of Heads:');
  console.table(
    results.map(({ numHeads, result }) => ({
      'Number of Heads': numHeads,
      'P50': formatDuration(result.p50),
      'P95': formatDuration(result.p95),
      'P99': formatDuration(result.p99),
    }))
  );
}

/**
 * Batch Processing Benchmark
 */
export async function runBatchAttentionBenchmark(): Promise<void> {
  console.log('\n📦 Batch Attention Processing Benchmark');
  console.log('─'.repeat(80));

  const attention = new AttentionMechanism(768, 12);
  const batchSizes = [1, 4, 8, 16, 32];
  const seqLen = 256;
  const embedDim = 768;
  const results = [];

  for (const batchSize of batchSizes) {
    // Pre-generate batches
    const batches: Array<{ query: number[][]; key: number[][]; value: number[][] }> = [];
    for (let i = 0; i < batchSize; i++) {
      batches.push({
        query: generateEmbeddings(seqLen, embedDim),
        key: generateEmbeddings(seqLen, embedDim),
        value: generateEmbeddings(seqLen, embedDim),
      });
    }

    const result = await benchmark(
      async () => {
        await Promise.all(
          batches.map(batch =>
            attention.computeAttention(batch.query, batch.key, batch.value)
          )
        );
      },
      {
        iterations: 100,
        warmup: 10,
        name: `batch-attention-${batchSize}`,
        silent: true,
      }
    );

    results.push({
      batchSize,
      result,
      sequencesPerSecond: (result.opsPerSecond * batchSize).toFixed(0),
    });
  }

  console.log('\n📊 Batch Attention Performance:');
  console.table(
    results.map(({ batchSize, result, sequencesPerSecond }) => ({
      'Batch Size': batchSize,
      'P50': formatDuration(result.p50),
      'P95': formatDuration(result.p95),
      'Sequences/sec': sequencesPerSecond,
    }))
  );
}

/**
 * Hyperbolic Attention Benchmark
 */
export async function runHyperbolicAttentionBenchmark(): Promise<void> {
  console.log('\n🌀 Hyperbolic Attention Benchmark');
  console.log('Comparing standard vs hyperbolic attention');
  console.log('─'.repeat(80));

  const seqLen = 512;
  const embedDim = 768;

  class HyperbolicAttention extends AttentionMechanism {
    /**
     * Hyperbolic distance-based attention
     */
    async computeHyperbolicAttention(
      query: number[][],
      key: number[][],
      value: number[][]
    ): Promise<number[][]> {
      const seqLen = query.length;

      // Compute hyperbolic distances
      const distances: number[][] = [];
      for (let i = 0; i < seqLen; i++) {
        distances[i] = [];
        for (let j = 0; j < seqLen; j++) {
          distances[i][j] = this.hyperbolicDistance(query[i], key[j]);
        }
      }

      // Convert distances to attention weights
      const attnWeights = this.distanceToWeights(distances);

      // Compute weighted sum
      const output: number[][] = [];
      for (let i = 0; i < seqLen; i++) {
        output[i] = new Array(this.embedDim).fill(0);
        for (let j = 0; j < seqLen; j++) {
          for (let k = 0; k < this.embedDim; k++) {
            output[i][k] += attnWeights[i][j] * value[j][k];
          }
        }
      }

      return output;
    }

    private hyperbolicDistance(a: number[], b: number[]): number {
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        sum += Math.pow(a[i] - b[i], 2);
      }
      return Math.acosh(1 + 2 * sum);
    }

    private distanceToWeights(distances: number[][]): number[][] {
      const weights: number[][] = [];
      for (let i = 0; i < distances.length; i++) {
        const row = distances[i];
        const invDistances = row.map(d => 1 / (1 + d));
        const sum = invDistances.reduce((a, b) => a + b, 0);
        weights[i] = invDistances.map(w => w / sum);
      }
      return weights;
    }
  }

  const attention = new HyperbolicAttention(embedDim, 12);
  const query = generateEmbeddings(seqLen, embedDim);
  const key = generateEmbeddings(seqLen, embedDim);
  const value = generateEmbeddings(seqLen, embedDim);

  const benchmarks = [
    {
      name: 'standard-attention',
      fn: async () => attention.computeAttention(query, key, value),
      options: { iterations: 200, warmup: 20 },
    },
    {
      name: 'hyperbolic-attention',
      fn: async () => attention.computeHyperbolicAttention(query, key, value),
      options: { iterations: 200, warmup: 20 },
    },
  ];

  await benchmarkSuite(benchmarks, 'Standard vs Hyperbolic Attention');
}

// Run all benchmarks if executed directly
if (require.main === module) {
  (async () => {
    try {
      await runAttentionBenchmark();
      await runVariableSequenceBenchmark();
      await runMultiHeadBenchmark();
      await runBatchAttentionBenchmark();
      await runHyperbolicAttentionBenchmark();
      process.exit(0);
    } catch (error) {
      console.error('❌ Attention benchmarks failed:', error);
      process.exit(1);
    }
  })();
}
