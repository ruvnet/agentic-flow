#!/usr/bin/env node
/**
 * Integration Tests for WorkflowOrchestrator
 */

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const { WorkflowOrchestrator } = require('../../src/orchestrator');
const { CICDVectorDB } = require('../../src/vectordb');

async function runTests() {
  console.log('\n🧪 Running Workflow Orchestrator Integration Tests...\n');

  const testDbPath = path.join(__dirname, '../../.test-integration-db');
  let orchestrator;
  let passCount = 0;
  let failCount = 0;

  // Cleanup before tests
  try {
    await fs.rm(testDbPath, { recursive: true, force: true });
  } catch (err) {
    // Ignore
  }

  try {
    // Test 1: Orchestrator Initialization
    console.log('Test 1: Orchestrator Initialization');
    orchestrator = new WorkflowOrchestrator({
      dbPath: testDbPath,
      enableLearning: true,
      enableQuantum: false, // Disable quantum for testing
      maxParallel: 3
    });
    await orchestrator.initialize();
    assert(orchestrator.initialized === true, 'Orchestrator should be initialized');
    console.log('  ✅ PASS: Orchestrator initialized\n');
    passCount++;

    // Test 2: Execute Simple Workflow
    console.log('Test 2: Execute Simple Workflow');
    const simpleWorkflow = {
      name: 'simple-test',
      steps: [
        { name: 'step1', action: async () => 'Step 1 completed' },
        { name: 'step2', action: async () => 'Step 2 completed' },
        { name: 'step3', action: async () => 'Step 3 completed' }
      ]
    };

    const result1 = await orchestrator.executeWorkflow(simpleWorkflow);
    assert(result1.success === true, 'Workflow should succeed');
    assert(result1.steps.length === 3, 'Should have 3 steps');
    assert(result1.duration > 0, 'Should have duration');
    console.log(`  ✅ PASS: Simple workflow completed in ${result1.duration}ms\n`);
    passCount++;

    // Test 3: Execute Workflow with Learning
    console.log('Test 3: Execute Workflow with Learning (Multiple Runs)');
    const learningWorkflow = {
      name: 'learning-test',
      steps: [
        { name: 'build', action: async () => 'Build completed' },
        { name: 'test', action: async () => 'Tests passed' },
        { name: 'deploy', action: async () => 'Deployed' }
      ],
      config: {
        cache: true
      }
    };

    // Run workflow 3 times to build learning data
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const result = await orchestrator.executeWorkflow(learningWorkflow);
      runs.push(result);
      assert(result.success === true, `Run ${i + 1} should succeed`);
    }

    console.log(`  ✅ PASS: Executed ${runs.length} learning runs\n`);
    passCount++;

    // Test 4: Get Optimizations After Learning
    console.log('Test 4: Get AI Optimizations');
    const db = orchestrator.vectordb;
    const optimizations = await db.getOptimizations({
      name: 'learning-test',
      steps: ['build', 'test', 'deploy'],
      duration: 5000
    });

    assert(optimizations, 'Should return optimizations');
    // Should have recommendations object even if no workflows match threshold
    assert(Array.isArray(optimizations.recommendations), 'Should have recommendations array');
    console.log(`  ✅ PASS: Got ${optimizations.recommendations.length} optimizations based on ${optimizations.basedOn} workflows (confidence: ${(optimizations.confidence * 100).toFixed(1)}%)\n`);
    passCount++;

    // Test 5: Failed Workflow Handling
    console.log('Test 5: Failed Workflow Handling');
    const failingWorkflow = {
      name: 'failing-test',
      steps: [
        { name: 'step1', action: async () => 'Success' },
        {
          name: 'step2',
          action: async () => {
            throw new Error('Simulated failure');
          }
        },
        { name: 'step3', action: async () => 'Should not run' }
      ]
    };

    try {
      await orchestrator.executeWorkflow(failingWorkflow);
      assert(false, 'Should have thrown error');
    } catch (error) {
      assert(error.message.includes('Step failed'), 'Should catch step failure');
      console.log(`  ✅ PASS: Failed workflow handled correctly: ${error.message}\n`);
      passCount++;
    }

    // Test 6: Parallel Execution
    console.log('Test 6: Parallel Step Execution');
    const parallelWorkflow = {
      name: 'parallel-test',
      steps: [
        { name: 'parallel1', action: async () => { await sleep(100); return 'P1'; } },
        { name: 'parallel2', action: async () => { await sleep(100); return 'P2'; } },
        { name: 'parallel3', action: async () => { await sleep(100); return 'P3'; } },
        { name: 'parallel4', action: async () => { await sleep(100); return 'P4'; } }
      ]
    };

    const startTime = Date.now();
    const parallelResult = await orchestrator.executeWorkflow(parallelWorkflow);
    const parallelDuration = Date.now() - startTime;

    assert(parallelResult.success === true, 'Parallel workflow should succeed');
    // With maxParallel=3, should be faster than sequential
    console.log(`  ✅ PASS: Parallel execution completed in ${parallelDuration}ms\n`);
    passCount++;

    // Test 7: Workflow Status
    console.log('Test 7: Get Workflow Status');
    const status = await orchestrator.getWorkflowStatus(result1.workflowId);
    assert(status.workflowId === result1.workflowId, 'Should match workflow ID');
    console.log(`  ✅ PASS: Retrieved status for workflow ${status.workflowId}\n`);
    passCount++;

    // Test 8: Orchestrator Statistics
    console.log('Test 8: Orchestrator Statistics');
    const stats = await orchestrator.getStats();
    assert(stats.database, 'Should have database stats');
    assert(stats.database.workflows > 0, 'Should have workflows in DB');
    console.log(`  ✅ PASS: Stats - ${stats.database.workflows} workflows, ${stats.database.patterns} patterns\n`);
    passCount++;

    // Test 9: Vector DB Integration
    console.log('Test 9: Vector DB Integration');
    // Query with meaningful metrics (vector uses duration, steps, etc., not name)
    const similar = await db.querySimilar({
      metrics: {
        duration: 1000,
        steps: 3,
        success: true
      },
      limit: 5,
      threshold: 0.3  // Lower threshold for broader matching
    });
    assert(similar.length > 0, 'Should find similar workflows');
    console.log(`  ✅ PASS: Found ${similar.length} similar workflows in vector DB\n`);
    passCount++;

    // Test 10: Cleanup
    console.log('Test 10: Cleanup Resources');
    await orchestrator.cleanup();
    assert(orchestrator.initialized === false, 'Should be cleaned up');
    console.log('  ✅ PASS: Cleanup successful\n');
    passCount++;

  } catch (error) {
    console.error(`  ❌ FAIL: ${error.message}`);
    console.error(error.stack);
    failCount++;
  } finally {
    // Final cleanup
    try {
      await fs.rm(testDbPath, { recursive: true, force: true });
    } catch (err) {
      // Ignore
    }
  }

  // Results
  console.log('='.repeat(50));
  console.log(`\n📊 Integration Test Results:`);
  console.log(`   Passed: ${passCount}/10`);
  console.log(`   Failed: ${failCount}/10`);
  console.log(`   Success Rate: ${(passCount / 10 * 100).toFixed(1)}%\n`);

  // Return result instead of exiting (for use by run-all-tests.js)
  if (failCount > 0) {
    throw new Error(`${failCount} integration tests failed`);
  }
}

// Helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Integration test suite failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runTests };
