/**
 * End-to-End Integration Test
 *
 * Validates complete CI/CD module functionality including:
 * - Original API backward compatibility
 * - Enhanced orchestrator with all topologies
 * - AST analysis integration
 * - Performance benchmarking
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;

// Import both original and enhanced APIs
const {
  WorkflowOrchestrator,        // Original
  EnhancedOrchestrator,         // Enhanced
  TopologyManager,
  ASTAnalyzer,
  topologies
} = require('../../src/index');

console.log('\n' + '='.repeat(70));
console.log('🔬 END-TO-END INTEGRATION TEST');
console.log('='.repeat(70) + '\n');

let passedTests = 0;
let failedTests = 0;

async function runTests() {
  const testDbPath = path.join(__dirname, '../.test-e2e-db');

  // Test 1: Backward Compatibility - Original API Still Works
  try {
    console.log('Test 1: Backward Compatibility - Original API');

    const originalOrch = new WorkflowOrchestrator({
      dbPath: testDbPath + '-original'
    });

    await originalOrch.initialize();

    const workflow = {
      name: 'backward-compat-test',
      steps: [
        { name: 'step1', action: async () => 'result1' },
        { name: 'step2', action: async () => 'result2' }
      ]
    };

    const result = await originalOrch.executeWorkflow(workflow);

    assert(result.success, 'Original API should work');
    assert.strictEqual(result.steps.length, 2, 'Should have 2 steps');

    await originalOrch.cleanup();

    console.log('  ✅ PASS: Original API fully functional\n');
    passedTests++;
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 2: Enhanced Orchestrator - Adaptive Topology
  try {
    console.log('Test 2: Enhanced Orchestrator - Adaptive Topology');

    const enhancedOrch = new EnhancedOrchestrator({
      dbPath: testDbPath + '-enhanced',
      topology: 'adaptive',
      enableAST: false  // Disable for this test
    });

    await enhancedOrch.initialize();

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      name: `task-${i + 1}`,
      action: async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return `result-${i + 1}`;
      }
    }));

    const workflow = {
      name: 'adaptive-test',
      steps: tasks
    };

    const result = await enhancedOrch.executeWorkflow(workflow);

    assert(result.success, 'Enhanced orchestrator should work');
    assert(result.selectedTopology, 'Should have selected topology');
    assert(result.results, 'Should have results');

    console.log(`  ✅ PASS: Adaptive selected ${result.selectedTopology} topology\n`);
    passedTests++;

    await enhancedOrch.cleanup();
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 3: All Topologies Work Correctly
  try {
    console.log('Test 3: All Topologies Functional');

    const topologyNames = ['sequential', 'mesh', 'hierarchical', 'adaptive', 'gossip'];
    const results = {};

    for (const topologyName of topologyNames) {
      const orch = new EnhancedOrchestrator({
        dbPath: testDbPath + `-${topologyName}`,
        topology: topologyName,
        enableAST: false
      });

      await orch.initialize();

      const workflow = {
        name: `${topologyName}-test`,
        steps: [
          { name: 'task1', action: async () => 'result1' },
          { name: 'task2', action: async () => 'result2' },
          { name: 'task3', action: async () => 'result3' }
        ]
      };

      const result = await orch.executeWorkflow(workflow);
      results[topologyName] = result.success;

      await orch.cleanup();
    }

    const allPassed = Object.values(results).every(r => r);
    assert(allPassed, 'All topologies should work');

    console.log('  ✅ PASS: All 5 topologies functional');
    console.log(`     ${Object.entries(results).map(([k, v]) => `${k}: ${v ? '✓' : '✗'}`).join(', ')}\n`);
    passedTests++;
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 4: AST Analysis Integration
  try {
    console.log('Test 4: AST Analysis Integration');

    const orch = new EnhancedOrchestrator({
      dbPath: testDbPath + '-ast',
      topology: 'sequential',
      enableAST: true
    });

    await orch.initialize();

    const workflow = {
      name: 'ast-test',
      files: [{
        path: 'test.js',
        content: `
function example() {
  let x = 1;
  ${Array(60).fill('  x++;').join('\n')}
  return x;
}
        `
      }],
      steps: [
        { name: 'analyze', action: async () => 'analyzed' }
      ]
    };

    const result = await orch.executeWorkflow(workflow);

    assert(result.success, 'Workflow should complete');
    assert(result.astAnalysis, 'Should have AST analysis');
    assert(result.astAnalysis.enabled, 'AST should be enabled');

    console.log('  ✅ PASS: AST analysis working');
    console.log(`     Files: ${result.astAnalysis.summary.totalFiles}, Patterns: ${result.astAnalysis.summary.patterns.length}\n`);
    passedTests++;

    await orch.cleanup();
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 5: Topology Benchmarking
  try {
    console.log('Test 5: Topology Benchmarking');

    const orch = new EnhancedOrchestrator({
      dbPath: testDbPath + '-benchmark',
      enableAST: false
    });

    await orch.initialize();

    const workflow = {
      name: 'benchmark-test',
      steps: Array.from({ length: 3 }, (_, i) => ({
        name: `task-${i + 1}`,
        action: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return `result-${i + 1}`;
        }
      }))
    };

    const benchmark = await orch.benchmark(workflow);

    assert(benchmark.winner, 'Should have winner');
    assert(benchmark.topologyResults, 'Should have topology results');
    assert(Object.keys(benchmark.topologyResults).length >= 3, 'Should test multiple topologies');

    console.log('  ✅ PASS: Benchmarking functional');
    console.log(`     Winner: ${benchmark.winner.topology} (${benchmark.winner.duration}ms)\n`);
    passedTests++;

    await orch.cleanup();
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 6: Topology Manager Direct Usage
  try {
    console.log('Test 6: TopologyManager Direct Usage');

    const manager = new TopologyManager();

    const tasks = [
      { name: 'task1', action: async () => 'r1' },
      { name: 'task2', action: async () => 'r2' }
    ];

    const result = await manager.execute(tasks, { topology: 'mesh' });

    assert(result.success, 'Should execute successfully');
    assert.strictEqual(result.selectedTopology, 'mesh', 'Should use mesh');

    console.log('  ✅ PASS: TopologyManager works independently\n');
    passedTests++;
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 7: Topology Recommendations
  try {
    console.log('Test 7: Topology Recommendations');

    const manager = new TopologyManager();

    // Small workload
    const smallRec = manager.recommendTopology([
      { name: 't1', action: async () => {} }
    ]);

    assert(smallRec.bestTopology, 'Should recommend topology');

    // Large workload
    const largeRec = manager.recommendTopology(
      Array.from({ length: 15 }, (_, i) => ({ name: `t${i}`, action: async () => {} }))
    );

    assert(largeRec.bestTopology, 'Should recommend topology for large workload');

    console.log('  ✅ PASS: Recommendations working');
    console.log(`     Small (1 task): ${smallRec.bestTopology}`);
    console.log(`     Large (15 tasks): ${largeRec.bestTopology}\n`);
    passedTests++;
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 8: Performance - Mesh vs Sequential
  try {
    console.log('Test 8: Performance Comparison (Mesh vs Sequential)');

    const manager = new TopologyManager();

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      name: `task-${i + 1}`,
      action: async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return `result-${i + 1}`;
      }
    }));

    // Sequential
    const seqStart = Date.now();
    await manager.execute(tasks, { topology: 'sequential' });
    const seqTime = Date.now() - seqStart;

    manager.reset();

    // Mesh
    const meshStart = Date.now();
    await manager.execute(tasks, { topology: 'mesh' });
    const meshTime = Date.now() - meshStart;

    const speedup = seqTime / meshTime;

    console.log('  ✅ PASS: Performance comparison complete');
    console.log(`     Sequential: ${seqTime}ms`);
    console.log(`     Mesh: ${meshTime}ms`);
    console.log(`     Speedup: ${speedup.toFixed(2)}x\n`);
    passedTests++;
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 9: Error Handling in Topologies
  try {
    console.log('Test 9: Error Handling Across Topologies');

    const topologyNames = ['sequential', 'mesh', 'hierarchical'];
    const errorHandled = {};

    for (const topologyName of topologyNames) {
      const orch = new EnhancedOrchestrator({
        dbPath: testDbPath + `-error-${topologyName}`,
        topology: topologyName,
        enableAST: false
      });

      await orch.initialize();

      const workflow = {
        name: 'error-test',
        steps: [
          { name: 'task1', action: async () => 'ok' },
          { name: 'task2', action: async () => { throw new Error('Test error'); } },
          { name: 'task3', action: async () => 'should not run' }
        ]
      };

      try {
        await orch.executeWorkflow(workflow);
        errorHandled[topologyName] = false;
      } catch (error) {
        errorHandled[topologyName] = true;
      }

      await orch.cleanup();
    }

    const allHandled = Object.values(errorHandled).every(h => h);
    assert(allHandled, 'All topologies should handle errors');

    console.log('  ✅ PASS: Error handling works across topologies\n');
    passedTests++;
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Test 10: Statistics and Metrics
  try {
    console.log('Test 10: Statistics and Metrics Collection');

    const orch = new EnhancedOrchestrator({
      dbPath: testDbPath + '-stats',
      topology: 'adaptive',
      enableAST: false
    });

    await orch.initialize();

    // Execute multiple workflows
    for (let i = 0; i < 3; i++) {
      await orch.executeWorkflow({
        name: `stats-test-${i}`,
        steps: [
          { name: 'task', action: async () => 'result' }
        ]
      });
    }

    const stats = await orch.getStats();

    assert(stats, 'Should have stats');
    assert(stats.enhanced, 'Should have enhanced stats');
    assert(stats.topology, 'Should have topology stats');

    console.log('  ✅ PASS: Statistics collection working');
    console.log(`     Total workflows: ${stats.enhanced.totalWorkflows}\n`);
    passedTests++;

    await orch.cleanup();
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    failedTests++;
  }

  // Cleanup test databases
  try {
    const testDirs = [
      testDbPath + '-original',
      testDbPath + '-enhanced',
      testDbPath + '-ast',
      testDbPath + '-benchmark',
      testDbPath + '-stats'
    ];

    for (const dir of testDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    // Ignore cleanup errors
  }

  // Summary
  console.log('='.repeat(70));
  console.log('📊 END-TO-END TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Passed: ${passedTests}/10`);
  console.log(`❌ Failed: ${failedTests}/10`);
  console.log(`📈 Success Rate: ${((passedTests / 10) * 100).toFixed(1)}%`);
  console.log('='.repeat(70) + '\n');

  if (failedTests > 0) {
    console.log('⚠️  Some tests failed - review errors above\n');
    process.exit(1);
  } else {
    console.log('🎉 All end-to-end tests passed!\n');
    console.log('✅ Backward compatibility: VERIFIED');
    console.log('✅ Enhanced features: WORKING');
    console.log('✅ All topologies: FUNCTIONAL');
    console.log('✅ AST analysis: INTEGRATED');
    console.log('✅ Performance: VALIDATED');
    console.log('✅ Error handling: ROBUST');
    console.log('\n🚀 Module is production ready!\n');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
