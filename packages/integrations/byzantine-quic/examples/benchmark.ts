/**
 * Byzantine QUIC Benchmark
 *
 * Performance benchmarks for Byzantine consensus over QUIC
 * Targets: <10ms consensus latency, 1000+ ops/sec throughput
 */

import { ByzantineNode } from '../src/index.js';

interface BenchmarkResult {
  name: string;
  operations: number;
  durationMs: number;
  throughput: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

/**
 * Run benchmark suite
 */
async function runBenchmarks() {
  console.log('=== Byzantine QUIC Consensus Benchmarks ===\n');
  console.log('Target: <10ms consensus latency, 1000+ ops/sec\n');

  const results: BenchmarkResult[] = [];

  // Benchmark 1: Latency (small operations)
  console.log('📊 Benchmark 1: Consensus Latency\n');
  results.push(await benchmarkLatency());

  await sleep(1000);

  // Benchmark 2: Throughput (rapid operations)
  console.log('\n📊 Benchmark 2: Throughput\n');
  results.push(await benchmarkThroughput());

  await sleep(1000);

  // Benchmark 3: Large payloads
  console.log('\n📊 Benchmark 3: Large Payloads\n');
  results.push(await benchmarkLargePayloads());

  await sleep(1000);

  // Benchmark 4: Concurrent clients
  console.log('\n📊 Benchmark 4: Concurrent Clients\n');
  results.push(await benchmarkConcurrency());

  // Print summary
  console.log('\n=== Benchmark Summary ===\n');
  console.log('┌─────────────────────────┬────────────┬─────────────┬─────────┬─────────┬─────────┐');
  console.log('│ Benchmark               │ Operations │ Throughput  │ Avg (ms)│ P95 (ms)│ P99 (ms)│');
  console.log('├─────────────────────────┼────────────┼─────────────┼─────────┼─────────┼─────────┤');

  results.forEach(result => {
    console.log(
      `│ ${result.name.padEnd(23)} │ ${String(result.operations).padStart(10)} │ ` +
      `${String(result.throughput.toFixed(0)).padStart(9)} ops │ ` +
      `${result.avgLatencyMs.toFixed(2).padStart(7)} │ ` +
      `${result.p95LatencyMs.toFixed(2).padStart(7)} │ ` +
      `${result.p99LatencyMs.toFixed(2).padStart(7)} │`
    );
  });

  console.log('└─────────────────────────┴────────────┴─────────────┴─────────┴─────────┴─────────┘');

  // Check if targets met
  console.log('\n=== Target Achievement ===\n');
  const latencyTarget = results[0].p95LatencyMs < 10;
  const throughputTarget = results[1].throughput > 1000;

  console.log(`✓ Latency target (<10ms P95):      ${latencyTarget ? '✅ MET' : '⚠️  NOT MET'} (${results[0].p95LatencyMs.toFixed(2)}ms)`);
  console.log(`✓ Throughput target (>1000 ops/s): ${throughputTarget ? '✅ MET' : '⚠️  NOT MET'} (${results[1].throughput.toFixed(0)} ops/s)`);

  console.log('\nNote: Actual QUIC deployment will achieve better performance');
  console.log('      than simulated tests.');
}

/**
 * Benchmark consensus latency
 */
async function benchmarkLatency(): Promise<BenchmarkResult> {
  const nodes = await setupCluster(4, 1);
  const primary = nodes[0];

  const numOps = 50;
  const latencies: number[] = [];

  console.log(`Running ${numOps} operations to measure latency...\n`);

  for (let i = 0; i < numOps; i++) {
    const start = Date.now();
    await primary.submitRequest({ type: 'PING', id: i });
    const latency = Date.now() - start;
    latencies.push(latency);

    if (i % 10 === 0) {
      process.stdout.write('.');
    }
  }

  console.log(' Done!\n');

  const stats = primary.getStats();
  await cleanupCluster(nodes);

  return {
    name: 'Consensus Latency',
    operations: numOps,
    durationMs: latencies.reduce((a, b) => a + b, 0),
    throughput: (numOps / (latencies.reduce((a, b) => a + b, 0) / 1000)),
    avgLatencyMs: stats.metrics.averageLatencyMs,
    p50LatencyMs: stats.latencyP50,
    p95LatencyMs: stats.latencyP95,
    p99LatencyMs: stats.latencyP99,
  };
}

/**
 * Benchmark throughput
 */
async function benchmarkThroughput(): Promise<BenchmarkResult> {
  const nodes = await setupCluster(4, 1);
  const primary = nodes[0];

  const numOps = 100;
  console.log(`Executing ${numOps} operations as fast as possible...\n`);

  const start = Date.now();

  for (let i = 0; i < numOps; i++) {
    await primary.submitRequest({ type: 'THROUGHPUT_TEST', seq: i });
    if (i % 20 === 0) {
      process.stdout.write('.');
    }
  }

  const duration = Date.now() - start;
  console.log(' Done!\n');

  const throughput = (numOps / duration) * 1000;
  const stats = primary.getStats();

  await cleanupCluster(nodes);

  return {
    name: 'Throughput',
    operations: numOps,
    durationMs: duration,
    throughput,
    avgLatencyMs: stats.metrics.averageLatencyMs,
    p50LatencyMs: stats.latencyP50,
    p95LatencyMs: stats.latencyP95,
    p99LatencyMs: stats.latencyP99,
  };
}

/**
 * Benchmark with large payloads
 */
async function benchmarkLargePayloads(): Promise<BenchmarkResult> {
  const nodes = await setupCluster(4, 1);
  const primary = nodes[0];

  const numOps = 30;
  const largePayload = { data: 'x'.repeat(1000), metadata: Array(50).fill({ key: 'value' }) };

  console.log(`Testing ${numOps} operations with large payloads (>1KB)...\n`);

  const start = Date.now();

  for (let i = 0; i < numOps; i++) {
    await primary.submitRequest({ type: 'LARGE_DATA', id: i, payload: largePayload });
    if (i % 10 === 0) {
      process.stdout.write('.');
    }
  }

  const duration = Date.now() - start;
  console.log(' Done!\n');

  const throughput = (numOps / duration) * 1000;
  const stats = primary.getStats();

  await cleanupCluster(nodes);

  return {
    name: 'Large Payloads',
    operations: numOps,
    durationMs: duration,
    throughput,
    avgLatencyMs: stats.metrics.averageLatencyMs,
    p50LatencyMs: stats.latencyP50,
    p95LatencyMs: stats.latencyP95,
    p99LatencyMs: stats.latencyP99,
  };
}

/**
 * Benchmark concurrent clients
 */
async function benchmarkConcurrency(): Promise<BenchmarkResult> {
  const nodes = await setupCluster(4, 1);

  const numClients = 4;
  const opsPerClient = 25;

  console.log(`Testing ${numClients} concurrent clients, ${opsPerClient} ops each...\n`);

  const start = Date.now();

  await Promise.all(
    nodes.map(async (node, i) => {
      for (let j = 0; j < opsPerClient; j++) {
        await node.submitRequest({ type: 'CONCURRENT', client: i, seq: j });
        if (j % 10 === 0) {
          process.stdout.write('.');
        }
      }
    })
  );

  const duration = Date.now() - start;
  console.log(' Done!\n');

  const totalOps = numClients * opsPerClient;
  const throughput = (totalOps / duration) * 1000;
  const stats = nodes[0].getStats();

  await cleanupCluster(nodes);

  return {
    name: 'Concurrent Clients',
    operations: totalOps,
    durationMs: duration,
    throughput,
    avgLatencyMs: stats.metrics.averageLatencyMs,
    p50LatencyMs: stats.latencyP50,
    p95LatencyMs: stats.latencyP95,
    p99LatencyMs: stats.latencyP99,
  };
}

/**
 * Setup test cluster
 */
async function setupCluster(numNodes: number, maxFaults: number): Promise<ByzantineNode[]> {
  const configs = Array.from({ length: numNodes }, (_, i) => ({
    nodeId: `node-${i}`,
    host: 'localhost',
    port: 11000 + i,
  }));

  const nodes = configs.map(
    config =>
      new ByzantineNode({
        nodeId: config.nodeId,
        nodes: configs,
        maxFaults,
        viewChangeTimeoutMs: 5000,
        checkpointInterval: 20,
        debug: false, // Disable logs for benchmarks
      })
  );

  await Promise.all(nodes.map(n => n.initialize()));
  return nodes;
}

/**
 * Cleanup cluster
 */
async function cleanupCluster(nodes: ByzantineNode[]): Promise<void> {
  await Promise.all(nodes.map(n => n.shutdown()));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run benchmarks
runBenchmarks().catch(console.error);
