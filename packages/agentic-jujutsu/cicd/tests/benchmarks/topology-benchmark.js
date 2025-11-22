/**
 * Comprehensive Topology Benchmark
 *
 * Compares all coordination topologies across different scenarios:
 * - Small workload (3 tasks)
 * - Medium workload (10 tasks)
 * - Large workload (50 tasks)
 * - Dependent tasks
 * - Mixed complexity
 */

const { EnhancedOrchestrator } = require('../../src/index');
const TopologyManager = require('../../src/topology-manager');

console.log('\n' + '='.repeat(70));
console.log('📊 COMPREHENSIVE TOPOLOGY BENCHMARK');
console.log('='.repeat(70) + '\n');

// Create tasks of varying complexity
function createTasks(count, config = {}) {
  return Array.from({ length: count }, (_, i) => ({
    name: `task-${i + 1}`,
    action: async (context) => {
      // Simulate work with varying duration
      const baseDelay = config.baseDelay || 10;
      const variance = config.variance || 10;
      const delay = baseDelay + Math.random() * variance;

      await new Promise(resolve => setTimeout(resolve, delay));

      // Simulate occasional failures
      if (config.failureRate && Math.random() < config.failureRate) {
        throw new Error(`Task ${i + 1} failed (simulated)`);
      }

      return {
        task: `task-${i + 1}`,
        result: `Completed in ${delay.toFixed(1)}ms`,
        timestamp: Date.now()
      };
    },
    type: config.heterogeneous ? (i % 3 === 0 ? 'typeA' : i % 3 === 1 ? 'typeB' : 'typeC') : 'default',
    priority: i < count / 3 ? 'high' : i < (count * 2) / 3 ? 'medium' : 'low',
    dependencies: config.sequential && i > 0 ? [`task-${i}`] : []
  }));
}

async function benchmarkScenario(name, tasks, options = {}) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📌 Scenario: ${name}`);
  console.log(`   Tasks: ${tasks.length}, Config: ${JSON.stringify(options)}`);
  console.log(`${'─'.repeat(70)}\n`);

  const manager = new TopologyManager();
  const results = {};
  const topologies = ['sequential', 'mesh', 'hierarchical', 'adaptive', 'gossip'];

  for (const topology of topologies) {
    console.log(`\n🔬 Testing ${topology}...`);

    const startTime = Date.now();

    try {
      const result = await manager.execute(tasks, { topology });

      const duration = Date.now() - startTime;
      const successCount = result.results.filter(r => r.success).length;
      const successRate = successCount / result.results.length;

      results[topology] = {
        success: result.success,
        duration,
        successRate,
        successCount,
        totalTasks: result.results.length,
        stats: result.stats
      };

      console.log(`   ✅ ${topology}: ${duration}ms (${(successRate * 100).toFixed(1)}% success, ${successCount}/${result.results.length} tasks)`);

      // Reset topology for next test
      manager.topologies[topology].reset();

    } catch (error) {
      results[topology] = {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };

      console.log(`   ❌ ${topology}: Failed - ${error.message}`);
    }
  }

  // Find winner
  const winner = findWinner(results);

  console.log(`\n🏆 Winner for "${name}": ${winner.topology}`);
  console.log(`   Performance: ${winner.duration}ms, ${(winner.successRate * 100).toFixed(1)}% success`);
  console.log(`   Speedup vs slowest: ${winner.speedup}x`);

  return { name, results, winner };
}

function findWinner(results) {
  let winner = null;
  let bestScore = 0;
  let slowestDuration = 0;

  // Find slowest duration for speedup calculation
  for (const result of Object.values(results)) {
    if (result.success && result.duration > slowestDuration) {
      slowestDuration = result.duration;
    }
  }

  for (const [topology, result] of Object.entries(results)) {
    if (!result.success) continue;

    // Score: success rate (60%) + speed (40%)
    const successScore = result.successRate * 0.6;
    const speedScore = result.duration > 0 ? (1000 / result.duration) * 0.4 : 0;
    const score = successScore + speedScore;

    if (score > bestScore) {
      bestScore = score;
      winner = {
        topology,
        duration: result.duration,
        successRate: result.successRate,
        score,
        speedup: slowestDuration > 0 ? (slowestDuration / result.duration) : 1
      };
    }
  }

  return winner;
}

async function runBenchmarks() {
  const scenarios = [];

  // Scenario 1: Small workload (3 tasks)
  scenarios.push(await benchmarkScenario(
    'Small Workload (3 tasks)',
    createTasks(3, { baseDelay: 20, variance: 10 })
  ));

  // Scenario 2: Medium workload (10 tasks)
  scenarios.push(await benchmarkScenario(
    'Medium Workload (10 tasks)',
    createTasks(10, { baseDelay: 15, variance: 10 })
  ));

  // Scenario 3: Large workload (50 tasks)
  scenarios.push(await benchmarkScenario(
    'Large Workload (50 tasks)',
    createTasks(50, { baseDelay: 10, variance: 5 })
  ));

  // Scenario 4: Sequential dependencies
  scenarios.push(await benchmarkScenario(
    'Sequential Dependencies (5 tasks)',
    createTasks(5, { baseDelay: 20, variance: 5, sequential: true })
  ));

  // Scenario 5: Heterogeneous tasks
  scenarios.push(await benchmarkScenario(
    'Heterogeneous Tasks (15 tasks)',
    createTasks(15, { baseDelay: 15, variance: 15, heterogeneous: true })
  ));

  // Scenario 6: With failures (10% failure rate)
  scenarios.push(await benchmarkScenario(
    'With Failures (20 tasks, 10% fail rate)',
    createTasks(20, { baseDelay: 10, variance: 5, failureRate: 0.1 })
  ));

  // Generate summary report
  generateSummaryReport(scenarios);
}

function generateSummaryReport(scenarios) {
  console.log('\n\n' + '='.repeat(70));
  console.log('📈 BENCHMARK SUMMARY REPORT');
  console.log('='.repeat(70) + '\n');

  // Count wins per topology
  const wins = {
    sequential: 0,
    mesh: 0,
    hierarchical: 0,
    adaptive: 0,
    gossip: 0
  };

  console.log('Scenario Results:\n');
  scenarios.forEach((scenario, i) => {
    console.log(`${i + 1}. ${scenario.name}`);
    console.log(`   Winner: ${scenario.winner.topology} (${scenario.winner.duration}ms)`);
    wins[scenario.winner.topology]++;
  });

  console.log('\n' + '─'.repeat(70));
  console.log('Overall Topology Rankings:\n');

  const rankings = Object.entries(wins)
    .sort(([, a], [, b]) => b - a)
    .map(([topology, count], i) => ({
      rank: i + 1,
      topology,
      wins: count,
      winRate: (count / scenarios.length) * 100
    }));

  rankings.forEach(r => {
    console.log(`${r.rank}. ${r.topology.toUpperCase()}: ${r.wins} wins (${r.winRate.toFixed(1)}%)`);
  });

  console.log('\n' + '─'.repeat(70));
  console.log('Recommended Topology by Use Case:\n');

  console.log('✅ Small workloads (< 5 tasks):');
  const smallWinner = scenarios[0].winner;
  console.log(`   → ${smallWinner.topology} (${smallWinner.duration}ms)\n`);

  console.log('✅ Medium workloads (5-20 tasks):');
  const mediumWinner = scenarios[1].winner;
  console.log(`   → ${mediumWinner.topology} (${mediumWinner.duration}ms)\n`);

  console.log('✅ Large workloads (20+ tasks):');
  const largeWinner = scenarios[2].winner;
  console.log(`   → ${largeWinner.topology} (${largeWinner.duration}ms)\n`);

  console.log('✅ Sequential dependencies:');
  const seqWinner = scenarios[3].winner;
  console.log(`   → ${seqWinner.topology} (${seqWinner.duration}ms)\n`);

  console.log('✅ Heterogeneous tasks:');
  const hetWinner = scenarios[4].winner;
  console.log(`   → ${hetWinner.topology} (${hetWinner.duration}ms)\n`);

  console.log('✅ Fault tolerance (with failures):');
  const faultWinner = scenarios[5].winner;
  console.log(`   → ${faultWinner.topology} (${faultWinner.duration}ms)\n`);

  console.log('='.repeat(70));

  // Performance characteristics
  console.log('\n📊 Performance Characteristics:\n');

  // Calculate average performance for each topology across all scenarios
  const avgPerformance = {};
  const topologies = ['sequential', 'mesh', 'hierarchical', 'adaptive', 'gossip'];

  for (const topology of topologies) {
    let totalDuration = 0;
    let totalSuccess = 0;
    let count = 0;

    for (const scenario of scenarios) {
      const result = scenario.results[topology];
      if (result && result.success) {
        totalDuration += result.duration;
        totalSuccess += result.successRate;
        count++;
      }
    }

    avgPerformance[topology] = {
      avgDuration: count > 0 ? totalDuration / count : 0,
      avgSuccessRate: count > 0 ? totalSuccess / count : 0,
      count
    };
  }

  // Sort by average duration (fastest first)
  const perfRankings = Object.entries(avgPerformance)
    .filter(([, perf]) => perf.count > 0)
    .sort(([, a], [, b]) => a.avgDuration - b.avgDuration);

  perfRankings.forEach(([topology, perf], i) => {
    console.log(`${i + 1}. ${topology.toUpperCase()}`);
    console.log(`   Avg Duration: ${perf.avgDuration.toFixed(1)}ms`);
    console.log(`   Avg Success: ${(perf.avgSuccessRate * 100).toFixed(1)}%`);
    console.log(`   Scenarios: ${perf.count}/${scenarios.length}\n`);
  });

  console.log('='.repeat(70) + '\n');
}

// Run benchmarks
runBenchmarks().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
