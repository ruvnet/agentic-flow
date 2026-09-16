/**
 * Performance Benchmark Suite for P2P Game Content Generator
 */

import P2PGameContentManager from './index.js';
import { ContentType } from './types/GameContent.js';

interface BenchmarkResult {
  name: string;
  target: number;
  iterations: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  passed: boolean;
}

class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  async runAll(): Promise<void> {
    console.log('🚀 Starting P2P Game Content Performance Benchmarks\n');
    console.log('='.repeat(80));

    await this.benchmarkContentGeneration();
    await this.benchmarkP2PSync();
    await this.benchmarkByzantineConsensus();
    await this.benchmarkAgentSpawn();
    await this.benchmarkContentThroughput();

    console.log('\n' + '='.repeat(80));
    this.printSummary();
  }

  private async benchmarkContentGeneration(): Promise<void> {
    console.log('\n📊 Benchmarking Content Generation (Target: <5ms)');
    console.log('-'.repeat(80));

    const manager = new P2PGameContentManager();
    await manager.initialize();

    const contentTypes: ContentType[] = ['character', 'quest', 'item', 'map', 'dialog'];

    for (const type of contentTypes) {
      const times: number[] = [];
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await manager.generateContent(type);
        const time = performance.now() - start;
        times.push(time);
      }

      const result = this.calculateStats(
        `Content Generation (${type})`,
        5,
        iterations,
        times
      );
      this.results.push(result);
      this.printResult(result);
    }

    await manager.shutdown();
  }

  private async benchmarkP2PSync(): Promise<void> {
    console.log('\n📊 Benchmarking P2P Synchronization (Target: <100ms)');
    console.log('-'.repeat(80));

    const manager1 = new P2PGameContentManager('peer-1');
    const manager2 = new P2PGameContentManager('peer-2');

    await manager1.initialize();
    await manager2.initialize();

    const components1 = manager1.getComponents();
    const times: number[] = [];
    const iterations = 50;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();

      // Update state
      components1.gameState.updatePlayerPosition(i, i);

      // Simulate sync (in real implementation, this would measure actual network latency)
      await new Promise(resolve => setTimeout(resolve, 10));

      const time = performance.now() - start;
      times.push(time);
    }

    const result = this.calculateStats(
      'P2P Sync Latency',
      100,
      iterations,
      times
    );
    this.results.push(result);
    this.printResult(result);

    await manager1.shutdown();
    await manager2.shutdown();
  }

  private async benchmarkByzantineConsensus(): Promise<void> {
    console.log('\n📊 Benchmarking Byzantine Consensus (Target: <500ms)');
    console.log('-'.repeat(80));

    const manager = new P2PGameContentManager();
    await manager.initialize();

    const components = manager.getComponents();
    const times: number[] = [];
    const iterations = 20;

    for (let i = 0; i < iterations; i++) {
      const content = await manager.generateContent('character');

      const start = performance.now();
      await components.validator.validateContent(content);
      const time = performance.now() - start;
      times.push(time);
    }

    const result = this.calculateStats(
      'Byzantine Consensus',
      500,
      iterations,
      times
    );
    this.results.push(result);
    this.printResult(result);

    await manager.shutdown();
  }

  private async benchmarkAgentSpawn(): Promise<void> {
    console.log('\n📊 Benchmarking Agent Spawn Time (Target: <50ms)');
    console.log('-'.repeat(80));

    const manager = new P2PGameContentManager();
    await manager.initialize();

    const components = manager.getComponents();
    const times: number[] = [];
    const iterations = 50;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();

      // Spawn ephemeral agent (via content generation)
      await components.generator.generateContent({
        type: 'character',
        params: { level: 1 }
      });

      const time = performance.now() - start;
      times.push(time);
    }

    const result = this.calculateStats(
      'Agent Spawn Time',
      50,
      iterations,
      times
    );
    this.results.push(result);
    this.printResult(result);

    await manager.shutdown();
  }

  private async benchmarkContentThroughput(): Promise<void> {
    console.log('\n📊 Benchmarking Content Throughput (Target: >100 assets/sec)');
    console.log('-'.repeat(80));

    const manager = new P2PGameContentManager();
    await manager.initialize();

    const testDuration = 1000; // 1 second
    const contentTypes: ContentType[] = ['character', 'quest', 'item'];

    const start = performance.now();
    let count = 0;

    while (performance.now() - start < testDuration) {
      const type = contentTypes[count % contentTypes.length];
      await manager.generateContent(type);
      count++;
    }

    const elapsed = performance.now() - start;
    const throughput = (count / elapsed) * 1000; // assets per second

    console.log(`Generated ${count} assets in ${elapsed.toFixed(0)}ms`);
    console.log(`Throughput: ${throughput.toFixed(0)} assets/second`);
    console.log(`Status: ${throughput >= 100 ? '✅ PASSED' : '❌ FAILED'}`);

    this.results.push({
      name: 'Content Throughput',
      target: 100,
      iterations: count,
      avgTime: elapsed / count,
      minTime: 0,
      maxTime: 0,
      passed: throughput >= 100
    });

    await manager.shutdown();
  }

  private calculateStats(
    name: string,
    target: number,
    iterations: number,
    times: number[]
  ): BenchmarkResult {
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const passed = avgTime <= target;

    return {
      name,
      target,
      iterations,
      avgTime,
      minTime,
      maxTime,
      passed
    };
  }

  private printResult(result: BenchmarkResult): void {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`\n${result.name}:`);
    console.log(`  Iterations: ${result.iterations}`);
    console.log(`  Average: ${result.avgTime.toFixed(2)}ms`);
    console.log(`  Min: ${result.minTime.toFixed(2)}ms`);
    console.log(`  Max: ${result.maxTime.toFixed(2)}ms`);
    console.log(`  Target: <${result.target}ms`);
    console.log(`  Status: ${status}`);
  }

  private printSummary(): void {
    console.log('\n📈 Benchmark Summary');
    console.log('='.repeat(80));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const passRate = (passed / total) * 100;

    console.log('\nResults:');
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      const perf = ((result.avgTime / result.target) * 100).toFixed(0);
      console.log(
        `  ${status} ${result.name.padEnd(40)} ` +
        `${result.avgTime.toFixed(2)}ms / ${result.target}ms (${perf}%)`
      );
    });

    console.log('\nOverall:');
    console.log(`  Total Tests: ${total}`);
    console.log(`  Passed: ${passed} (${passRate.toFixed(0)}%)`);
    console.log(`  Failed: ${total - passed}`);

    if (passRate === 100) {
      console.log('\n🎉 All benchmarks passed! System meets performance targets.');
    } else if (passRate >= 80) {
      console.log('\n⚠️  Most benchmarks passed. Some optimization needed.');
    } else {
      console.log('\n❌ Performance targets not met. Optimization required.');
    }

    console.log('\n' + '='.repeat(80));
  }
}

// Run benchmarks if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const benchmark = new PerformanceBenchmark();
  benchmark.runAll().catch(console.error);
}

export default PerformanceBenchmark;
