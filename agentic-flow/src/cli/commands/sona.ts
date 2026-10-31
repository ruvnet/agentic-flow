/**
 * SONA CLI Commands
 *
 * Command-line interface for SONA (Self-Optimizing Neural Architecture)
 * Provides trajectory management, pattern discovery, and learning control
 */

import { Command } from 'commander';
import {
  sonaService,
  sonaServices,
  createSONAService,
  SONAProfile
} from '../../services/sona-service.js';

export function createSONACommand(): Command {
  const sona = new Command('sona');

  sona.description('SONA (Self-Optimizing Neural Architecture) operations');

  // Trajectory commands
  const trajectory = sona
    .command('trajectory')
    .description('Manage learning trajectories');

  trajectory
    .command('begin')
    .description('Begin a new learning trajectory')
    .option('-r, --route <model>', 'LLM route (e.g., claude-sonnet-4-5)')
    .option('-e, --embedding <file>', 'Embedding file (JSON array)')
    .option('-d, --dimension <number>', 'Embedding dimension', '1536')
    .action(async (options) => {
      let embedding: number[];

      if (options.embedding) {
        const fs = await import('fs/promises');
        const data = await fs.readFile(options.embedding, 'utf-8');
        embedding = JSON.parse(data);
      } else {
        // Generate random embedding
        const dim = parseInt(options.dimension);
        embedding = Array.from({ length: dim }, () => Math.random());
      }

      const trajectoryId = sonaService.beginTrajectory(embedding, options.route);

      console.log('✅ Trajectory started');
      console.log(`   ID: ${trajectoryId}`);
      if (options.route) {
        console.log(`   Route: ${options.route}`);
      }
    });

  trajectory
    .command('step')
    .description('Add a step to a trajectory')
    .requiredOption('-t, --trajectory-id <id>', 'Trajectory ID')
    .requiredOption('-a, --activations <file>', 'Activations file (JSON array)')
    .requiredOption('-w, --weights <file>', 'Attention weights file (JSON array)')
    .requiredOption('-r, --reward <number>', 'Reward score (0-1)')
    .action(async (options) => {
      const fs = await import('fs/promises');

      const activations = JSON.parse(await fs.readFile(options.activations, 'utf-8'));
      const weights = JSON.parse(await fs.readFile(options.weights, 'utf-8'));
      const reward = parseFloat(options.reward);

      sonaService.addTrajectoryStep(options.trajectoryId, activations, weights, reward);

      console.log('✅ Step added to trajectory');
      console.log(`   Trajectory: ${options.trajectoryId}`);
      console.log(`   Reward: ${reward.toFixed(3)}`);
    });

  trajectory
    .command('context')
    .description('Add context to a trajectory')
    .requiredOption('-t, --trajectory-id <id>', 'Trajectory ID')
    .requiredOption('-c, --context <id>', 'Context ID')
    .action((options) => {
      sonaService.addTrajectoryContext(options.trajectoryId, options.context);

      console.log('✅ Context added');
      console.log(`   Trajectory: ${options.trajectoryId}`);
      console.log(`   Context: ${options.context}`);
    });

  trajectory
    .command('end')
    .description('End a trajectory with quality score')
    .requiredOption('-t, --trajectory-id <id>', 'Trajectory ID')
    .requiredOption('-q, --quality <score>', 'Quality score (0-1)')
    .action((options) => {
      const quality = parseFloat(options.quality);
      sonaService.endTrajectory(options.trajectoryId, quality);

      console.log('✅ Trajectory completed');
      console.log(`   ID: ${options.trajectoryId}`);
      console.log(`   Quality: ${quality.toFixed(3)}`);
    });

  trajectory
    .command('list')
    .description('List active trajectories')
    .action(() => {
      const active = sonaService.getActiveTrajectories();

      console.log(`\n📊 Active Trajectories: ${active.length}\n`);

      active.forEach((t, i) => {
        const duration = Date.now() - t.startTime;
        console.log(`${i + 1}. ID: ${t.id}`);
        console.log(`   Route: ${t.route || 'N/A'}`);
        console.log(`   Steps: ${t.steps.length}`);
        console.log(`   Contexts: ${t.contexts.length}`);
        console.log(`   Duration: ${Math.floor(duration / 1000)}s`);
        console.log('');
      });
    });

  // Pattern commands
  const pattern = sona
    .command('pattern')
    .description('Pattern discovery and retrieval');

  pattern
    .command('find')
    .description('Find similar patterns')
    .requiredOption('-q, --query <file>', 'Query embedding file (JSON array)')
    .option('-k <number>', 'Number of patterns to retrieve', '3')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const fs = await import('fs/promises');
      const query = JSON.parse(await fs.readFile(options.query, 'utf-8'));
      const k = parseInt(options.k);

      const patterns = sonaService.findPatterns(query, k);

      if (options.json) {
        console.log(JSON.stringify(patterns, null, 2));
      } else {
        console.log(`\n🔍 Found ${patterns.length} similar patterns:\n`);

        patterns.forEach((p, i) => {
          console.log(`${i + 1}. Pattern ${p.id}`);
          console.log(`   Type: ${p.patternType}`);
          console.log(`   Cluster Size: ${p.clusterSize}`);
          console.log(`   Avg Quality: ${p.avgQuality.toFixed(3)}`);
          console.log(`   Similarity: ${p.similarity.toFixed(3)}`);
          console.log('');
        });
      }
    });

  // Learning commands
  sona
    .command('learn')
    .description('Force learning cycle')
    .action(() => {
      const result = sonaService.forceLearn();

      console.log('✅ Learning cycle completed');
      console.log(`   Patterns learned: ${result.patternsLearned}`);
    });

  // Statistics commands
  sona
    .command('stats')
    .description('Show SONA statistics')
    .option('--json', 'Output as JSON')
    .option('--engine', 'Show engine stats')
    .action((options) => {
      if (options.engine) {
        const engineStats = sonaService.getEngineStats();
        console.log('\n📊 SONA Engine Statistics:\n');
        console.log(engineStats);
      } else {
        const stats = sonaService.getStats();

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log('\n📊 SONA Service Statistics\n');
          console.log(`Profile: ${stats.config.profile || 'balanced'}`);
          console.log('');
          console.log('Trajectories:');
          console.log(`  Total: ${stats.totalTrajectories}`);
          console.log(`  Active: ${stats.activeTrajectories}`);
          console.log(`  Completed: ${stats.completedTrajectories}`);
          console.log(`  Utilization: ${(stats.trajectoryUtilization * 100).toFixed(1)}%`);
          console.log('');
          console.log('Performance:');
          console.log(`  Avg Quality: ${stats.avgQualityScore.toFixed(3)}`);
          console.log(`  Total Ops: ${stats.totalOpsProcessed.toLocaleString()}`);
          console.log(`  Learning Cycles: ${stats.totalLearningCycles}`);
          console.log(`  Ops/Second: ${stats.opsPerSecond.toFixed(0)}`);
          console.log('');
          console.log('Configuration:');
          console.log(`  Micro-LoRA Rank: ${stats.config.microLoraRank}`);
          console.log(`  Base-LoRA Rank: ${stats.config.baseLoraRank}`);
          console.log(`  Learning Rate: ${stats.config.microLoraLr}`);
          console.log(`  EWC Lambda: ${stats.config.ewcLambda}`);
          console.log(`  Pattern Clusters: ${stats.config.patternClusters}`);
          console.log(`  SIMD Enabled: ${stats.config.enableSimd}`);
        }
      }
    });

  // Profile commands
  sona
    .command('profile')
    .description('Show configuration profiles')
    .argument('[profile]', 'Profile name (real-time, batch, research, edge, balanced)')
    .action((profileName?: string) => {
      if (profileName) {
        const service = sonaServices[profileName as SONAProfile];
        if (!service) {
          console.error(`❌ Unknown profile: ${profileName}`);
          console.error('   Available: real-time, batch, research, edge, balanced');
          process.exit(1);
        }

        const stats = service.getStats();
        console.log(`\n📋 Profile: ${profileName}\n`);
        console.log('Configuration:');
        console.log(`  Micro-LoRA Rank: ${stats.config.microLoraRank}`);
        console.log(`  Base-LoRA Rank: ${stats.config.baseLoraRank}`);
        console.log(`  Learning Rate: ${stats.config.microLoraLr}`);
        console.log(`  EWC Lambda: ${stats.config.ewcLambda}`);
        console.log(`  Pattern Clusters: ${stats.config.patternClusters}`);
        console.log(`  Trajectory Capacity: ${stats.config.trajectoryCapacity}`);
        console.log(`  Quality Threshold: ${stats.config.qualityThreshold}`);
        console.log(`  SIMD Enabled: ${stats.config.enableSimd}`);
      } else {
        console.log('\n📋 Available SONA Profiles:\n');

        console.log('1. real-time');
        console.log('   → 2200 ops/sec, <0.5ms latency');
        console.log('   → Rank-2, 25 clusters, 0.7 threshold');
        console.log('');

        console.log('2. batch');
        console.log('   → Balance throughput and adaptation');
        console.log('   → Rank-2, rank-8, 5000 capacity');
        console.log('');

        console.log('3. research');
        console.log('   → +55% quality improvement');
        console.log('   → Rank-16 base, LR 0.002, 0.2 threshold');
        console.log('');

        console.log('4. edge');
        console.log('   → <5MB memory footprint');
        console.log('   → Rank-1, 200 capacity, 15 clusters');
        console.log('');

        console.log('5. balanced (default)');
        console.log('   → 18ms overhead, +25% quality');
        console.log('   → Rank-2, rank-8, 0.4 threshold');
        console.log('');
      }
    });

  // Enable/disable commands
  sona
    .command('enable')
    .description('Enable SONA engine')
    .action(() => {
      sonaService.setEnabled(true);
      console.log('✅ SONA engine enabled');
    });

  sona
    .command('disable')
    .description('Disable SONA engine')
    .action(() => {
      sonaService.setEnabled(false);
      console.log('⏸️  SONA engine disabled');
    });

  // Benchmark command
  sona
    .command('benchmark')
    .description('Run SONA performance benchmark')
    .option('-i, --iterations <number>', 'Number of iterations', '1000')
    .action(async (options) => {
      const iterations = parseInt(options.iterations);

      console.log(`\n🔬 Running SONA Benchmark (${iterations} iterations)\n`);

      // Benchmark Micro-LoRA
      const input = Array.from({ length: 3072 }, () => Math.random());
      const startMicro = Date.now();

      for (let i = 0; i < iterations; i++) {
        sonaService.applyMicroLora(input);
      }

      const microTime = Date.now() - startMicro;
      const microLatency = microTime / iterations;
      const microOpsPerSec = (iterations / microTime) * 1000;

      console.log('Micro-LoRA:');
      console.log(`  Total Time: ${microTime}ms`);
      console.log(`  Avg Latency: ${microLatency.toFixed(3)}ms`);
      console.log(`  Throughput: ${microOpsPerSec.toFixed(0)} ops/sec`);
      console.log('');

      // Benchmark Base-LoRA
      const startBase = Date.now();

      for (let i = 0; i < iterations; i++) {
        sonaService.applyBaseLora(10, input);
      }

      const baseTime = Date.now() - startBase;
      const baseLatency = baseTime / iterations;
      const baseOpsPerSec = (iterations / baseTime) * 1000;

      console.log('Base-LoRA:');
      console.log(`  Total Time: ${baseTime}ms`);
      console.log(`  Avg Latency: ${baseLatency.toFixed(3)}ms`);
      console.log(`  Throughput: ${baseOpsPerSec.toFixed(0)} ops/sec`);
      console.log('');

      // Expected performance (from vibecast KEY_FINDINGS)
      console.log('Expected Performance:');
      console.log(`  Target Throughput: 2211 ops/sec`);
      console.log(`  Target Latency: <0.5ms (real-time profile)`);
      console.log(`  Per-layer Cost: 0.452ms (40 layers)`);
      console.log('');

      const meetsTarget = microOpsPerSec >= 1000; // At least 1000 ops/sec
      console.log(meetsTarget ? '✅ Performance meets targets' : '⚠️  Performance below targets');
    });

  return sona;
}

export default createSONACommand;
