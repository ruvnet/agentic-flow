#!/usr/bin/env node

/**
 * Morph LLM Benchmark Script
 * Tests Morph API performance with small dataset
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MORPH_API_KEY = process.env.MORPH_API_KEY;
if (!MORPH_API_KEY) {
  console.error('Error: MORPH_API_KEY environment variable is required');
  process.exit(1);
}
const MODEL = 'morph-v3-fast'; // Using Morph's fast apply model (no prefix)

// Load test dataset
const datasetPath = path.join(__dirname, 'datasets', 'small-test-dataset.json');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

// Usage tracking
const usage = {
  applies_used: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_time_ms: 0,
  successful_tests: 0,
  failed_tests: 0,
  results: []
};

/**
 * Call Morph LLM API
 */
async function callMorphAPI(prompt) {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const requestBody = JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert code assistant. Analyze the code transformation request and provide the improved code. Return ONLY the transformed code without explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    const options = {
      hostname: 'api.morphllm.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MORPH_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const endTime = Date.now();
        const latency = endTime - startTime;

        try {
          if (res.statusCode !== 200) {
            resolve({
              success: false,
              error: `API Error: ${res.statusCode} - ${data}`,
              latency
            });
            return;
          }

          const parsed = JSON.parse(data);

          // Track usage
          usage.applies_used += 1;
          usage.input_tokens += parsed.usage?.prompt_tokens || 0;
          usage.output_tokens += parsed.usage?.completion_tokens || 0;
          usage.total_time_ms += latency;

          resolve({
            success: true,
            output: parsed.choices[0].message.content,
            latency,
            tokens: {
              input: parsed.usage?.prompt_tokens || 0,
              output: parsed.usage?.completion_tokens || 0
            }
          });
        } catch (error) {
          resolve({
            success: false,
            error: `Parse error: ${error.message}`,
            latency
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
        latency: Date.now() - startTime
      });
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Run benchmark on single test case
 */
async function runTest(testCase) {
  console.log(`\n🧪 Running test ${testCase.id}: ${testCase.description}`);

  const prompt = `Task: ${testCase.description}\n\nInput code:\n${testCase.input}\n\nProvide the transformed code:`;

  const result = await callMorphAPI(prompt);

  if (result.success) {
    console.log(`✅ Success - Latency: ${result.latency}ms, Tokens: ${result.tokens.input}+${result.tokens.output}`);
    usage.successful_tests += 1;
  } else {
    console.log(`❌ Failed - ${result.error}`);
    usage.failed_tests += 1;
  }

  usage.results.push({
    test_id: testCase.id,
    description: testCase.description,
    category: testCase.category,
    ...result
  });

  return result;
}

/**
 * Main benchmark execution
 */
async function runBenchmark() {
  console.log('🚀 Starting Morph LLM Benchmark');
  console.log(`📊 Test cases: ${dataset.length}`);
  console.log(`🔑 Model: ${MODEL}`);
  console.log('=' .repeat(60));

  const benchmarkStart = Date.now();

  // Run tests sequentially to avoid rate limits
  for (const testCase of dataset) {
    await runTest(testCase);

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if we're approaching limits
    if (usage.applies_used >= 450) {
      console.log('\n⚠️  Warning: Approaching apply limit, stopping benchmark');
      break;
    }
  }

  const benchmarkEnd = Date.now();
  usage.total_benchmark_time_ms = benchmarkEnd - benchmarkStart;

  // Calculate statistics
  const avgLatency = usage.total_time_ms / usage.applies_used;
  const remainingBudget = {
    applies: 500 - usage.applies_used,
    input_tokens: 300000 - usage.input_tokens,
    output_tokens: 100000 - usage.output_tokens
  };

  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    total_tests: dataset.length,
    successful_tests: usage.successful_tests,
    failed_tests: usage.failed_tests,
    performance: {
      total_time_ms: usage.total_benchmark_time_ms,
      avg_latency_ms: Math.round(avgLatency),
      total_api_time_ms: usage.total_time_ms
    },
    usage: {
      applies_used: usage.applies_used,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      remaining_budget: remainingBudget
    },
    results: usage.results
  };

  // Save results
  const resultsPath = path.join(__dirname, 'results', 'morph-baseline-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(report, null, 2));

  console.log('\n' + '=' .repeat(60));
  console.log('📈 BENCHMARK COMPLETE');
  console.log('=' .repeat(60));
  console.log(`✅ Successful: ${usage.successful_tests}/${dataset.length}`);
  console.log(`❌ Failed: ${usage.failed_tests}/${dataset.length}`);
  console.log(`⏱️  Average Latency: ${Math.round(avgLatency)}ms`);
  console.log(`📊 Total Time: ${Math.round(usage.total_benchmark_time_ms / 1000)}s`);
  console.log(`💰 Applies Used: ${usage.applies_used}/500`);
  console.log(`🔤 Input Tokens: ${usage.input_tokens}/300000`);
  console.log(`🔤 Output Tokens: ${usage.output_tokens}/100000`);
  console.log(`💾 Results saved to: ${resultsPath}`);
  console.log('=' .repeat(60));

  return report;
}

// Run benchmark
if (require.main === module) {
  runBenchmark()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Benchmark failed:', error);
      process.exit(1);
    });
}

module.exports = { runBenchmark };
