/**
 * Benchmark: Agent Spawn Performance
 *
 * Validates that spawn time meets <50ms requirement
 */

import { EphemeralAgentManager } from '../src/index.js';

interface BenchmarkResult {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index];
}

function analyzeTimes(times: number[]): BenchmarkResult {
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...times),
    max: Math.max(...times),
    avg: sum / times.length,
    p50: calculatePercentile(times, 50),
    p95: calculatePercentile(times, 95),
    p99: calculatePercentile(times, 99)
  };
}

async function benchmarkSpawn(iterations: number): Promise<BenchmarkResult> {
  const manager = new EphemeralAgentManager({
    tenantId: 'benchmark',
    lifecycle: {
      defaultTTL: 60000,
      enableAutoCleanup: false // Disable for benchmark
    }
  });

  const times: number[] = [];

  console.log(`🚀 Spawning ${iterations} agents...\n`);

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();

    await manager.spawnAgent('benchmark-agent', {
      id: `bench-${i}`,
      type: 'benchmark',
      description: 'Benchmark spawn'
    });

    const duration = Date.now() - start;
    times.push(duration);

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r   Progress: ${i + 1}/${iterations}`);
    }
  }

  console.log('\n');

  await manager.shutdown();

  return analyzeTimes(times);
}

async function main() {
  console.log('🎯 Spawn Performance Benchmark\n');
  console.log('='.repeat(60));

  const iterations = 1000;
  const result = await benchmarkSpawn(iterations);

  console.log('📊 Results:');
  console.log(`   Iterations:  ${iterations}`);
  console.log(`   Min:         ${result.min.toFixed(2)}ms`);
  console.log(`   Max:         ${result.max.toFixed(2)}ms`);
  console.log(`   Avg:         ${result.avg.toFixed(2)}ms`);
  console.log(`   P50 (median):${result.p50.toFixed(2)}ms`);
  console.log(`   P95:         ${result.p95.toFixed(2)}ms`);
  console.log(`   P99:         ${result.p99.toFixed(2)}ms`);

  console.log('\n🎯 Target: <50ms (P95)');

  if (result.p95 < 50) {
    console.log(`✅ PASSED: ${result.p95.toFixed(2)}ms < 50ms\n`);
  } else {
    console.log(`❌ FAILED: ${result.p95.toFixed(2)}ms >= 50ms\n`);
    process.exit(1);
  }
}

main().catch(console.error);
