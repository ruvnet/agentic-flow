/**
 * Demonstrates learning improvement over time
 * Shows how the system gets better with more trajectories
 */

import { SelfImprovingCodegen } from '../src/index.js';

async function demonstrateLearning() {
  console.log('📚 Learning Improvement Demonstration\n');
  console.log('This shows how the system improves with experience\n');

  const codegen = new SelfImprovingCodegen({
    enableLearning: true,
    minConfidence: 0.5
  });

  // Task: Generate REST API endpoints
  const tasks = [
    'Create a GET endpoint for users',
    'Create a POST endpoint for users',
    'Create a PUT endpoint for users',
    'Create a DELETE endpoint for users',
    'Create a GET endpoint for products',
    'Create a POST endpoint for products',
    'Create a GET endpoint for orders',
    'Create a POST endpoint for orders'
  ];

  console.log('Phase 1: Initial Learning (First 4 tasks)');
  console.log('═'.repeat(60));

  const phase1Results: number[] = [];

  for (let i = 0; i < 4; i++) {
    const result = await codegen.generateCode({
      prompt: tasks[i],
      language: 'typescript'
    });

    phase1Results.push(result.metrics.qualityScore);

    console.log(`\nTask ${i + 1}: ${tasks[i]}`);
    console.log(`Quality Score: ${(result.metrics.qualityScore * 100).toFixed(1)}%`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`Latency: ${result.latency}ms`);
    console.log(`Patterns Applied: ${result.patternsApplied.length}`);
  }

  const phase1Avg = phase1Results.reduce((a, b) => a + b, 0) / phase1Results.length;
  console.log(`\n📊 Phase 1 Average Quality: ${(phase1Avg * 100).toFixed(1)}%\n`);

  // Get statistics after first phase
  const midStats = await codegen.getStats();
  console.log(`Trajectories Stored: ${midStats.totalTrajectories}`);
  console.log(`Success Rate: ${(midStats.successRate * 100).toFixed(1)}%\n`);

  console.log('\nPhase 2: Improved Performance (Next 4 tasks)');
  console.log('═'.repeat(60));
  console.log('The system now has learned patterns from Phase 1\n');

  const phase2Results: number[] = [];

  for (let i = 4; i < 8; i++) {
    const result = await codegen.generateCode({
      prompt: tasks[i],
      language: 'typescript'
    });

    phase2Results.push(result.metrics.qualityScore);

    console.log(`\nTask ${i + 1}: ${tasks[i]}`);
    console.log(`Quality Score: ${(result.metrics.qualityScore * 100).toFixed(1)}%`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`Latency: ${result.latency}ms`);
    console.log(`Patterns Applied: ${result.patternsApplied.length}`);

    if (result.patternsApplied.length > 0) {
      console.log(`✓ Applied learned patterns: ${result.patternsApplied.join(', ')}`);
    }
  }

  const phase2Avg = phase2Results.reduce((a, b) => a + b, 0) / phase2Results.length;
  console.log(`\n📊 Phase 2 Average Quality: ${(phase2Avg * 100).toFixed(1)}%\n`);

  // Final statistics
  const finalStats = await codegen.getStats();

  console.log('\n' + '═'.repeat(60));
  console.log('📈 Learning Progress Summary');
  console.log('═'.repeat(60));

  console.log(`\nPhase 1 Average Quality: ${(phase1Avg * 100).toFixed(1)}%`);
  console.log(`Phase 2 Average Quality: ${(phase2Avg * 100).toFixed(1)}%`);

  const improvement = ((phase2Avg - phase1Avg) / phase1Avg) * 100;
  console.log(`\n🎯 Quality Improvement: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);

  console.log(`\nTotal Trajectories: ${finalStats.totalTrajectories}`);
  console.log(`Overall Success Rate: ${(finalStats.successRate * 100).toFixed(1)}%`);
  console.log(`Patterns Learned: ${finalStats.patternsLearned}`);
  console.log(`Average Latency: ${finalStats.avgLatency.toFixed(2)}ms`);

  if (finalStats.qualityImprovement > 0) {
    console.log(`\n✨ System Quality Trend: +${(finalStats.qualityImprovement * 100).toFixed(1)}% (improving)`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('Key Insights:');
  console.log('• The system learns patterns from successful generations');
  console.log('• Later tasks benefit from earlier learning');
  console.log('• Quality improves as more trajectories are stored');
  console.log('• Pattern matching reduces generation time');
  console.log('═'.repeat(60));
}

demonstrateLearning().catch(console.error);
