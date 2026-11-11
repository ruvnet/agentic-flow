/**
 * Graph Neural Network Performance Benchmarks
 * Target: <50ms P50 for GNN forward pass
 */

import { benchmark, benchmarkSuite, formatDuration } from '../utils/benchmark';

/**
 * Graph structure
 */
interface Graph {
  numNodes: number;
  edges: [number, number][]; // [source, target] pairs
  nodeFeatures: number[][]; // Node feature vectors
}

/**
 * Generate random graph
 */
function generateRandomGraph(numNodes: number, edgeProbability: number = 0.1, featureDim: number = 128): Graph {
  const edges: [number, number][] = [];
  const nodeFeatures: number[][] = [];

  // Generate node features
  for (let i = 0; i < numNodes; i++) {
    nodeFeatures[i] = [];
    for (let j = 0; j < featureDim; j++) {
      nodeFeatures[i][j] = Math.random() * 2 - 1;
    }
  }

  // Generate edges
  for (let i = 0; i < numNodes; i++) {
    for (let j = 0; j < numNodes; j++) {
      if (i !== j && Math.random() < edgeProbability) {
        edges.push([i, j]);
      }
    }
  }

  return { numNodes, edges, nodeFeatures };
}

/**
 * Generate scale-free graph (preferential attachment)
 */
function generateScaleFreeGraph(numNodes: number, m: number = 3, featureDim: number = 128): Graph {
  const edges: [number, number][] = [];
  const nodeFeatures: number[][] = [];
  const degrees: number[] = new Array(numNodes).fill(0);

  // Generate node features
  for (let i = 0; i < numNodes; i++) {
    nodeFeatures[i] = [];
    for (let j = 0; j < featureDim; j++) {
      nodeFeatures[i][j] = Math.random() * 2 - 1;
    }
  }

  // Initial complete graph
  for (let i = 0; i < Math.min(m, numNodes); i++) {
    for (let j = i + 1; j < Math.min(m, numNodes); j++) {
      edges.push([i, j]);
      degrees[i]++;
      degrees[j]++;
    }
  }

  // Preferential attachment
  for (let i = m; i < numNodes; i++) {
    const totalDegree = degrees.reduce((a, b) => a + b, 0);
    const targets = new Set<number>();

    while (targets.size < m) {
      let rand = Math.random() * totalDegree;
      for (let j = 0; j < i; j++) {
        rand -= degrees[j];
        if (rand <= 0) {
          targets.add(j);
          break;
        }
      }
    }

    for (const target of targets) {
      edges.push([i, target]);
      degrees[i]++;
      degrees[target]++;
    }
  }

  return { numNodes, edges, nodeFeatures };
}

/**
 * Graph Neural Network Layer
 */
class GNNLayer {
  private inputDim: number;
  private outputDim: number;
  private weights: number[][];

  constructor(inputDim: number, outputDim: number) {
    this.inputDim = inputDim;
    this.outputDim = outputDim;

    // Initialize weights
    this.weights = [];
    for (let i = 0; i < outputDim; i++) {
      this.weights[i] = [];
      for (let j = 0; j < inputDim; j++) {
        this.weights[i][j] = (Math.random() * 2 - 1) / Math.sqrt(inputDim);
      }
    }
  }

  /**
   * Message passing: aggregate neighbor features
   */
  async aggregate(graph: Graph): Promise<number[][]> {
    const { numNodes, edges, nodeFeatures } = graph;
    const aggregated: number[][] = [];

    // Initialize with self features
    for (let i = 0; i < numNodes; i++) {
      aggregated[i] = [...nodeFeatures[i]];
    }

    // Aggregate neighbor features
    for (const [source, target] of edges) {
      for (let i = 0; i < this.inputDim; i++) {
        aggregated[target][i] += nodeFeatures[source][i];
      }
    }

    // Normalize by degree
    const degrees: number[] = new Array(numNodes).fill(1); // +1 for self
    for (const [, target] of edges) {
      degrees[target]++;
    }

    for (let i = 0; i < numNodes; i++) {
      for (let j = 0; j < this.inputDim; j++) {
        aggregated[i][j] /= degrees[i];
      }
    }

    return aggregated;
  }

  /**
   * Apply transformation
   */
  async transform(features: number[][]): Promise<number[][]> {
    const output: number[][] = [];

    for (let i = 0; i < features.length; i++) {
      output[i] = [];
      for (let j = 0; j < this.outputDim; j++) {
        let sum = 0;
        for (let k = 0; k < this.inputDim; k++) {
          sum += this.weights[j][k] * features[i][k];
        }
        // ReLU activation
        output[i][j] = Math.max(0, sum);
      }
    }

    return output;
  }

  /**
   * Forward pass
   */
  async forward(graph: Graph): Promise<number[][]> {
    const aggregated = await this.aggregate(graph);
    return await this.transform(aggregated);
  }
}

/**
 * Multi-layer GNN
 */
class GNN {
  private layers: GNNLayer[];

  constructor(layerDims: number[]) {
    this.layers = [];
    for (let i = 0; i < layerDims.length - 1; i++) {
      this.layers.push(new GNNLayer(layerDims[i], layerDims[i + 1]));
    }
  }

  async forward(graph: Graph): Promise<number[][]> {
    let currentGraph = graph;
    let features = graph.nodeFeatures;

    for (const layer of this.layers) {
      features = await layer.forward(currentGraph);
      currentGraph = { ...currentGraph, nodeFeatures: features };
    }

    return features;
  }
}

/**
 * GNN Forward Pass Benchmark
 * Target: <50ms P50
 */
export async function runGNNForwardPassBenchmark(): Promise<void> {
  console.log('\n🕸️  GNN Forward Pass Performance Benchmark');
  console.log('Target: <50ms P50');
  console.log('─'.repeat(80));

  const graph = generateRandomGraph(1000, 0.05, 128);
  const gnn = new GNN([128, 64, 32]);

  console.log(`\n📊 Graph Statistics:`);
  console.table({
    'Nodes': graph.numNodes,
    'Edges': graph.edges.length,
    'Avg Degree': (graph.edges.length / graph.numNodes).toFixed(2),
    'Feature Dim': graph.nodeFeatures[0].length,
  });

  const result = await benchmark(
    async () => {
      await gnn.forward(graph);
    },
    {
      iterations: 500,
      warmup: 50,
      name: 'gnn-forward-pass',
    }
  );

  const targetP50 = 50; // ms
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
    console.log('\n✅ GNN forward pass benchmark PASSED!');
  } else {
    console.log('\n⚠️  GNN forward pass benchmark did not meet target');
  }
}

/**
 * Variable Graph Size Benchmark
 */
export async function runVariableGraphSizeBenchmark(): Promise<void> {
  console.log('\n📏 Variable Graph Size Benchmark');
  console.log('─'.repeat(80));

  const nodeCounts = [100, 500, 1000, 5000, 10000];
  const results = [];

  for (const numNodes of nodeCounts) {
    const graph = generateRandomGraph(numNodes, 0.05, 128);
    const gnn = new GNN([128, 64, 32]);

    const result = await benchmark(
      async () => {
        await gnn.forward(graph);
      },
      {
        iterations: numNodes > 5000 ? 50 : 200,
        warmup: numNodes > 5000 ? 5 : 20,
        name: `gnn-${numNodes}-nodes`,
        silent: true,
      }
    );

    results.push({
      numNodes,
      numEdges: graph.edges.length,
      result,
    });
  }

  console.log('\n📊 GNN Performance by Graph Size:');
  console.table(
    results.map(({ numNodes, numEdges, result }) => ({
      'Nodes': numNodes,
      'Edges': numEdges,
      'P50': formatDuration(result.p50),
      'P95': formatDuration(result.p95),
      'P99': formatDuration(result.p99),
    }))
  );
}

/**
 * Variable Network Depth Benchmark
 */
export async function runVariableDepthBenchmark(): Promise<void> {
  console.log('\n🔢 Variable Network Depth Benchmark');
  console.log('─'.repeat(80));

  const graph = generateRandomGraph(1000, 0.05, 128);
  const networkConfigs = [
    [128, 64],           // 1 layer
    [128, 64, 32],       // 2 layers
    [128, 64, 32, 16],   // 3 layers
    [128, 64, 32, 16, 8], // 4 layers
  ];
  const results = [];

  for (const config of networkConfigs) {
    const gnn = new GNN(config);

    const result = await benchmark(
      async () => {
        await gnn.forward(graph);
      },
      {
        iterations: 200,
        warmup: 20,
        name: `gnn-${config.length - 1}-layers`,
        silent: true,
      }
    );

    results.push({
      depth: config.length - 1,
      config: config.join('→'),
      result,
    });
  }

  console.log('\n📊 GNN Performance by Network Depth:');
  console.table(
    results.map(({ depth, config, result }) => ({
      'Layers': depth,
      'Architecture': config,
      'P50': formatDuration(result.p50),
      'P95': formatDuration(result.p95),
    }))
  );
}

/**
 * Different Graph Topologies Benchmark
 */
export async function runGraphTopologyBenchmark(): Promise<void> {
  console.log('\n🌐 Graph Topology Performance Benchmark');
  console.log('─'.repeat(80));

  const numNodes = 1000;
  const gnn = new GNN([128, 64, 32]);

  const graphTypes = [
    {
      name: 'sparse-random',
      graph: generateRandomGraph(numNodes, 0.01, 128),
    },
    {
      name: 'medium-random',
      graph: generateRandomGraph(numNodes, 0.05, 128),
    },
    {
      name: 'dense-random',
      graph: generateRandomGraph(numNodes, 0.1, 128),
    },
    {
      name: 'scale-free',
      graph: generateScaleFreeGraph(numNodes, 5, 128),
    },
  ];

  const results = [];

  for (const { name, graph } of graphTypes) {
    const result = await benchmark(
      async () => {
        await gnn.forward(graph);
      },
      {
        iterations: 200,
        warmup: 20,
        name: `gnn-${name}`,
        silent: true,
      }
    );

    results.push({
      topology: name,
      edges: graph.edges.length,
      avgDegree: (graph.edges.length / graph.numNodes).toFixed(2),
      result,
    });
  }

  console.log('\n📊 GNN Performance by Graph Topology:');
  console.table(
    results.map(({ topology, edges, avgDegree, result }) => ({
      'Topology': topology,
      'Edges': edges,
      'Avg Degree': avgDegree,
      'P50': formatDuration(result.p50),
      'P95': formatDuration(result.p95),
    }))
  );
}

/**
 * Batch Graph Processing Benchmark
 */
export async function runBatchGraphBenchmark(): Promise<void> {
  console.log('\n📦 Batch Graph Processing Benchmark');
  console.log('─'.repeat(80));

  const batchSizes = [1, 4, 8, 16];
  const gnn = new GNN([128, 64, 32]);
  const results = [];

  for (const batchSize of batchSizes) {
    // Generate batch of graphs
    const graphs: Array<ReturnType<typeof generateRandomGraph>> = [];
    for (let i = 0; i < batchSize; i++) {
      graphs.push(generateRandomGraph(500, 0.05, 128));
    }

    const result = await benchmark(
      async () => {
        await Promise.all(graphs.map(graph => gnn.forward(graph)));
      },
      {
        iterations: 100,
        warmup: 10,
        name: `batch-${batchSize}`,
        silent: true,
      }
    );

    results.push({
      batchSize,
      result,
      graphsPerSecond: (result.opsPerSecond * batchSize).toFixed(0),
    });
  }

  console.log('\n📊 Batch Processing Performance:');
  console.table(
    results.map(({ batchSize, result, graphsPerSecond }) => ({
      'Batch Size': batchSize,
      'P50': formatDuration(result.p50),
      'P95': formatDuration(result.p95),
      'Graphs/sec': graphsPerSecond,
    }))
  );
}

// Run all benchmarks if executed directly
if (require.main === module) {
  (async () => {
    try {
      await runGNNForwardPassBenchmark();
      await runVariableGraphSizeBenchmark();
      await runVariableDepthBenchmark();
      await runGraphTopologyBenchmark();
      await runBatchGraphBenchmark();
      process.exit(0);
    } catch (error) {
      console.error('❌ GNN benchmarks failed:', error);
      process.exit(1);
    }
  })();
}
