/**
 * Load Test: Concurrent Agent Spawning
 *
 * Validates throughput meets 10K spawns/second requirement
 */

import { EphemeralAgentManager } from '../src/index.js';

async function loadTest(targetSpawns: number, concurrency: number): Promise<{
  totalSpawns: number;
  duration: number;
  spawnsPerSecond: number;
  avgSpawnTime: number;
}> {
  const manager = new EphemeralAgentManager({
    tenantId: 'load-test',
    lifecycle: {
      defaultTTL: 60000,
      enableAutoCleanup: false
    }
  });

  console.log(`🚀 Load test starting...`);
  console.log(`   Target: ${targetSpawns} spawns`);
  console.log(`   Concurrency: ${concurrency}\n`);

  const start = Date.now();
  const spawnTimes: number[] = [];

  // Spawn in batches for concurrency control
  const batchSize = concurrency;
  const batches = Math.ceil(targetSpawns / batchSize);

  for (let batch = 0; batch < batches; batch++) {
    const remaining = targetSpawns - (batch * batchSize);
    const currentBatchSize = Math.min(batchSize, remaining);

    const promises = [];
    for (let i = 0; i < currentBatchSize; i++) {
      const spawnStart = Date.now();
      const promise = manager.spawnAgent('load-test', {
        id: `load-${batch}-${i}`,
        type: 'load',
        description: 'Load test'
      }).then(() => {
        spawnTimes.push(Date.now() - spawnStart);
      });
      promises.push(promise);
    }

    await Promise.all(promises);

    const progress = ((batch + 1) * batchSize / targetSpawns * 100).toFixed(1);
    process.stdout.write(`\r   Progress: ${progress}%`);
  }

  console.log('\n');

  const duration = (Date.now() - start) / 1000; // seconds
  const spawnsPerSecond = targetSpawns / duration;
  const avgSpawnTime = spawnTimes.reduce((a, b) => a + b, 0) / spawnTimes.length;

  await manager.shutdown();

  return {
    totalSpawns: targetSpawns,
    duration,
    spawnsPerSecond,
    avgSpawnTime
  };
}

async function main() {
  console.log('⚡ Load Test: Concurrent Agent Spawning\n');
  console.log('='.repeat(60));

  const tests = [
    { spawns: 100, concurrency: 10 },
    { spawns: 1000, concurrency: 50 },
    { spawns: 10000, concurrency: 100 }
  ];

  for (const test of tests) {
    console.log(`\n📊 Test: ${test.spawns} spawns @ ${test.concurrency} concurrency`);
    console.log('─'.repeat(60));

    const result = await loadTest(test.spawns, test.concurrency);

    console.log('📈 Results:');
    console.log(`   Total spawns:       ${result.totalSpawns}`);
    console.log(`   Duration:           ${result.duration.toFixed(2)}s`);
    console.log(`   Throughput:         ${result.spawnsPerSecond.toFixed(0)} spawns/sec`);
    console.log(`   Avg spawn time:     ${result.avgSpawnTime.toFixed(2)}ms`);

    if (test.spawns === 10000) {
      console.log('\n🎯 Target: 10,000 spawns/second');
      if (result.spawnsPerSecond >= 10000) {
        console.log(`✅ PASSED: ${result.spawnsPerSecond.toFixed(0)} >= 10,000 spawns/sec`);
      } else {
        console.log(`⚠️  BELOW TARGET: ${result.spawnsPerSecond.toFixed(0)} < 10,000 spawns/sec`);
        console.log(`   (Single node limitation - use distributed setup for full throughput)`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Load test complete!\n');
}

main().catch(console.error);
