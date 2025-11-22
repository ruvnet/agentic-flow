/**
 * Unit Tests for Coordination Topologies
 *
 * Tests all 5 coordination topologies:
 * - Sequential
 * - Mesh
 * - Hierarchical
 * - Adaptive
 * - Gossip
 */

const assert = require('assert');
const SequentialTopology = require('../../src/topologies/sequential');
const MeshTopology = require('../../src/topologies/mesh');
const HierarchicalTopology = require('../../src/topologies/hierarchical');
const AdaptiveTopology = require('../../src/topologies/adaptive');
const GossipTopology = require('../../src/topologies/gossip');
const TopologyManager = require('../../src/topology-manager');

console.log('\n🧪 Testing Coordination Topologies\n');

// Sample tasks for testing
function createTasks(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    name: `task-${i + 1}`,
    action: async (context) => {
      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20));
      return `Result from task-${i + 1}`;
    },
    type: 'test',
    priority: i < 2 ? 'high' : 'medium'
  }));
}

async function runTests() {
  let passedTests = 0;
  let failedTests = 0;

  // Test 1: Sequential Topology
  try {
    console.log('Test 1: Sequential Topology Execution');
    const sequential = new SequentialTopology();
    const tasks = createTasks(3);
    const result = await sequential.execute(tasks);

    assert(result.success, 'Sequential execution should succeed');
    assert.strictEqual(result.results.length, 3, 'Should have 3 results');
    assert(result.results.every(r => r.success), 'All tasks should succeed');
    assert(result.duration > 0, 'Should have duration');

    console.log('  ✅ Sequential topology works correctly');
    passedTests++;
  } catch (error) {
    console.log('  ❌ Sequential topology test failed:', error.message);
    failedTests++;
  }

  // Test 2: Mesh Topology
  try {
    console.log('\nTest 2: Mesh Topology with Peer Coordination');
    const mesh = new MeshTopology({ maxConcurrent: 5 });
    const tasks = createTasks(5);
    const result = await mesh.execute(tasks);

    assert(result.success, 'Mesh execution should succeed');
    assert.strictEqual(result.results.length, 5, 'Should have 5 results');
    assert(result.consensus, 'Should have consensus result');
    assert(result.consensus.successCount > 0, 'Should have successful tasks');

    console.log('  ✅ Mesh topology works correctly');
    console.log(`     Consensus: ${result.consensus.successCount}/${result.consensus.totalCount} (${result.consensus.percentage.toFixed(1)}%)`);
    passedTests++;
  } catch (error) {
    console.log('  ❌ Mesh topology test failed:', error.message);
    failedTests++;
  }

  // Test 3: Hierarchical Topology
  try {
    console.log('\nTest 3: Hierarchical (Queen-Led) Topology');
    const hierarchical = new HierarchicalTopology({ maxConcurrent: 3 });
    const tasks = createTasks(6);
    const result = await hierarchical.execute(tasks);

    assert(result.success, 'Hierarchical execution should succeed');
    assert.strictEqual(result.results.length, 6, 'Should have 6 results');
    assert(result.queenDecisions, 'Should have queen decisions');
    assert(result.queenDecisions.length > 0, 'Queen should make decisions');

    console.log('  ✅ Hierarchical topology works correctly');
    console.log(`     Queen decisions: ${result.queenDecisions.length}`);
    passedTests++;
  } catch (error) {
    console.log('  ❌ Hierarchical topology test failed:', error.message);
    failedTests++;
  }

  // Test 4: Adaptive Topology Selection
  try {
    console.log('\nTest 4: Adaptive Topology Selection');
    const adaptive = new AdaptiveTopology({ maxConcurrent: 5 });

    // Run multiple times to test adaptation
    const tasks1 = createTasks(2); // Should select sequential
    const result1 = await adaptive.execute(tasks1);

    assert(result1.success, 'Adaptive execution 1 should succeed');
    console.log(`     Run 1: Selected ${result1.selectedTopology} for 2 tasks`);

    const tasks2 = createTasks(8); // Should select different topology
    const result2 = await adaptive.execute(tasks2);

    assert(result2.success, 'Adaptive execution 2 should succeed');
    console.log(`     Run 2: Selected ${result2.selectedTopology} for 8 tasks`);

    // Check that adaptive learning is working
    const stats = adaptive.getStats();
    assert(stats.totalExecutions === 2, 'Should have 2 executions');

    console.log('  ✅ Adaptive topology works correctly');
    passedTests++;
  } catch (error) {
    console.log('  ❌ Adaptive topology test failed:', error.message);
    failedTests++;
  }

  // Test 5: Gossip Topology
  try {
    console.log('\nTest 5: Gossip-Based Coordination');
    const gossip = new GossipTopology({ maxConcurrent: 10, gossipFanout: 3 });
    const tasks = createTasks(10);
    const result = await gossip.execute(tasks);

    assert(result.success, 'Gossip execution should succeed');
    assert.strictEqual(result.results.length, 10, 'Should have 10 results');
    assert(result.convergenceTime >= 0, 'Should have convergence time');

    console.log('  ✅ Gossip topology works correctly');
    console.log(`     Convergence time: ${result.convergenceTime}ms`);
    passedTests++;
  } catch (error) {
    console.log('  ❌ Gossip topology test failed:', error.message);
    failedTests++;
  }

  // Test 6: Topology Manager - Execute with specific topology
  try {
    console.log('\nTest 6: Topology Manager - Topology Selection');
    const manager = new TopologyManager({ defaultTopology: 'sequential' });
    const tasks = createTasks(3);

    const result = await manager.execute(tasks, { topology: 'mesh' });

    assert(result.success, 'Manager execution should succeed');
    assert.strictEqual(result.selectedTopology, 'mesh', 'Should use mesh topology');

    console.log('  ✅ Topology manager works correctly');
    passedTests++;
  } catch (error) {
    console.log('  ❌ Topology manager test failed:', error.message);
    failedTests++;
  }

  // Test 7: Topology Recommendation
  try {
    console.log('\nTest 7: Topology Recommendation Engine');
    const manager = new TopologyManager();

    // Test 1: Few simple tasks → sequential
    const rec1 = manager.recommendTopology(createTasks(2));
    console.log(`     2 tasks → ${rec1.bestTopology}`);

    // Test 2: Many independent tasks → mesh
    const rec2 = manager.recommendTopology(createTasks(10));
    console.log(`     10 tasks → ${rec2.bestTopology}`);

    // Test 3: Tasks with dependencies → sequential
    const dependentTasks = createTasks(3);
    dependentTasks[1].dependencies = ['task-1'];
    dependentTasks[2].dependencies = ['task-2'];
    const rec3 = manager.recommendTopology(dependentTasks);
    console.log(`     3 dependent tasks → ${rec3.bestTopology}`);

    assert(rec1.bestTopology, 'Should recommend topology for case 1');
    assert(rec2.bestTopology, 'Should recommend topology for case 2');
    assert(rec3.bestTopology === 'sequential', 'Should recommend sequential for dependencies');

    console.log('  ✅ Topology recommendation works correctly');
    passedTests++;
  } catch (error) {
    console.log('  ❌ Topology recommendation test failed:', error.message);
    failedTests++;
  }

  // Test 8: Performance Tracking
  try {
    console.log('\nTest 8: Performance Tracking and Statistics');
    const manager = new TopologyManager();

    // Execute multiple times
    await manager.execute(createTasks(3), { topology: 'sequential' });
    await manager.execute(createTasks(5), { topology: 'mesh' });
    await manager.execute(createTasks(4), { topology: 'hierarchical' });

    const stats = manager.getStats();

    assert(stats.totalExecutions === 3, 'Should have 3 executions');
    assert(stats.topologyUsage.sequential === 1, 'Should track sequential usage');
    assert(stats.topologyUsage.mesh === 1, 'Should track mesh usage');
    assert(stats.topologyUsage.hierarchical === 1, 'Should track hierarchical usage');

    console.log('  ✅ Performance tracking works correctly');
    console.log(`     Most used: ${stats.mostUsedTopology}`);
    passedTests++;
  } catch (error) {
    console.log('  ❌ Performance tracking test failed:', error.message);
    failedTests++;
  }

  // Test 9: Error Handling in Topologies
  try {
    console.log('\nTest 9: Error Handling in Topologies');
    const sequential = new SequentialTopology({ continueOnError: false });

    const failingTasks = [
      {
        name: 'task-1',
        action: async () => 'Success'
      },
      {
        name: 'task-2',
        action: async () => {
          throw new Error('Intentional failure');
        }
      },
      {
        name: 'task-3',
        action: async () => 'Should not run'
      }
    ];

    const result = await sequential.execute(failingTasks);

    assert(!result.success, 'Should fail when task fails');
    assert(result.results.some(r => !r.success), 'Should have failed tasks');

    console.log('  ✅ Error handling works correctly');
    passedTests++;
  } catch (error) {
    console.log('  ❌ Error handling test failed:', error.message);
    failedTests++;
  }

  // Test 10: Topology Optimization Recommendations
  try {
    console.log('\nTest 10: Topology Optimization Recommendations');
    const mesh = new MeshTopology();

    // Execute to generate metrics
    await mesh.execute(createTasks(5));

    const optimization = await mesh.optimize({});

    assert(optimization.topology === 'mesh', 'Should return mesh optimization');
    assert(Array.isArray(optimization.recommendations), 'Should have recommendations');

    console.log('  ✅ Optimization recommendations work correctly');
    passedTests++;
  } catch (error) {
    console.log('  ❌ Optimization recommendations test failed:', error.message);
    failedTests++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passedTests}/10`);
  console.log(`❌ Failed: ${failedTests}/10`);
  console.log(`📈 Success Rate: ${((passedTests / 10) * 100).toFixed(1)}%`);
  console.log('='.repeat(60) + '\n');

  // Return result instead of exiting (for use by run-all-tests.js)
  if (failedTests > 0) {
    throw new Error(`${failedTests} topology tests failed`);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Test suite failed:', error.message);
      process.exit(1);
    });
}

// Export for use by run-all-tests.js
module.exports = { runTests };
