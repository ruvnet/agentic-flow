#!/usr/bin/env node
/**
 * Performance Benchmarks for CI/CD Module
 */

const { performance } = require('perf_hooks');
const path = require('path');
const fs = require('fs').promises;
const { CICDVectorDB } = require('../../src/vectordb');
const { WorkflowOrchestrator } = require('../../src/orchestrator');

async function benchmark() {
  console.log('\n⚡ Running Performance Benchmarks...\n');

  const testDbPath = path.join(__dirname, '../../.bench-vectordb');

  // Cleanup
  try {
    await fs.rm(testDbPath, { recursive: true, force: true });
  } catch (err) {
    // Ignore
  }

  const results = [];

  // Benchmark 1: VectorDB Initialization
  console.log('📊 Benchmark 1: VectorDB Initialization');
  const db = new CICDVectorDB({ dbPath: testDbPath });
  const initStart = performance.now();
  await db.initialize();
  const initEnd = performance.now();
  const initTime = initEnd - initStart;
  console.log(`   Time: ${initTime.toFixed(2)}ms\n`);
  results.push({ name: 'VectorDB Init', time: initTime, unit: 'ms' });

  // Benchmark 2: Workflow Storage (100 workflows)
  console.log('📊 Benchmark 2: Store 100 Workflows');
  const storeStart = performance.now();
  for (let i = 0; i < 100; i++) {
    await db.storeWorkflow({
      name: `benchmark-workflow-${i}`,
      duration: 1000 + Math.random() * 5000,
      success: Math.random() > 0.2,
      steps: ['build', 'test', 'deploy'],
      metrics: {
        cacheHits: Math.floor(Math.random() * 10),
        parallelJobs: Math.floor(Math.random() * 5),
        coverage: 70 + Math.random() * 30
      }
    });
  }
  const storeEnd = performance.now();
  const storeTime = storeEnd - storeStart;
  const avgStoreTime = storeTime / 100;
  console.log(`   Total: ${storeTime.toFixed(2)}ms`);
  console.log(`   Average: ${avgStoreTime.toFixed(2)}ms per workflow`);
  console.log(`   Throughput: ${(100 / (storeTime / 1000)).toFixed(2)} workflows/sec\n`);
  results.push({ name: 'Store 100 Workflows', time: storeTime, avg: avgStoreTime, throughput: 100 / (storeTime / 1000), unit: 'ms' });

  // Benchmark 3: Vector Similarity Search
  console.log('📊 Benchmark 3: Vector Similarity Search (1000 queries)');
  const searchStart = performance.now();
  for (let i = 0; i < 1000; i++) {
    await db.querySimilar({
      metrics: {
        duration: 3000,
        steps: ['build', 'test']
      },
      limit: 10,
      threshold: 0.6
    });
  }
  const searchEnd = performance.now();
  const searchTime = searchEnd - searchStart;
  const avgSearchTime = searchTime / 1000;
  console.log(`   Total: ${searchTime.toFixed(2)}ms`);
  console.log(`   Average: ${avgSearchTime.toFixed(2)}ms per query`);
  console.log(`   Throughput: ${(1000 / (searchTime / 1000)).toFixed(2)} queries/sec\n`);
  results.push({ name: 'Vector Search (1000 queries)', time: searchTime, avg: avgSearchTime, throughput: 1000 / (searchTime / 1000), unit: 'ms' });

  // Benchmark 4: Optimization Recommendations
  console.log('📊 Benchmark 4: Get Optimizations (100 requests)');
  const optimizeStart = performance.now();
  for (let i = 0; i < 100; i++) {
    await db.getOptimizations({
      name: 'test-workflow',
      duration: 5000,
      steps: ['build', 'test', 'deploy']
    });
  }
  const optimizeEnd = performance.now();
  const optimizeTime = optimizeEnd - optimizeStart;
  const avgOptimizeTime = optimizeTime / 100;
  console.log(`   Total: ${optimizeTime.toFixed(2)}ms`);
  console.log(`   Average: ${avgOptimizeTime.toFixed(2)}ms per request`);
  console.log(`   Throughput: ${(100 / (optimizeTime / 1000)).toFixed(2)} requests/sec\n`);
  results.push({ name: 'Optimizations (100 requests)', time: optimizeTime, avg: avgOptimizeTime, throughput: 100 / (optimizeTime / 1000), unit: 'ms' });

  // Benchmark 5: Workflow Execution
  console.log('📊 Benchmark 5: Workflow Execution (10 workflows)');
  const orchestrator = new WorkflowOrchestrator({
    dbPath: testDbPath,
    enableLearning: true,
    enableQuantum: false
  });
  await orchestrator.initialize();

  const execStart = performance.now();
  for (let i = 0; i < 10; i++) {
    await orchestrator.executeWorkflow({
      name: `exec-benchmark-${i}`,
      steps: [
        { name: 'step1', action: async () => 'done' },
        { name: 'step2', action: async () => 'done' },
        { name: 'step3', action: async () => 'done' }
      ]
    });
  }
  const execEnd = performance.now();
  const execTime = execEnd - execStart;
  const avgExecTime = execTime / 10;
  console.log(`   Total: ${execTime.toFixed(2)}ms`);
  console.log(`   Average: ${avgExecTime.toFixed(2)}ms per workflow\n`);
  results.push({ name: 'Workflow Execution (10 workflows)', time: execTime, avg: avgExecTime, unit: 'ms' });

  // Benchmark 6: Persistence (Save/Load)
  console.log('📊 Benchmark 6: Data Persistence');
  const saveStart = performance.now();
  await db.saveToDisk();
  const saveEnd = performance.now();
  const saveTime = saveEnd - saveStart;

  const db2 = new CICDVectorDB({ dbPath: testDbPath });
  const loadStart = performance.now();
  await db2.initialize();
  const loadEnd = performance.now();
  const loadTime = loadEnd - loadStart;

  console.log(`   Save: ${saveTime.toFixed(2)}ms`);
  console.log(`   Load: ${loadTime.toFixed(2)}ms\n`);
  results.push({ name: 'Save to Disk', time: saveTime, unit: 'ms' });
  results.push({ name: 'Load from Disk', time: loadTime, unit: 'ms' });

  await db2.cleanup();

  // Benchmark 7: Memory Usage
  console.log('📊 Benchmark 7: Memory Usage');
  const stats = await db.getStats();
  const memUsage = process.memoryUsage();
  console.log(`   Workflows: ${stats.workflows}`);
  console.log(`   Total Entries: ${stats.totalSize}`);
  console.log(`   Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   External: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB\n`);
  results.push({ name: 'Memory (Heap)', value: memUsage.heapUsed / 1024 / 1024, unit: 'MB' });

  // Cleanup
  await orchestrator.cleanup();
  await db.cleanup();
  try {
    await fs.rm(testDbPath, { recursive: true, force: true });
  } catch (err) {
    // Ignore
  }

  // Summary
  console.log('='.repeat(60));
  console.log('\n📈 Benchmark Summary:\n');
  results.forEach(result => {
    if (result.throughput) {
      console.log(`   ${result.name}:`);
      console.log(`      Time: ${result.time.toFixed(2)}${result.unit}`);
      console.log(`      Avg: ${result.avg.toFixed(2)}${result.unit}`);
      console.log(`      Throughput: ${result.throughput.toFixed(2)}/sec`);
    } else if (result.avg) {
      console.log(`   ${result.name}:`);
      console.log(`      Total: ${result.time.toFixed(2)}${result.unit}`);
      console.log(`      Average: ${result.avg.toFixed(2)}${result.unit}`);
    } else if (result.value) {
      console.log(`   ${result.name}: ${result.value.toFixed(2)} ${result.unit}`);
    } else {
      console.log(`   ${result.name}: ${result.time.toFixed(2)} ${result.unit}`);
    }
  });

  console.log('\n✅ All benchmarks completed successfully!\n');
}

if (require.main === module) {
  benchmark().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
  });
}

module.exports = { benchmark };
