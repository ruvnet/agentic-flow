// Apply AgentDB runtime patch before any imports
import './utils/agentdb-runtime-patch.js';

import 'dotenv/config';
import { realpathSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webResearchAgent } from './agents/webResearchAgent.js';
import { codeReviewAgent } from './agents/codeReviewAgent.js';
import { dataAgent } from './agents/dataAgent.js';
import { claudeAgent } from './agents/claudeAgent.js';
import { logger } from './utils/logger.js';
import { startHealthServer } from './health.js';
import { parseArgs, printHelp, validateOptions } from './utils/cli.js';
import { getAgent, listAgents } from './utils/agentLoader.js';
import { handleMCPCommand } from './utils/mcpCommands.js';
import { handleReasoningBankCommand } from './utils/reasoningbankCommands.js';

// Re-export ReasoningBank plugin for npm package users
export * as reasoningbank from './reasoningbank/index.js';

async function runParallelMode() {
  const topic = process.env.TOPIC ?? 'migrate payments service';
  const codeDiff = process.env.DIFF ?? 'feat: add payments router and mandate checks';
  const datasetHint = process.env.DATASET ?? 'monthly tx volume, refunds, chargebacks';

  logger.info('Starting parallel agent execution', {
    topic,
    diff: codeDiff.substring(0, 50),
    dataset: datasetHint,
  });

  // Stream handler for real-time output
  const streamHandler = (agent: string) => (chunk: string) => {
    if (process.env.ENABLE_STREAMING === 'true') {
      process.stdout.write(`[${agent}] ${chunk}`);
    }
  };

  // Each agent runs with its own context. Fan out in parallel.
  const startTime = Date.now();
  const [researchOut, reviewOut, dataOut] = await Promise.all([
    webResearchAgent(`Give me context and risks about: ${topic}`, streamHandler('RESEARCH')),
    codeReviewAgent(
      `Review this diff at a high level and propose tests:\n${codeDiff}`,
      streamHandler('CODE_REVIEW')
    ),
    dataAgent(`Analyze ${datasetHint} and report key stats.`, streamHandler('DATA')),
  ]);
  const totalDuration = Date.now() - startTime;

  logger.info('All agents completed', {
    totalDuration,
    agentCount: 3,
    avgDuration: Math.round(totalDuration / 3),
  });

  // Basic reconcile step
  const summary = [
    '=== RESEARCH ===',
    researchOut.output?.trim() ?? '',
    '=== CODE REVIEW ===',
    reviewOut.output?.trim() ?? '',
    '=== DATA ===',
    dataOut.output?.trim() ?? '',
  ].join('\n');

  console.log(summary);
}

async function runAgentMode(
  agentName: string,
  task: string,
  stream: boolean,
  modelOverride?: string
) {
  logger.info('Running agent mode', {
    agent: agentName,
    task: task.substring(0, 100),
    model: modelOverride || 'default',
  });

  // Load the specified agent
  const agent = getAgent(agentName);

  if (!agent) {
    const availableAgents = listAgents();
    logger.error('Agent not found', { agent: agentName });
    console.error(`\n❌ Agent '${agentName}' not found.\n`);
    console.error('Available agents:');
    availableAgents.slice(0, 20).forEach((a) => {
      console.error(`  • ${a.name}: ${a.description.substring(0, 80)}...`);
    });
    if (availableAgents.length > 20) {
      console.error(`  ... and ${availableAgents.length - 20} more (use --list to see all)`);
    }
    process.exit(1);
  }

  console.log(`\n🤖 Agent: ${agent.name}`);
  console.log(`📝 Description: ${agent.description}\n`);
  console.log(`🎯 Task: ${task}\n`);
  if (modelOverride) {
    console.log(`🔧 Model: ${modelOverride}\n`);
  }
  console.log('⏳ Running...\n');

  // Enhanced stream handler that writes to stderr for progress and stdout for content
  const streamHandler = stream
    ? (chunk: string) => {
        // Write progress indicators (timestamps, tool calls) to stderr
        if (
          chunk.startsWith('\n[') ||
          chunk.startsWith('[') ||
          chunk.includes('🔍') ||
          chunk.includes('✅') ||
          chunk.includes('❌')
        ) {
          process.stderr.write(chunk);
        } else {
          // Write text content to stdout
          process.stdout.write(chunk);
        }

        // Force flush to ensure immediate visibility
        if (process.stdout.uncork) {
          process.stdout.uncork();
        }
        if (process.stderr.uncork) {
          process.stderr.uncork();
        }
      }
    : undefined;

  // Use Claude Agent SDK with in-SDK MCP server and optional model override
  logger.info('Using Claude Agent SDK with in-SDK MCP server', { modelOverride });
  const result = await claudeAgent(agent, task, streamHandler, modelOverride);

  if (!stream) {
    console.log('\n✅ Completed!\n');
    console.log('═══════════════════════════════════════\n');
    console.log(result.output);
    console.log('\n═══════════════════════════════════════\n');
  }

  logger.info('Agent mode completed', {
    agent: agentName,
    outputLength: result.output.length,
    model: modelOverride || 'default',
  });
}

function runListMode() {
  const agents = listAgents();

  console.log(`\n📦 Available Agents (${agents.length} total)\n`);

  // Group by category (based on directory structure)
  const grouped = new Map<string, typeof agents>();

  agents.forEach((agent) => {
    const parts = agent.filePath.split('/');
    const category = parts[parts.length - 2] || 'other';
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(agent);
  });

  // Print grouped
  Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([category, categoryAgents]) => {
      console.log(`\n${category.toUpperCase()}:`);
      categoryAgents.forEach((agent) => {
        console.log(`  ${agent.name.padEnd(30)} ${agent.description.substring(0, 80)}`);
      });
    });

  console.log(`\nTo use an agent:`);
  console.log(`  docker run --env-file .env claude-agents --agent <name> --task "Your task"\n`);
}

async function main() {
  logger.setContext({ service: 'claude-agents', version: '1.0.0' });

  // Parse CLI arguments
  const options = parseArgs();

  // Handle help
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Handle list mode
  if (options.mode === 'list') {
    runListMode();
    process.exit(0);
  }

  // Handle MCP mode
  if (options.mode === 'mcp') {
    await handleMCPCommand(options.mcpCommand || 'start', options.mcpServer || 'all');
    process.exit(0);
  }

  // Handle ReasoningBank mode
  if (options.mode === 'reasoningbank') {
    const subcommand = process.argv[3] || 'help';
    await handleReasoningBankCommand(subcommand);
    process.exit(0);
  }

  // Validate options
  const validationError = validateOptions(options);
  if (validationError) {
    console.error(`\n❌ ${validationError}\n`);
    printHelp();
    process.exit(1);
  }

  logger.info('Starting Claude Agent SDK', { mode: options.mode });

  // Propagate CLI options to environment variables for agent execution
  if (options.provider) {
    process.env.PROVIDER = options.provider;
    logger.info('Provider set from CLI', { provider: options.provider });
  }
  if (options.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
  }
  if (options.openrouterApiKey) {
    process.env.OPENROUTER_API_KEY = options.openrouterApiKey;
  }
  if (options.model) {
    process.env.COMPLETION_MODEL = options.model;
  }

  // Start health check server
  const healthPort = parseInt(process.env.HEALTH_PORT || '8080');
  const healthServer = startHealthServer(healthPort);

  try {
    if (options.mode === 'agent') {
      const task = options.task || process.env.TASK || '';
      const agent = options.agent || process.env.AGENT || '';
      const model = options.model || process.env.MODEL;
      await runAgentMode(agent, task, options.stream || false, model);
    } else {
      await runParallelMode();
    }

    logger.info('Execution completed successfully');
  } catch (err: unknown) {
    logger.error('Execution failed', { error: err });
    throw err;
  } finally {
    // Keep health server running for container health checks
    if (process.env.KEEP_ALIVE !== 'true') {
      healthServer.close();
    }
  }
}

// Library-safe entrypoint: only run the CLI/agent flow when this file is the
// process entry point (e.g. `node dist/index.js` or `npx agentic-flow`).
// When imported as a module (`import 'agentic-flow'`), expose exports without
// triggering CLI parsing, the health server, or agent execution.
function isCliEntry(): boolean {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const selfPath = fileURLToPath(import.meta.url);
    const realArgv = realpathSync(pathResolve(argv1));
    const realSelf = realpathSync(selfPath);
    return realArgv === realSelf;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
