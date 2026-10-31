#!/usr/bin/env node
/**
 * Claude Code Wrapper for Agentic Flow
 *
 * Automatically spawns Claude Code with the correct ANTHROPIC_BASE_URL
 * and environment variables based on the provider/args used.
 *
 * Usage:
 *   npx agentic-flow claude-code --provider openrouter "Write a function"
 *   npx agentic-flow claude-code --provider gemini "Create a REST API"
 *   npx agentic-flow claude-code --provider anthropic "Help me debug"
 *
 * Features:
 * - Auto-starts proxy server in background if not running
 * - Sets ANTHROPIC_BASE_URL to proxy endpoint
 * - Configures provider-specific API keys
 * - Supports all Claude Code native arguments
 * - Cleans up proxy on exit (optional)
 */

import { spawn, ChildProcess } from 'child_process';
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { proxyClientBaseUrl } from '../proxy/proxy-auth.js';

// Load environment variables from root .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

interface ProxyConfig {
  provider: 'anthropic' | 'openrouter' | 'requesty' | 'gemini' | 'onnx';
  port: number;
  baseUrl: string;
  model?: string;
  apiKey: string;
  requiresProxy: boolean;
  /** Token the local proxy requires; sent to Claude Code as ANTHROPIC_API_KEY. */
  proxyToken?: string;
}

/**
 * Get proxy configuration based on provider
 */
function getProxyConfig(provider: string, customPort?: number): ProxyConfig {
  const port = customPort || 3000;
  const baseUrl = proxyClientBaseUrl(port);

  switch (provider.toLowerCase()) {
    case 'openrouter':
      return {
        provider: 'openrouter',
        port,
        baseUrl,
        model: process.env.COMPLETION_MODEL || 'deepseek/deepseek-chat',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        requiresProxy: true
      };

    case 'requesty':
      return {
        provider: 'requesty',
        port,
        baseUrl,
        model: process.env.COMPLETION_MODEL || 'deepseek/deepseek-chat',
        apiKey: process.env.REQUESTY_API_KEY || '',
        requiresProxy: true
      };

    case 'gemini':
      return {
        provider: 'gemini',
        port,
        baseUrl,
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
        apiKey: process.env.GOOGLE_GEMINI_API_KEY || '',
        requiresProxy: true
      };

    case 'onnx':
      return {
        provider: 'onnx',
        port,
        baseUrl,
        model: 'onnx-local',
        apiKey: 'dummy',
        requiresProxy: true
      };

    case 'anthropic':
    default:
      return {
        provider: 'anthropic',
        port: 0,
        baseUrl: 'https://api.anthropic.com',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        requiresProxy: false
      };
  }
}

/**
 * Check if proxy server is already running
 */
async function isProxyRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`${proxyClientBaseUrl(port)}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start the proxy server in background using the same approach as the agent
 */
async function startProxyServer(config: ProxyConfig): Promise<any> {
  if (!config.requiresProxy) {
    return null;
  }

  // Check if already running
  const running = await isProxyRunning(config.port);
  if (running) {
    logger.info(`Proxy already running on port ${config.port}`);
    // A proxy started elsewhere only accepts its own token; reuse it if shared.
    config.proxyToken = process.env.AGENTIC_FLOW_PROXY_TOKEN;
    if (!config.proxyToken && config.provider !== 'onnx') {
      logger.warn('Existing proxy requires its token: set AGENTIC_FLOW_PROXY_TOKEN to the value it printed');
    }
    return null;
  }

  logger.info(`Starting ${config.provider} proxy on port ${config.port}...`);

  let proxy: any;

  if (config.provider === 'gemini') {
    const { AnthropicToGeminiProxy } = await import('../proxy/anthropic-to-gemini.js');
    proxy = new AnthropicToGeminiProxy({
      geminiApiKey: config.apiKey,
      defaultModel: config.model || 'gemini-2.0-flash-exp'
    });
  } else if (config.provider === 'onnx') {
    const { AnthropicToONNXProxy } = await import('../proxy/anthropic-to-onnx.js');
    proxy = new AnthropicToONNXProxy({
      port: config.port,
      modelPath: process.env.ONNX_MODEL_PATH,
      executionProviders: process.env.ONNX_EXECUTION_PROVIDERS?.split(',') || ['cpu']
    });
  } else {
    // OpenRouter - DeepSeek Chat: cheap ($0.14/M), fast, supports tools, good quality
    const { AnthropicToOpenRouterProxy } = await import('../proxy/anthropic-to-openrouter.js');
    proxy = new AnthropicToOpenRouterProxy({
      openrouterApiKey: config.apiKey,
      openrouterBaseUrl: process.env.ANTHROPIC_PROXY_BASE_URL,
      defaultModel: config.model || 'deepseek/deepseek-chat'
    });
  }

  // Start proxy (binds 127.0.0.1 unless AGENTIC_FLOW_PROXY_HOST is set)
  proxy.start(config.port);
  if (typeof proxy.getAuthToken === 'function') {
    config.proxyToken = proxy.getAuthToken();
  }

  console.log(`🔗 Proxy Mode: ${config.provider}`);
  console.log(`🔧 Proxy URL: ${config.baseUrl}`);
  console.log(`🤖 Default Model: ${config.model}\n`);

  // Wait for proxy to be ready
  await new Promise(resolve => setTimeout(resolve, 1500));

  return proxy;
}

/**
 * Spawn Claude Code with configured environment
 */
function spawnClaudeCode(config: ProxyConfig, claudeArgs: string[]): ChildProcess {
  logger.info('Starting Claude Code...');
  logger.info(`Provider: ${config.provider}`);
  logger.info(`Base URL: ${config.baseUrl}`);
  if (config.model) {
    logger.info(`Model: ${config.model}`);
  }

  // Build environment variables
  const env: Record<string, string> = {
    ...process.env
  } as Record<string, string>;

  if (config.requiresProxy) {
    // Using proxy - set base URL and realistic dummy key
    // Use a properly formatted key that won't trigger Claude's validation warnings
    env.ANTHROPIC_BASE_URL = config.baseUrl;
    env.ANTHROPIC_API_KEY = config.proxyToken ||
      'sk-ant-api03-proxy-forwarded-to-' + config.provider + '-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

    // Set provider-specific keys
    if (config.provider === 'openrouter') {
      env.OPENROUTER_API_KEY = config.apiKey;
    } else if (config.provider === 'gemini') {
      env.GOOGLE_GEMINI_API_KEY = config.apiKey;
    }
  } else {
    // Direct Anthropic
    env.ANTHROPIC_API_KEY = config.apiKey;
    if (env.ANTHROPIC_BASE_URL) {
      delete env.ANTHROPIC_BASE_URL;
    }
  }

  logger.debug('Environment variables:', {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL || '(default)',
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.substring(0, 10) + '...',
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ? '(set)' : '(not set)',
    GOOGLE_GEMINI_API_KEY: env.GOOGLE_GEMINI_API_KEY ? '(set)' : '(not set)'
  });

  // Spawn Claude Code
  const claudeProcess = spawn('claude', claudeArgs, {
    env: env as NodeJS.ProcessEnv,
    stdio: 'inherit'
  });

  return claudeProcess;
}

/**
 * Main CLI function
 */
async function main() {
  const program = new Command();

  program
    .name('agentic-flow claude-code')
    .description('Spawn Claude Code with automatic proxy configuration for alternative AI providers')
    .usage('[options] [task]')
    .addHelpText('after', `
Examples:
  # Interactive mode - Opens Claude Code UI with proxy
  $ agentic-flow claude-code --provider openrouter
  $ agentic-flow claude-code --provider gemini

  # Non-interactive mode - Execute task and exit
  $ agentic-flow claude-code --provider openrouter "Write a Python hello world function"
  $ agentic-flow claude-code --provider openrouter --model "mistralai/mistral-small-3.1-24b-instruct" "Create REST API"

  # Using different providers
  $ agentic-flow claude-code --provider openrouter  # Uses Mistral Small (default, $0.02/M tokens)
  $ agentic-flow claude-code --provider gemini      # Uses Gemini 2.0 Flash
  $ agentic-flow claude-code --provider onnx        # Uses local ONNX models (free)

  # With Agent Booster for 57x faster code edits
  $ agentic-flow claude-code --provider openrouter --agent-booster

Recommended Models:
  OpenRouter:
    mistralai/mistral-small-3.1-24b-instruct  (default, $0.02/M, 128k context, optimized for tools)
    anthropic/claude-3.5-sonnet         ($3/M, highest quality, large context)
    google/gemini-2.0-flash-exp:free    (FREE tier, rate limited)

  Note: Models with <128k context will fail with tool definitions (Claude sends 35k+ tokens)

Environment Variables:
  OPENROUTER_API_KEY    Required for --provider openrouter
  GOOGLE_GEMINI_API_KEY Required for --provider gemini
  ANTHROPIC_API_KEY     Required for --provider anthropic (default)
  ONNX_MODEL_PATH       Optional for --provider onnx

Documentation:
  https://github.com/ruvnet/agentic-flow#claude-code-mode
  https://ruv.io
`)
    .option('--provider <provider>', 'AI provider (anthropic, openrouter, gemini, onnx)', 'anthropic')
    .option('--port <port>', 'Proxy server port', '3000')
    .option('--model <model>', 'Specific model to use (e.g., mistralai/mistral-small-3.1-24b-instruct)')
    .option('--agent-booster', 'Enable Agent Booster MCP tools for 57x faster code edits (default: true)', true)
    .option('--keep-proxy', 'Keep proxy running after Claude Code exits')
    .option('--no-auto-start', 'Skip proxy startup (use existing proxy)')
    .allowUnknownOption(true)
    .allowExcessArguments(true);

  program.parse(process.argv);
  const options = program.opts();

  // Get provider configuration
  const config = getProxyConfig(options.provider, parseInt(options.port));

  // Override model if specified
  if (options.model) {
    config.model = options.model;
  }

  // Validate API keys
  if (config.requiresProxy && !config.apiKey) {
    console.error(`❌ Error: Missing API key for ${config.provider}`);
    console.error(`   Please set ${config.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GOOGLE_GEMINI_API_KEY'}`);
    process.exit(1);
  }

  if (!config.requiresProxy && !config.apiKey) {
    console.error('❌ Error: Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }

  // Get Claude Code arguments (filter out wrapper-specific flags only)
  const wrapperFlags = new Set(['--provider', '--port', '--model', '--agent-booster', '--keep-proxy', '--no-auto-start']);
  const wrapperValues = new Set([options.provider, options.port, options.model]);

  const claudeArgs: string[] = [];
  let skipNext = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (skipNext) {
      skipNext = false;
      continue;
    }

    // Check if this is a wrapper flag
    const isWrapperFlag = Array.from(wrapperFlags).some(flag => arg.startsWith(flag));

    if (isWrapperFlag) {
      // Skip this flag and its value if it has one
      if (!arg.includes('=') && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('-')) {
        skipNext = true;
      }
      continue;
    }

    // Keep all other arguments
    claudeArgs.push(arg);
  }

  // Auto-detect non-interactive mode: if there's a task string and no -p flag, add it
  // Claude expects: claude [prompt] [flags], not claude [flags] [prompt]
  const hasTaskString = claudeArgs.some(arg => !arg.startsWith('-'));
  const hasPrintFlag = claudeArgs.includes('-p') || claudeArgs.includes('--print');

  if (hasTaskString && !hasPrintFlag) {
    // Find the prompt (first non-flag argument)
    const promptIndex = claudeArgs.findIndex(arg => !arg.startsWith('-'));
    if (promptIndex !== -1) {
      // Insert -p after the prompt
      claudeArgs.splice(promptIndex + 1, 0, '-p');
    }
  }

  let proxyServer: any = null;

  try {
    // Info about Agent Booster MCP tools if enabled
    if (options.agentBooster) {
      logger.info('');
      logger.info('⚡ Agent Booster enabled (57x faster code edits)');
      logger.info('   Available tools: agent_booster_edit_file, agent_booster_batch_edit, agent_booster_parse_markdown');
      logger.info('   Configure MCP: Add "agentic-flow" to Claude Desktop config');
      logger.info('   Learn more: examples/mcp-integration.md');
      logger.info('');
    }

    // Start proxy if needed and auto-start is enabled
    if (options.autoStart) {
      proxyServer = await startProxyServer(config);
    }

    // Spawn Claude Code
    const claudeProcess = spawnClaudeCode(config, claudeArgs);

    // Handle cleanup on exit
    const cleanup = () => {
      if (proxyServer && !options.keepProxy) {
        logger.info('Stopping proxy server...');
        if (proxyServer.stop) {
          proxyServer.stop();
        }
      }
    };

    claudeProcess.on('exit', (code) => {
      cleanup();
      process.exit(code || 0);
    });

    process.on('SIGINT', () => {
      claudeProcess.kill('SIGINT');
      cleanup();
    });

    process.on('SIGTERM', () => {
      claudeProcess.kill('SIGTERM');
      cleanup();
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (proxyServer && proxyServer.stop) {
      proxyServer.stop();
    }
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
