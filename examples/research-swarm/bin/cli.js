#!/usr/bin/env node

/**
 * Research Swarm CLI
 * NPX-compatible command-line interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getJobs, getJobStatus, initDatabase, getDatabase } from '../lib/db-utils.js';
import { decomposeTask, validateSwarmConfig } from '../lib/swarm-decomposition.js';
import { executeSwarm } from '../lib/swarm-executor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('research-swarm')
  .description('Local SQLite-based research agent swarm with multi-perspective analysis')
  .version('1.2.4');

// Research command (v1.1.0: Swarm-by-default)
program
  .command('research')
  .description('Run a research task with multi-agent swarm (default) or single agent')
  .argument('<agent>', 'Agent name (e.g., researcher)')
  .argument('<task>', 'Research task description')
  .option('-d, --depth <number>', 'Research depth (1-10)', '5')
  .option('-t, --time <minutes>', 'Time budget in minutes', '120')
  .option('-f, --focus <mode>', 'Focus mode (narrow|balanced|broad)', 'balanced')
  .option('--anti-hallucination <level>', 'Anti-hallucination level (low|medium|high)', 'high')
  .option('--no-citations', 'Disable citation requirements')
  .option('--no-ed2551', 'Disable ED2551 enhanced mode')
  .option('--single-agent', 'Use single-agent mode (legacy behavior, default: swarm)')
  .option('--swarm-size <number>', 'Number of swarm agents (3-7)', '5')
  .option('--max-concurrent <number>', 'Max concurrent agents', '4')
  .option('--verbose', 'Verbose output from agents')
  .action(async (agent, task, options) => {
    try {
      const depth = parseInt(options.depth);
      const timeMinutes = parseInt(options.time);
      const swarmSize = parseInt(options.swarmSize);
      const maxConcurrent = parseInt(options.maxConcurrent);

      // v1.1.0: Swarm by default, unless --single-agent is specified
      if (options.singleAgent) {
        // Legacy single-agent mode
        console.log(chalk.bold.cyan('\n🔬 Research Swarm - Single Agent Mode (Legacy)\n'));
        const spinner = ora('Initializing research agent...').start();

        const env = {
          ...process.env,
          RESEARCH_DEPTH: depth.toString(),
          RESEARCH_TIME_BUDGET: timeMinutes.toString(),
          RESEARCH_FOCUS: options.focus,
          ANTI_HALLUCINATION_LEVEL: options.antiHallucination,
          CITATION_REQUIRED: options.citations ? 'true' : 'false',
          ED2551_MODE: options.ed2551 ? 'true' : 'false',
          SWARM_MODE: 'false'
        };

        const runnerPath = path.join(__dirname, '../run-researcher-local.js');

        const child = spawn('node', [runnerPath, agent, task], {
          env,
          stdio: 'inherit'
        });

        child.on('close', (code) => {
          if (code === 0) {
            spinner.succeed(chalk.green('Research completed successfully!'));
          } else {
            spinner.fail(chalk.red(`Research failed with exit code ${code}`));
          }
        });

      } else {
        // NEW v1.1.0: Swarm mode (default)
        console.log(chalk.bold.cyan('\n🔬 Research Swarm - Multi-Agent Mode\n'));

        // Decompose task into swarm agents
        const swarmAgents = decomposeTask(task, {
          depth,
          timeMinutes,
          focus: options.focus,
          swarmSize,
          enableED2551: options.ed2551,
          antiHallucination: options.antiHallucination
        });

        // Validate swarm configuration
        const validation = validateSwarmConfig(swarmAgents);
        if (!validation.valid) {
          console.error(chalk.red('\n❌ Invalid swarm configuration:'));
          validation.errors.forEach(err => console.error(chalk.red(`   • ${err}`)));
          process.exit(1);
        }

        if (validation.warnings.length > 0) {
          console.log(chalk.yellow('\n⚠️  Warnings:'));
          validation.warnings.forEach(warn => console.log(chalk.yellow(`   • ${warn}`)));
        }

        // Execute swarm
        const results = await executeSwarm(swarmAgents, {
          maxConcurrent,
          verbose: options.verbose
        });

        // Exit with appropriate code
        if (results.failed > 0) {
          process.exit(1);
        }
      }

    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      console.error(chalk.dim(error.stack));
      process.exit(1);
    }
  });

// List jobs command
program
  .command('list')
  .description('List research jobs')
  .option('-s, --status <status>', 'Filter by status')
  .option('-l, --limit <number>', 'Limit results', '20')
  .action((options) => {
    try {
      const jobs = getJobs({
        status: options.status,
        limit: parseInt(options.limit)
      });

      console.log(chalk.bold.cyan(`\n📋 Recent Jobs (${jobs.length}):\n`));

      if (jobs.length === 0) {
        console.log(chalk.yellow('   No jobs found.\n'));
      } else {
        jobs.forEach(job => {
          const statusIcon = job.status === 'completed' ? '✅' :
                            job.status === 'running' ? '🔄' :
                            job.status === 'failed' ? '❌' : '⏸️';
          
          const statusColor = job.status === 'completed' ? chalk.green :
                             job.status === 'running' ? chalk.yellow :
                             job.status === 'failed' ? chalk.red : chalk.gray;

          console.log(`${statusIcon} ${chalk.dim(job.id.substring(0, 8))} | ${chalk.cyan(job.agent)} | ${chalk.bold(job.progress + '%')} | ${statusColor(job.status)}`);
          console.log(chalk.dim(`   Task: ${job.task.substring(0, 60)}...`));
          console.log(chalk.dim(`   Created: ${job.created_at}\n`));
        });
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// View job command
program
  .command('view')
  .description('View job details')
  .argument('<job-id>', 'Job ID to view')
  .action((jobId) => {
    try {
      const job = getJobStatus(jobId);

      if (!job) {
        console.error(chalk.red(`Job not found: ${jobId}`));
        process.exit(1);
      }

      console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════════════╗'));
      console.log(chalk.bold.cyan('║                           JOB DETAILS                             ║'));
      console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════╝\n'));

      console.log(chalk.bold('🆔 ID:         ') + chalk.dim(job.id));
      console.log(chalk.bold('🤖 Agent:      ') + chalk.cyan(job.agent));
      console.log(chalk.bold('📋 Task:       ') + job.task);
      console.log(chalk.bold('📊 Status:     ') + (job.status === 'completed' ? chalk.green(job.status) : chalk.yellow(job.status)));
      console.log(chalk.bold('📈 Progress:   ') + chalk.bold(job.progress + '%'));
      console.log(chalk.bold('💬 Message:    ') + (job.current_message || 'N/A'));

      console.log(chalk.bold('\n⏱️  TIMING:'));
      console.log(chalk.dim(`   Created:    ${job.created_at}`));
      console.log(chalk.dim(`   Started:    ${job.started_at || 'N/A'}`));
      console.log(chalk.dim(`   Completed:  ${job.completed_at || 'N/A'}`));
      console.log(chalk.dim(`   Duration:   ${job.duration_seconds ? job.duration_seconds + 's' : 'N/A'}`));

      if (job.report_path) {
        console.log(chalk.bold('\n📄 REPORT:'));
        console.log(chalk.dim(`   Format:     ${job.report_format}`));
        console.log(chalk.dim(`   Path:       ${job.report_path}`));
        console.log(chalk.dim(`   Size:       ${job.report_content?.length || 0} chars`));
      }

      console.log('\n' + chalk.cyan('═'.repeat(71)) + '\n');

    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Init database command
program
  .command('init')
  .description('Initialize SQLite database')
  .action(() => {
    try {
      console.log(chalk.cyan('🔧 Initializing SQLite database...\n'));
      initDatabase();
      console.log(chalk.green('\n✅ Database ready!'));
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// MCP server command
program
  .command('mcp')
  .description('Start MCP server for research swarm tools')
  .option('-p, --port <number>', 'Server port', '3000')
  .action((options) => {
    console.log(chalk.cyan(`🌐 Starting MCP server on port ${options.port}...`));
    const mcpPath = path.join(__dirname, '../lib/mcp-server.js');
    const child = spawn('node', [mcpPath, '--port', options.port], {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      console.log(chalk.yellow(`MCP server exited with code ${code}`));
    });
  });

// Learning session command
program
  .command('learn')
  .description('Run AgentDB learning session (memory distillation & pattern associations)')
  .option('--min-patterns <number>', 'Minimum patterns required', '2')
  .action((options) => {
    console.log(chalk.cyan('\n🧠 Starting learning session...\n'));
    const learningScript = path.join(__dirname, '../scripts/learning-session.js');
    const args = ['--min-patterns=' + options.minPatterns];

    const child = spawn('node', [learningScript, ...args], {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✅ Learning session completed successfully!\n'));
      } else {
        console.log(chalk.red(`\n❌ Learning session failed with code ${code}\n`));
        process.exit(code);
      }
    });
  });

// Learning stats command
program
  .command('stats')
  .description('Show AgentDB learning statistics')
  .action(async () => {
    try {
      const { getLearningStats } = await import('../lib/reasoningbank-integration.js');
      const stats = getLearningStats();

      if (!stats) {
        console.error(chalk.red('Failed to retrieve learning stats'));
        process.exit(1);
      }

      console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════════════╗'));
      console.log(chalk.bold.cyan('║                    AGENTDB LEARNING STATS                          ║'));
      console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════╝\n'));

      console.log(chalk.bold('📊 Patterns:'));
      console.log(`   Total:      ${chalk.cyan(stats.total_patterns)}`);
      console.log(`   Successful: ${chalk.green(stats.successful_patterns)}`);
      console.log(`   Unique:     ${chalk.blue(stats.unique_tasks)}\n`);

      console.log(chalk.bold('🎯 Quality Metrics:'));
      console.log(`   Avg Reward:     ${chalk.yellow(stats.avg_reward?.toFixed(3) || 'N/A')}`);
      console.log(`   Avg Confidence: ${chalk.yellow(stats.avg_confidence?.toFixed(3) || 'N/A')}\n`);

      // Get table counts
      const db = getDatabase();
      const counts = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM learning_episodes) as episodes,
          (SELECT COUNT(*) FROM memory_distillations) as distillations,
          (SELECT COUNT(*) FROM pattern_associations) as associations,
          (SELECT COUNT(*) FROM vector_embeddings) as vectors
      `).get();
      db.close();

      console.log(chalk.bold('🧠 Learning Components:'));
      console.log(`   Episodes:       ${chalk.cyan(counts.episodes)}`);
      console.log(`   Distillations:  ${chalk.cyan(counts.distillations)}`);
      console.log(`   Associations:   ${chalk.cyan(counts.associations)}`);
      console.log(`   Vectors:        ${chalk.cyan(counts.vectors)}\n`);

    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Benchmark command
program
  .command('benchmark')
  .description('Run ReasoningBank performance benchmark')
  .option('--iterations <number>', 'Number of iterations', '10')
  .action((options) => {
    console.log(chalk.cyan(`\n⚡ Running ReasoningBank benchmark (${options.iterations} iterations)...\n`));
    const benchmarkScript = path.join(__dirname, '../scripts/benchmark.js');

    const child = spawn('node', [benchmarkScript, '--iterations=' + options.iterations], {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✅ Benchmark completed!\n'));
      } else {
        console.log(chalk.red(`\n❌ Benchmark failed with code ${code}\n`));
        process.exit(code);
      }
    });
  });

// Parallel swarm command
program
  .command('swarm')
  .description('Run parallel research swarm')
  .argument('<tasks...>', 'Research tasks (space-separated, quoted strings)')
  .option('-a, --agent <name>', 'Agent type', 'researcher')
  .option('-c, --concurrent <number>', 'Max concurrent tasks', '3')
  .action(async (tasks, options) => {
    console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║                    PARALLEL RESEARCH SWARM                         ║'));
    console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════╝\n'));

    console.log(chalk.cyan(`🐝 Spawning ${tasks.length} research agents (max ${options.concurrent} concurrent)...\n`));

    const { spawn } = await import('child_process');
    const maxConcurrent = parseInt(options.concurrent);
    const running = new Set();
    const results = [];

    for (const task of tasks) {
      // Wait if we're at max concurrency
      while (running.size >= maxConcurrent) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const jobPromise = new Promise((resolve) => {
        console.log(chalk.gray(`   ▶️  Starting: ${task.substring(0, 60)}...`));

        const child = spawn('node', [
          path.join(__dirname, '../run-researcher-local.js'),
          options.agent,
          task
        ], {
          stdio: 'pipe'
        });

        let output = '';
        child.stdout.on('data', (data) => output += data.toString());

        child.on('close', (code) => {
          const jobId = output.match(/Job ID:\s+([a-f0-9-]+)/)?.[1];
          results.push({ task, jobId, success: code === 0 });
          running.delete(jobPromise);

          if (code === 0) {
            console.log(chalk.green(`   ✅ Completed: ${task.substring(0, 50)}... (${jobId?.substring(0, 8)})`));
          } else {
            console.log(chalk.red(`   ❌ Failed: ${task.substring(0, 50)}...`));
          }

          resolve();
        });
      });

      running.add(jobPromise);
    }

    // Wait for all to complete
    await Promise.all([...running]);

    console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║                    SWARM COMPLETE                                  ║'));
    console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════╝\n'));

    const successful = results.filter(r => r.success).length;
    console.log(chalk.bold(`📊 Results: ${chalk.green(successful)}/${tasks.length} successful\n`));

    if (successful >= 2) {
      console.log(chalk.cyan('🧠 Running learning session to process new patterns...\n'));
      const learningScript = path.join(__dirname, '../scripts/learning-session.js');
      spawn('node', [learningScript], { stdio: 'inherit' });
    }
  });

// HNSW vector graph commands
program
  .command('hnsw:init')
  .description('Initialize HNSW vector graph index')
  .option('-M <number>', 'Connections per layer', '16')
  .option('--ef-construction <number>', 'Construction search depth', '200')
  .option('--max-layers <number>', 'Maximum graph layers', '5')
  .action(async (options) => {
    console.log(chalk.cyan('\n🔨 Initializing HNSW index...\n'));
    const { initializeHNSWIndex } = await import('../lib/agentdb-hnsw.js');

    try {
      const result = await initializeHNSWIndex({
        M: parseInt(options.M),
        efConstruction: parseInt(options.efConstruction),
        maxLayers: parseInt(options.maxLayers)
      });

      console.log(chalk.green(`✅ HNSW index initialized`));
      console.log(chalk.dim(`   M: ${result.M}`));
      console.log(chalk.dim(`   efConstruction: ${result.efConstruction}`));
      console.log(chalk.dim(`   maxLayers: ${result.maxLayers}\n`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('hnsw:build')
  .description('Build HNSW graph from existing vectors')
  .option('--batch-size <number>', 'Vectors per batch', '100')
  .action(async (options) => {
    console.log(chalk.cyan('\n🔨 Building HNSW graph...\n'));
    const { buildHNSWGraph } = await import('../lib/agentdb-hnsw.js');

    try {
      const result = await buildHNSWGraph({
        batchSize: parseInt(options.batchSize)
      });

      console.log(chalk.green(`\n✅ HNSW graph built successfully\n`));
      console.log(chalk.bold('📊 Graph Statistics:'));
      console.log(chalk.dim(`   Nodes:  ${result.stats.nodes}`));
      console.log(chalk.dim(`   Edges:  ${result.stats.edges}`));
      console.log(chalk.dim(`   Layers: ${result.stats.layers}\n`));
    } catch (error) {
      console.error(chalk.red(`\nError: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('hnsw:search')
  .description('Search HNSW graph for similar vectors')
  .argument('<query>', 'Search query text')
  .option('-k <number>', 'Number of results', '5')
  .option('--ef <number>', 'Search depth', '50')
  .option('--source-type <type>', 'Filter by source type')
  .action(async (query, options) => {
    console.log(chalk.cyan(`\n🔍 Searching for: "${query}"\n`));
    const { searchSimilarVectors } = await import('../lib/agentdb-hnsw.js');

    try {
      const results = await searchSimilarVectors(query, {
        k: parseInt(options.k),
        ef: parseInt(options.ef),
        sourceType: options.sourceType
      });

      if (results.length === 0) {
        console.log(chalk.yellow('No results found.\n'));
        return;
      }

      console.log(chalk.bold.cyan(`📋 Top ${results.length} Results:\n`));
      results.forEach((result, i) => {
        console.log(chalk.bold(`${i + 1}. ${result.content_text?.substring(0, 80) || 'N/A'}...`));
        console.log(chalk.dim(`   Similarity: ${(result.similarity_score || 0).toFixed(3)}`));
        console.log(chalk.dim(`   Source: ${result.source_type} | ID: ${result.source_id?.substring(0, 8)}\n`));
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('hnsw:stats')
  .description('Show HNSW graph statistics')
  .action(async () => {
    const { getHNSWStats } = await import('../lib/agentdb-hnsw.js');

    try {
      const stats = getHNSWStats();

      console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════════════╗'));
      console.log(chalk.bold.cyan('║                    HNSW GRAPH STATISTICS                           ║'));
      console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════╝\n'));

      console.log(chalk.bold('📊 Graph Structure:'));
      console.log(`   Nodes:           ${chalk.cyan(stats.nodes)}`);
      console.log(`   Edges:           ${chalk.cyan(stats.edges)}`);
      console.log(`   Layers:          ${chalk.cyan(stats.layers)}`);
      console.log(`   Avg Connections: ${chalk.cyan(stats.avgConnections?.toFixed(2) || 'N/A')}`);
      console.log(`   Status:          ${stats.status === 'active' ? chalk.green(stats.status) : chalk.yellow(stats.status)}\n`);

      if (stats.layerDistribution && stats.layerDistribution.length > 0) {
        console.log(chalk.bold('📈 Layer Distribution:'));
        stats.layerDistribution.forEach(layer => {
          console.log(`   Layer ${layer.layer}: ${chalk.cyan(layer.count)} nodes`);
        });
        console.log('');
      }

      if (stats.status === 'empty') {
        console.log(chalk.yellow('💡 Tip: Run "research-swarm hnsw:build" to build the graph\n'));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// GOALIE integration commands (v1.2.0)
program
  .command('goal-research')
  .description('Research using GOALIE goal decomposition (GOAP planning + multi-agent swarm)')
  .argument('<goal>', 'High-level research goal')
  .option('-d, --depth <number>', 'Research depth per sub-goal', '5')
  .option('-t, --time <minutes>', 'Total time budget in minutes', '120')
  .option('--swarm-size <number>', 'Base swarm size (3-7)', '5')
  .option('--max-concurrent <number>', 'Max concurrent agents', '3')
  .option('--verbose', 'Verbose output from agents')
  .action(async (goal, options) => {
    try {
      const { executeGoalBasedResearch } = await import('../lib/goalie-integration.js');

      await executeGoalBasedResearch(goal, {
        depth: parseInt(options.depth),
        timeMinutes: parseInt(options.time),
        swarmSize: parseInt(options.swarmSize),
        maxConcurrent: parseInt(options.maxConcurrent),
        verbose: options.verbose
      });

    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      console.error(chalk.dim(error.stack));
      process.exit(1);
    }
  });

program
  .command('goal-plan')
  .description('Create GOAP plan for a research goal (planning only, no execution)')
  .argument('<goal>', 'Research goal to plan')
  .option('--swarm-size <number>', 'Base swarm size estimate', '5')
  .option('--time <minutes>', 'Time budget estimate', '120')
  .action(async (goal, options) => {
    try {
      const { planResearch } = await import('../lib/goalie-integration.js');

      const plan = await planResearch(goal, {
        swarmSize: parseInt(options.swarmSize),
        timeMinutes: parseInt(options.time)
      });

      console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════════════╗'));
      console.log(chalk.bold.cyan('║                    GOAP RESEARCH PLAN                              ║'));
      console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════╝\n'));

      console.log(chalk.bold('🎯 Goal:') + ` ${goal}\n`);

      console.log(chalk.bold('📋 Sub-Goals:\n'));
      plan.subGoals.forEach((subGoal, idx) => {
        console.log(chalk.cyan(`   ${idx + 1}. ${subGoal.description}`));
        console.log(chalk.dim(`      Complexity: ${subGoal.complexity} | Priority: ${subGoal.priority}\n`));
      });

      console.log(chalk.bold('📊 Estimates:'));
      console.log(`   Agents:  ${chalk.cyan(plan.estimatedAgents)}`);
      console.log(`   Time:    ${chalk.cyan(plan.estimatedTime)} minutes`);
      console.log(`   Cost:    ${chalk.cyan(plan.estimatedCost)}x baseline\n`);

      console.log(chalk.yellow('💡 Run with: research-swarm goal-research "' + goal + '"\n'));

    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      console.error(chalk.dim(error.stack));
      process.exit(1);
    }
  });

program
  .command('goal-decompose')
  .description('Decompose a goal using GOALIE (GOAP algorithm only)')
  .argument('<goal>', 'Goal to decompose')
  .option('--max-subgoals <number>', 'Max sub-goals', '10')
  .option('--verbose', 'Show GOALIE output')
  .action(async (goal, options) => {
    try {
      const { decomposeGoal } = await import('../lib/goalie-integration.js');

      const subGoals = await decomposeGoal(goal, {
        maxSubGoals: parseInt(options.maxSubgoals),
        verbose: options.verbose
      });

      console.log(chalk.bold.cyan('\n🎯 Goal Decomposition Results:\n'));
      subGoals.forEach((subGoal, idx) => {
        console.log(chalk.cyan(`${idx + 1}. ${subGoal.description}`));
        console.log(chalk.dim(`   Complexity: ${subGoal.complexity} | Priority: ${subGoal.priority}\n`));
      });

      console.log(chalk.dim(`Total sub-goals: ${subGoals.length}\n`));

    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      console.error(chalk.dim(error.stack));
      process.exit(1);
    }
  });

program
  .command('goal-explain')
  .description('Explain GOAP planning for a goal (using GOALIE)')
  .argument('<goal>', 'Goal to explain')
  .action(async (goal) => {
    try {
      const { explainGoalPlan } = await import('../lib/goalie-integration.js');

      console.log(chalk.cyan('\n🧠 Analyzing goal with GOALIE...\n'));

      const explanation = await explainGoalPlan(goal);

      console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════════════════════╗'));
      console.log(chalk.bold.cyan('║                    GOAP EXPLANATION                                ║'));
      console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════╝\n'));

      console.log(explanation);
      console.log('');

    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      console.error(chalk.dim(error.stack));
      process.exit(1);
    }
  });

program.parse();
