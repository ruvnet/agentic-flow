/**
 * Basic usage example for Self-Improving Code Generation
 */

import { SelfImprovingCodegen } from '../src/index.js';

async function main() {
  console.log('🚀 Self-Improving Code Generation Example\n');

  // Initialize the code generator
  const codegen = new SelfImprovingCodegen({
    enableLearning: true,
    minConfidence: 0.5
  });

  // Example 1: Generate a TypeScript function
  console.log('Example 1: Generate TypeScript function');
  console.log('─'.repeat(50));

  const result1 = await codegen.generateCode({
    prompt: 'Create an async function to fetch user data from an API',
    language: 'typescript'
  });

  console.log('Generated Code:');
  console.log(result1.code);
  console.log(`\nConfidence: ${(result1.confidence * 100).toFixed(1)}%`);
  console.log(`Latency: ${result1.latency}ms`);
  console.log(`Quality Score: ${(result1.metrics.qualityScore * 100).toFixed(1)}%`);
  console.log(`Strategy: ${result1.strategy}`);

  // Example 2: Improve existing code
  console.log('\n\nExample 2: Improve existing code');
  console.log('─'.repeat(50));

  const existingCode = `
function processData(data) {
  return data.map(item => item.value);
}
  `.trim();

  const result2 = await codegen.improveCode(
    existingCode,
    'Add TypeScript types and error handling',
    'typescript'
  );

  console.log('Original Code:');
  console.log(existingCode);
  console.log('\nImproved Code:');
  console.log(result2.code);
  console.log(`\nConfidence: ${(result2.confidence * 100).toFixed(1)}%`);

  // Example 3: Generate Python code
  console.log('\n\nExample 3: Generate Python function');
  console.log('─'.repeat(50));

  const result3 = await codegen.generateCode({
    prompt: 'Create a function to calculate fibonacci numbers',
    language: 'python'
  });

  console.log('Generated Code:');
  console.log(result3.code);
  console.log(`\nConfidence: ${(result3.confidence * 100).toFixed(1)}%`);

  // Example 4: Check learning statistics
  console.log('\n\nLearning Statistics');
  console.log('─'.repeat(50));

  const stats = await codegen.getStats();
  console.log(`Total Generations: ${stats.totalTrajectories}`);
  console.log(`Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);
  console.log(`Patterns Learned: ${stats.patternsLearned}`);
  console.log(`Average Latency: ${stats.avgLatency.toFixed(2)}ms`);

  if (stats.qualityImprovement !== 0) {
    console.log(`Quality Improvement: ${(stats.qualityImprovement * 100).toFixed(1)}%`);
  }

  console.log('\n✨ Done!');
}

main().catch(console.error);
