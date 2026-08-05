/**
 * Example: Data Processing Pipeline with Ephemeral Agents
 *
 * This example demonstrates:
 * - Sequential data processing stages
 * - Memory sharing between pipeline stages
 * - Resource optimization for batch processing
 */

import { EphemeralAgentManager } from '../src/index.js';

interface DataBatch {
  id: string;
  records: any[];
  stage: string;
}

async function main() {
  console.log('🔄 Starting Data Processing Pipeline...\n');

  const manager = new EphemeralAgentManager({
    tenantId: 'pipeline',
    dbPath: './pipeline-memory.db'
  });

  // Generate sample data
  const rawData: DataBatch = {
    id: 'batch-001',
    records: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      value: Math.random() * 100
    })),
    stage: 'raw'
  };

  console.log(`📦 Processing ${rawData.records.length} records...\n`);

  // Stage 1: Validation
  console.log('1️⃣  Stage 1: Validation');
  const validated = await manager.executeTask(
    'validator',
    {
      id: 'validate-001',
      type: 'validation',
      description: 'Validate data'
    },
    async (context) => {
      const valid = rawData.records.filter(r => r.value > 10);

      // Store validation results
      await context.memory.write(context.agent.id, 'validation-results', {
        total: rawData.records.length,
        valid: valid.length,
        invalid: rawData.records.length - valid.length
      });

      return { ...rawData, records: valid, stage: 'validated' };
    }
  );

  console.log(`   ✅ Validated: ${validated.records.length}/${rawData.records.length} records\n`);

  // Stage 2: Transformation
  console.log('2️⃣  Stage 2: Transformation');
  const transformed = await manager.executeTask(
    'transformer',
    {
      id: 'transform-001',
      type: 'transformation',
      description: 'Transform data'
    },
    async (context) => {
      // Load validation stats from memory
      const validationStats = await context.memory.search('validation-results', 1);
      console.log(`   📊 Validation stats:`, validationStats[0]);

      const transformed = validated.records.map(r => ({
        id: r.id,
        value: r.value * 2, // Example transformation
        transformed: true
      }));

      return { ...validated, records: transformed, stage: 'transformed' };
    }
  );

  console.log(`   ✅ Transformed: ${transformed.records.length} records\n`);

  // Stage 3: Aggregation
  console.log('3️⃣  Stage 3: Aggregation');
  const aggregated = await manager.executeTask(
    'aggregator',
    {
      id: 'aggregate-001',
      type: 'aggregation',
      description: 'Aggregate data'
    },
    async (context) => {
      const sum = transformed.records.reduce((acc, r) => acc + r.value, 0);
      const avg = sum / transformed.records.length;
      const min = Math.min(...transformed.records.map(r => r.value));
      const max = Math.max(...transformed.records.map(r => r.value));

      const results = {
        batchId: transformed.id,
        count: transformed.records.length,
        sum,
        avg,
        min,
        max
      };

      // Store aggregation results
      await context.memory.write(context.agent.id, 'aggregation-results', results);

      return results;
    }
  );

  console.log('   ✅ Aggregation complete\n');
  console.log('📊 Final Results:');
  console.log(`   Count: ${aggregated.count}`);
  console.log(`   Sum: ${aggregated.sum.toFixed(2)}`);
  console.log(`   Avg: ${aggregated.avg.toFixed(2)}`);
  console.log(`   Min: ${aggregated.min.toFixed(2)}`);
  console.log(`   Max: ${aggregated.max.toFixed(2)}`);

  // Show resource efficiency
  console.log('\n💰 Resource Efficiency:');
  const stats = manager.getResourceStats();
  console.log(`   Savings: ${stats.costSavings.savingsPercent.toFixed(1)}%`);
  console.log(`   Uptime: ${stats.costSavings.uptimePercent.toFixed(1)}%`);

  await manager.shutdown();
  console.log('\n👋 Pipeline complete');
}

main().catch(console.error);
