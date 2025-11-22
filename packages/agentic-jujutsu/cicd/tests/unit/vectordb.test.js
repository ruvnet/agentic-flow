#!/usr/bin/env node
/**
 * Unit Tests for CICDVectorDB
 */

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const { CICDVectorDB } = require('../../src/vectordb');

async function runTests() {
  console.log('\n🧪 Running VectorDB Unit Tests...\n');

  const testDbPath = path.join(__dirname, '../../.test-vectordb');
  let db;
  let passCount = 0;
  let failCount = 0;

  // Cleanup before tests
  try {
    await fs.rm(testDbPath, { recursive: true, force: true });
  } catch (err) {
    // Ignore
  }

  try {
    // Test 1: Initialization
    console.log('Test 1: VectorDB Initialization');
    db = new CICDVectorDB({ dbPath: testDbPath });
    await db.initialize();
    assert(db.initialized === true, 'DB should be initialized');
    console.log('  ✅ PASS: Initialization\n');
    passCount++;

    // Test 2: Store Workflow
    console.log('Test 2: Store Workflow');
    const workflowId = await db.storeWorkflow({
      name: 'test-workflow',
      duration: 5000,
      success: true,
      steps: ['build', 'test', 'deploy'],
      metrics: {
        cacheHits: 5,
        parallelJobs: 3
      }
    });
    assert(workflowId, 'Workflow ID should be returned');
    console.log(`  ✅ PASS: Stored workflow ${workflowId}\n`);
    passCount++;

    // Test 3: Store Multiple Workflows
    console.log('Test 3: Store Multiple Workflows');
    for (let i = 0; i < 5; i++) {
      await db.storeWorkflow({
        name: `workflow-${i}`,
        duration: 3000 + i * 1000,
        success: i % 2 === 0,
        steps: ['build', 'test'],
        metrics: {
          cacheHits: i * 2,
          coverage: 80 + i
        }
      });
    }
    const stats = await db.getStats();
    assert(stats.workflows >= 6, 'Should have at least 6 workflows');
    console.log(`  ✅ PASS: Stored ${stats.workflows} workflows\n`);
    passCount++;

    // Test 4: Query Similar Workflows
    console.log('Test 4: Query Similar Workflows');
    const similar = await db.querySimilar({
      metrics: {
        duration: 5000,
        steps: ['build', 'test']
      },
      limit: 3,
      threshold: 0.5
    });
    assert(Array.isArray(similar), 'Should return array');
    assert(similar.length > 0, 'Should find similar workflows');
    assert(similar[0].similarity >= 0.5, 'Similarity should be >= threshold');
    console.log(`  ✅ PASS: Found ${similar.length} similar workflows\n`);
    passCount++;

    // Test 5: Get Optimizations
    console.log('Test 5: Get Optimization Recommendations');
    const optimizations = await db.getOptimizations({
      name: 'test-workflow',
      duration: 5000,
      steps: ['build', 'test']
    });
    assert(optimizations, 'Should return optimizations');
    assert(typeof optimizations.confidence === 'number', 'Should have confidence score');
    assert(Array.isArray(optimizations.recommendations), 'Should have recommendations array');
    console.log(`  ✅ PASS: Got ${optimizations.recommendations.length} recommendations (confidence: ${(optimizations.confidence * 100).toFixed(1)}%)\n`);
    passCount++;

    // Test 6: Vector Similarity
    console.log('Test 6: Vector Similarity Calculation');
    const vecA = [1, 2, 3, 4, 5];
    const vecB = [1, 2, 3, 4, 5];
    const vecC = [5, 4, 3, 2, 1];

    const simAB = db.cosineSimilarity(vecA, vecB);
    const simAC = db.cosineSimilarity(vecA, vecC);

    assert(simAB === 1.0, 'Identical vectors should have similarity 1.0');
    assert(simAC < simAB, 'Different vectors should have lower similarity');
    console.log(`  ✅ PASS: Similarity calculations correct (AB: ${simAB}, AC: ${simAC.toFixed(2)})\n`);
    passCount++;

    // Test 7: Metrics Storage
    console.log('Test 7: Store and Retrieve Metrics');
    await db.storeMetrics(workflowId, {
      cpuUsage: 85,
      memoryUsage: 2048,
      diskIO: 1500
    });
    const metrics = await db.getMetrics(workflowId);
    assert(metrics.length > 0, 'Should have metrics');
    assert(metrics[0].cpuUsage === 85, 'Metrics should match');
    console.log(`  ✅ PASS: Stored and retrieved ${metrics.length} metric entries\n`);
    passCount++;

    // Test 8: Persistence (Save and Load)
    console.log('Test 8: Data Persistence');
    await db.saveToDisk();

    // Create new instance and load
    const db2 = new CICDVectorDB({ dbPath: testDbPath });
    await db2.initialize();
    const stats2 = await db2.getStats();

    assert(stats2.workflows === stats.workflows, 'Loaded workflows should match');
    console.log(`  ✅ PASS: Persisted ${stats2.workflows} workflows to disk\n`);
    passCount++;

    await db2.cleanup();

    // Test 9: Database Statistics
    console.log('Test 9: Database Statistics');
    const finalStats = await db.getStats();
    assert(finalStats.workflows > 0, 'Should have workflows');
    assert(finalStats.patterns >= 0, 'Should have patterns count');
    assert(finalStats.totalSize > 0, 'Should have total size');
    console.log(`  ✅ PASS: Stats - Workflows: ${finalStats.workflows}, Patterns: ${finalStats.patterns}, Size: ${finalStats.totalSize}\n`);
    passCount++;

    // Test 10: Cleanup
    console.log('Test 10: Cleanup Resources');
    await db.cleanup();
    assert(db.initialized === false, 'DB should be cleaned up');
    console.log('  ✅ PASS: Cleanup successful\n');
    passCount++;

  } catch (error) {
    console.error(`  ❌ FAIL: ${error.message}\n`);
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
  console.log(`\n📊 Test Results:`);
  console.log(`   Passed: ${passCount}/10`);
  console.log(`   Failed: ${failCount}/10`);
  console.log(`   Success Rate: ${(passCount / 10 * 100).toFixed(1)}%\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests };
