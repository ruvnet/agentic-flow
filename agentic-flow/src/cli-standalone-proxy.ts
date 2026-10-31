#!/usr/bin/env node
/**
 * Agentic Flow - Standalone Anthropic Proxy Server
 *
 * Run Gemini, OpenRouter, or other providers through an Anthropic-compatible proxy
 * for use with Claude Code, Cursor, and other tools that support ANTHROPIC_BASE_URL
 *
 * Usage:
 *   npx agentic-flow proxy --provider gemini --port 3000
 *   npx agentic-flow proxy --provider openrouter --model "openai/gpt-4o-mini" --port 3000
 *
 * Then in Claude Code or Cursor:
 *   export ANTHROPIC_BASE_URL=http://127.0.0.1:3000
 *   export ANTHROPIC_API_KEY=<token the proxy prints on start>
 */

import dotenv from 'dotenv';
import { parseArgs } from 'util';
import { AnthropicToGeminiProxy } from './proxy/anthropic-to-gemini.js';
import { AnthropicToOpenRouterProxy } from './proxy/anthropic-to-openrouter.js';
import { proxyClientBaseUrl } from './proxy/proxy-auth.js';

// Load environment variables
dotenv.config();

interface ProxyOptions {
  provider: 'gemini' | 'openrouter';
  port: number;
  model?: string;
}

function parseArguments(): ProxyOptions {
  const { values } = parseArgs({
    options: {
      provider: {
        type: 'string',
        short: 'p',
        default: 'gemini'
      },
      port: {
        type: 'string',
        short: 'P',
        default: '3000'
      },
      model: {
        type: 'string',
        short: 'm'
      },
      help: {
        type: 'boolean',
        short: 'h'
      }
    },
    strict: false,
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Agentic Flow - Standalone Anthropic Proxy Server

USAGE:
  npx agentic-flow proxy [OPTIONS]

OPTIONS:
  -p, --provider <provider>   Provider to use (gemini, openrouter) [default: gemini]
  -P, --port <port>           Port to run proxy on [default: 3000]
  -m, --model <model>         Model to use (provider-specific)
  -h, --help                  Show this help message

ENVIRONMENT VARIABLES:
  GOOGLE_GEMINI_API_KEY       Required for Gemini provider
  OPENROUTER_API_KEY          Required for OpenRouter provider
  COMPLETION_MODEL            Default model (optional)

EXAMPLES:
  # Start Gemini proxy on port 3000
  npx agentic-flow proxy --provider gemini --port 3000

  # Start OpenRouter proxy with GPT-4o-mini
  npx agentic-flow proxy --provider openrouter --model "openai/gpt-4o-mini"

  # Use with Claude Code
  export ANTHROPIC_BASE_URL=http://127.0.0.1:3000
  export ANTHROPIC_API_KEY=<token the proxy prints on start>
  claude  # Claude Code will now use the proxy

  # Use with Cursor (when ANTHROPIC_BASE_URL support is added)
  export ANTHROPIC_BASE_URL=http://127.0.0.1:3000
  export ANTHROPIC_API_KEY=<token the proxy prints on start>
`);
    process.exit(0);
  }

  const provider = (values.provider || 'gemini') as 'gemini' | 'openrouter';
  const port = parseInt(values.port as string || '3000');
  const model = values.model as string | undefined;

  if (!['gemini', 'openrouter'].includes(provider)) {
    console.error(`❌ Error: Invalid provider "${provider}". Must be "gemini" or "openrouter"`);
    process.exit(1);
  }

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`❌ Error: Invalid port "${values.port}". Must be 1-65535`);
    process.exit(1);
  }

  return { provider, port, model };
}

async function startProxy(options: ProxyOptions) {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║   Agentic Flow - Standalone Anthropic Proxy Server    ║
╚═══════════════════════════════════════════════════════╝
`);

  if (options.provider === 'gemini') {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      console.error(`
❌ Error: GOOGLE_GEMINI_API_KEY environment variable required

Set it with:
  export GOOGLE_GEMINI_API_KEY=your-key-here

Or create a .env file:
  GOOGLE_GEMINI_API_KEY=your-key-here
`);
      process.exit(1);
    }

    const model = options.model || process.env.COMPLETION_MODEL || 'gemini-2.0-flash-exp';

    console.log(`🚀 Starting Gemini → Anthropic Proxy
📍 Port: ${options.port}
🤖 Model: ${model}
🔗 Gemini API: https://generativelanguage.googleapis.com
`);

    const proxy = new AnthropicToGeminiProxy({
      geminiApiKey: apiKey,
      defaultModel: model
    });

    proxy.start(options.port);

    console.log(`
✅ Proxy server running!

Configure Claude Code:
  export ANTHROPIC_BASE_URL=${proxyClientBaseUrl(options.port)}
  export ANTHROPIC_API_KEY=${proxy.getAuthToken()}
  claude

Configure Cursor (when supported):
  Settings → API Keys → Anthropic Base URL: ${proxyClientBaseUrl(options.port)}
  API Key: ${proxy.getAuthToken()}

Cost Savings: ~85% vs direct Anthropic API
Rate Limits: Gemini free tier = 10 req/min
`);

  } else if (options.provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error(`
❌ Error: OPENROUTER_API_KEY environment variable required

Set it with:
  export OPENROUTER_API_KEY=sk-or-v1-your-key-here

Get your key at: https://openrouter.ai/keys
`);
      process.exit(1);
    }

    const model = options.model || process.env.COMPLETION_MODEL || 'deepseek/deepseek-chat';

    console.log(`🚀 Starting OpenRouter → Anthropic Proxy
📍 Port: ${options.port}
🤖 Model: ${model}
🔗 OpenRouter API: https://openrouter.ai/api/v1
`);

    const proxy = new AnthropicToOpenRouterProxy({
      openrouterApiKey: apiKey,
      defaultModel: model
    });

    proxy.start(options.port);

    console.log(`
✅ Proxy server running!

Configure Claude Code:
  export ANTHROPIC_BASE_URL=${proxyClientBaseUrl(options.port)}
  export ANTHROPIC_API_KEY=${proxy.getAuthToken()}
  claude

Configure Cursor (when supported):
  Settings → API Keys → Anthropic Base URL: ${proxyClientBaseUrl(options.port)}
  API Key: ${proxy.getAuthToken()}

Cost Savings: ~90% vs direct Anthropic API
Popular Models:
  - openai/gpt-4o-mini (fast, cheap)
  - anthropic/claude-3.5-sonnet (via OpenRouter)
  - meta-llama/llama-3.1-405b-instruct (OSS)
`);
  }

  // Keep process running
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down proxy server...');
    process.exit(0);
  });
}

// Main execution
const options = parseArguments();
startProxy(options).catch(error => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
