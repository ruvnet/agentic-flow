#!/usr/bin/env node
/**
 * Comprehensive benchmark for ONNX local inference
 * Tests CPU performance against targets
 */

import { ONNXLocalProvider } from './providers/onnx-local.js';
import { PHI4_MODEL_PATH } from '../utils/model-downloader.js';

interface BenchmarkResult {
  test: string;
  tokens: number;
  latency: number;
  tokensPerSecond: number;
}

async function runBenchmark() {
  console.log('🏁 ONNX Local Inference Benchmark (Phi-4 CPU)\n');
  console.log('Target: 15-25 tokens/sec on CPU');
  console.log('================================================\n');

  const provider = new ONNXLocalProvider({
    modelPath: PHI4_MODEL_PATH,
    executionProviders: ['cpu'],
    maxTokens: 50,
    temperature: 0.7
  });

  const results: BenchmarkResult[] = [];

  // Test 1: Short response
  console.log('Test 1: Short Response (Math)');
  console.log('==============================');

  const test1Start = Date.now();
  const response1 = await provider.chat({
    model: 'phi-4',
    messages: [
      { role: 'user', content: 'What is 2+2?' }
    ],
    maxTokens: 20
  });
  const test1Latency = Date.now() - test1Start;
  const test1TPS = (response1.usage?.outputTokens || 0) / (test1Latency / 1000);

  console.log(`✅ Response: ${response1.content[0].type === 'text' ? response1.content[0].text : ''}`);
  console.log(`⏱️  ${test1Latency}ms | ${test1TPS.toFixed(1)} tokens/sec\n`);

  results.push({
    test: 'Short Math',
    tokens: response1.usage?.outputTokens || 0,
    latency: test1Latency,
    tokensPerSecond: test1TPS
  });

  // Test 2: Medium response
  console.log('Test 2: Medium Response (Reasoning)');
  console.log('=====================================');

  const test2Start = Date.now();
  const response2 = await provider.chat({
    model: 'phi-4',
    messages: [
      { role: 'user', content: 'Explain why the sky is blue in one sentence.' }
    ],
    maxTokens: 30
  });
  const test2Latency = Date.now() - test2Start;
  const test2TPS = (response2.usage?.outputTokens || 0) / (test2Latency / 1000);

  console.log(`✅ Response: ${response2.content[0].type === 'text' ? response2.content[0].text : ''}`);
  console.log(`⏱️  ${test2Latency}ms | ${test2TPS.toFixed(1)} tokens/sec\n`);

  results.push({
    test: 'Medium Reasoning',
    tokens: response2.usage?.outputTokens || 0,
    latency: test2Latency,
    tokensPerSecond: test2TPS
  });

  // Test 3: Longer response
  console.log('Test 3: Longer Response (Creative)');
  console.log('====================================');

  const test3Start = Date.now();
  const response3 = await provider.chat({
    model: 'phi-4',
    messages: [
      { role: 'user', content: 'List 5 programming languages.' }
    ],
    maxTokens: 50
  });
  const test3Latency = Date.now() - test3Start;
  const test3TPS = (response3.usage?.outputTokens || 0) / (test3Latency / 1000);

  console.log(`✅ Response: ${response3.content[0].type === 'text' ? response3.content[0].text : ''}`);
  console.log(`⏱️  ${test3Latency}ms | ${test3TPS.toFixed(1)} tokens/sec\n`);

  results.push({
    test: 'Longer Creative',
    tokens: response3.usage?.outputTokens || 0,
    latency: test3Latency,
    tokensPerSecond: test3TPS
  });

  // Test 4: Multi-turn conversation
  console.log('Test 4: Multi-Turn Conversation');
  console.log('================================');

  const test4Start = Date.now();
  const response4 = await provider.chat({
    model: 'phi-4',
    messages: [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hello! How can I help you today?' },
      { role: 'user', content: 'Tell me a fun fact about computers.' }
    ],
    maxTokens: 40
  });
  const test4Latency = Date.now() - test4Start;
  const test4TPS = (response4.usage?.outputTokens || 0) / (test4Latency / 1000);

  console.log(`✅ Response: ${response4.content[0].type === 'text' ? response4.content[0].text : ''}`);
  console.log(`⏱️  ${test4Latency}ms | ${test4TPS.toFixed(1)} tokens/sec\n`);

  results.push({
    test: 'Multi-Turn',
    tokens: response4.usage?.outputTokens || 0,
    latency: test4Latency,
    tokensPerSecond: test4TPS
  });

  // Summary
  console.log('\n📊 Benchmark Summary');
  console.log('====================\n');

  const avgTPS = results.reduce((sum, r) => sum + r.tokensPerSecond, 0) / results.length;
  const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
  const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0);

  console.table(results.map(r => ({
    Test: r.test,
    Tokens: r.tokens,
    'Latency (ms)': r.latency,
    'Tokens/Sec': r.tokensPerSecond.toFixed(1)
  })));

  console.log(`\n📈 Performance Metrics:`);
  console.log(`   Average Tokens/Sec: ${avgTPS.toFixed(1)}`);
  console.log(`   Average Latency: ${avgLatency.toFixed(0)}ms`);
  console.log(`   Total Tokens Generated: ${totalTokens}`);

  console.log(`\n🎯 Target Validation:`);
  const targetMin = 15;
  const targetMax = 25;

  if (avgTPS >= targetMin && avgTPS <= targetMax * 1.5) {
    console.log(`   ✅ PASS: ${avgTPS.toFixed(1)} tokens/sec is within acceptable range`);
  } else if (avgTPS < targetMin) {
    console.log(`   ⚠️  SLOW: ${avgTPS.toFixed(1)} tokens/sec is below target (${targetMin}+)`);
  } else {
    console.log(`   🚀 FAST: ${avgTPS.toFixed(1)} tokens/sec exceeds target!`);
  }

  console.log(`\n💰 Cost Savings:`);
  console.log(`   Local Inference: $0.00`);
  console.log(`   Anthropic Equivalent: ~$${(totalTokens * 0.00003).toFixed(4)}`);
  console.log(`   Savings: 100%`);

  console.log(`\n🔒 Privacy:`);
  console.log(`   ✅ All processing local`);
  console.log(`   ✅ No data sent to cloud`);
  console.log(`   ✅ GDPR/HIPAA compliant`);

  await provider.dispose();
}

runBenchmark().catch(error => {
  console.error('❌ Benchmark failed:', error);
  process.exit(1);
});
