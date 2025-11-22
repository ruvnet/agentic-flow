#!/usr/bin/env node
/**
 * CI/CD Optimizer - Analyze and optimize workflows
 *
 * Usage:
 *   node src/optimizer.js [workflow-file]
 */

const { CICDVectorDB } = require('./vectordb');
const { WorkflowOrchestrator } = require('./orchestrator');

async function optimize() {
  const vectordb = new CICDVectorDB();
  await vectordb.initialize();

  console.log('\n🔍 CI/CD Workflow Optimizer\n');
  console.log('================================\n');

  const stats = await vectordb.getStats();
  console.log(`📊 Database Statistics:`);
  console.log(`   - Workflows: ${stats.workflows}`);
  console.log(`   - Metrics: ${stats.metrics}`);
  console.log(`   - Patterns: ${stats.patterns}`);
  console.log(`   - Total Entries: ${stats.totalSize}\n`);

  // Get sample optimization recommendations
  const sampleWorkflow = {
    name: 'test-workflow',
    steps: ['install', 'build', 'test', 'deploy'],
    duration: 300000
  };

  const recommendations = await vectordb.getOptimizations(sampleWorkflow);

  console.log(`💡 Sample Optimization Recommendations:\n`);

  if (recommendations.recommendations.length === 0) {
    console.log('   No recommendations available yet.');
    console.log('   Run some workflows to build the learning database.\n');
  } else {
    recommendations.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. [${rec.priority.toUpperCase()}] ${rec.message}`);
      console.log(`      Expected Improvement: ${rec.expectedImprovement}`);
      if (rec.steps) {
        console.log(`      Affected Steps: ${rec.steps.join(', ')}`);
      }
      console.log();
    });

    console.log(`   Confidence: ${(recommendations.confidence * 100).toFixed(1)}%`);
    console.log(`   Based on: ${recommendations.basedOn} similar workflows\n`);
  }

  await vectordb.cleanup();
}

if (require.main === module) {
  optimize().catch(error => {
    console.error('Optimization failed:', error);
    process.exit(1);
  });
}

module.exports = { optimize };
