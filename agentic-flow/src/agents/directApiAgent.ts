// Direct API agent with multi-provider support (Anthropic, OpenRouter, Gemini)
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { AgentDefinition } from '../utils/agentLoader.js';
import { execFileSync } from 'child_process';
import { ModelRouter } from '../router/router.js';
import { ChatParams, ContentBlock, Message } from '../router/types.js';

// Lazy initialize clients
let anthropic: Anthropic | null = null;
let router: ModelRouter | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // Validate API key format
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required but not set');
    }

    if (!apiKey.startsWith('sk-ant-')) {
      throw new Error(
        `Invalid ANTHROPIC_API_KEY format. Expected format: sk-ant-...\n` +
        `Got: ${apiKey.substring(0, 10)}...\n\n` +
        `Please check your API key at: https://console.anthropic.com/settings/keys`
      );
    }

    anthropic = new Anthropic({ apiKey });
  }

  return anthropic;
}

function getRouter(): ModelRouter {
  if (!router) {
    // Router will now auto-create config from environment variables if no file exists
    router = new ModelRouter();
  }
  return router;
}

function getCurrentProvider(): string {
  // Determine provider from environment
  if (process.env.PROVIDER === 'gemini' || process.env.USE_GEMINI === 'true') {
    return 'gemini';
  }
  if (process.env.PROVIDER === 'openrouter' || process.env.USE_OPENROUTER === 'true') {
    return 'openrouter';
  }
  if (process.env.PROVIDER === 'onnx' || process.env.USE_ONNX === 'true') {
    return 'onnx';
  }
  return 'anthropic';
}

// Define claude-flow tools as native Anthropic tool definitions
const claudeFlowTools: Anthropic.Tool[] = [
  {
    name: 'memory_store',
    description: 'Store a value in persistent memory with optional namespace and TTL',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        value: { type: 'string', description: 'Value to store' },
        namespace: { type: 'string', description: 'Memory namespace', default: 'default' },
        ttl: { type: 'number', description: 'Time-to-live in seconds' }
      },
      required: ['key', 'value']
    }
  },
  {
    name: 'memory_retrieve',
    description: 'Retrieve a value from persistent memory',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Memory namespace', default: 'default' }
      },
      required: ['key']
    }
  },
  {
    name: 'memory_search',
    description: 'Search for keys matching a pattern in memory',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (supports wildcards)' },
        namespace: { type: 'string', description: 'Memory namespace to search in' },
        limit: { type: 'number', description: 'Maximum results to return', default: 10 }
      },
      required: ['pattern']
    }
  },
  {
    name: 'swarm_init',
    description: 'Initialize a multi-agent swarm with specified topology',
    input_schema: {
      type: 'object',
      properties: {
        topology: { type: 'string', enum: ['mesh', 'hierarchical', 'ring', 'star'], description: 'Swarm topology' },
        maxAgents: { type: 'number', description: 'Maximum number of agents', default: 8 },
        strategy: { type: 'string', enum: ['balanced', 'specialized', 'adaptive'], description: 'Agent distribution strategy', default: 'balanced' }
      },
      required: ['topology']
    }
  },
  {
    name: 'agent_spawn',
    description: 'Spawn a new agent in the swarm',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['researcher', 'coder', 'analyst', 'optimizer', 'coordinator'], description: 'Agent type' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities' },
        name: { type: 'string', description: 'Custom agent name' }
      },
      required: ['type']
    }
  },
  {
    name: 'task_orchestrate',
    description: 'Orchestrate a complex task across the swarm',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description or instructions' },
        strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'], description: 'Execution strategy', default: 'adaptive' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Task priority', default: 'medium' },
        maxAgents: { type: 'number', description: 'Maximum agents to use for this task' }
      },
      required: ['task']
    }
  },
  {
    name: 'swarm_status',
    description: 'Get current swarm status and metrics',
    input_schema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Include detailed metrics', default: false }
      }
    }
  }
];

// Execute tool calls using claude-flow CLI
async function executeToolCall(toolName: string, toolInput: any): Promise<string> {
  try {
    logger.info('Executing tool', { toolName, input: toolInput });

    // Helper: run npx claude-flow@alpha with safe argument array (no shell interpolation)
    const runClaudeFlow = (args: string[]): string =>
      execFileSync('npx', ['claude-flow@alpha', ...args], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

    switch (toolName) {
      case 'memory_store': {
        const { key, value, namespace = 'default', ttl } = toolInput;
        const args = ['memory', 'store', String(key), String(value), '--namespace', String(namespace)];
        if (ttl !== undefined) args.push('--ttl', String(Number(ttl)));
        runClaudeFlow(args);
        logger.info('Memory stored', { key, namespace });
        return `✅ Stored successfully\n📝 Key: ${key}\n📦 Namespace: ${namespace}\n💾 Size: ${String(value).length} bytes`;
      }

      case 'memory_retrieve': {
        const { key, namespace = 'default' } = toolInput;
        const result = runClaudeFlow(['memory', 'retrieve', String(key), '--namespace', String(namespace)]);
        logger.info('Memory retrieved', { key });
        return `✅ Retrieved:\n${result}`;
      }

      case 'memory_search': {
        const { pattern, namespace, limit = 10 } = toolInput;
        const args = ['memory', 'search', String(pattern), '--limit', String(Number(limit))];
        if (namespace) args.push('--namespace', String(namespace));
        const result = runClaudeFlow(args);
        return `🔍 Search results:\n${result}`;
      }

      case 'swarm_init': {
        const { topology, maxAgents = 8, strategy = 'balanced' } = toolInput;
        const result = runClaudeFlow([
          'swarm', 'init',
          '--topology', String(topology),
          '--max-agents', String(Number(maxAgents)),
          '--strategy', String(strategy),
        ]);
        return `🚀 Swarm initialized:\n${result}`;
      }

      case 'agent_spawn': {
        const { type, capabilities, name } = toolInput;
        const args = ['agent', 'spawn', '--type', String(type)];
        if (capabilities) args.push('--capabilities', capabilities.map(String).join(','));
        if (name) args.push('--name', String(name));
        const result = runClaudeFlow(args);
        return `🤖 Agent spawned:\n${result}`;
      }

      case 'task_orchestrate': {
        const { task, strategy = 'adaptive', priority = 'medium', maxAgents } = toolInput;
        const args = [
          'task', 'orchestrate', String(task),
          '--strategy', String(strategy),
          '--priority', String(priority),
        ];
        if (maxAgents !== undefined) args.push('--max-agents', String(Number(maxAgents)));
        const result = runClaudeFlow(args);
        return `⚡ Task orchestrated:\n${result}`;
      }

      case 'swarm_status': {
        const { verbose = false } = toolInput;
        const args = ['swarm', 'status'];
        if (verbose) args.push('--verbose');
        const result = runClaudeFlow(args);
        return `📊 Swarm status:\n${result}`;
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error: any) {
    logger.error('Tool execution failed', { toolName, error: error.message });
    return `❌ Tool execution failed: ${error.message}`;
  }
}

/**
 * Direct API agent using Anthropic SDK with native tool calling
 * Bypasses Claude Agent SDK subprocess issues entirely
 */
export async function directApiAgent(
  agent: AgentDefinition,
  input: string,
  onStream?: (chunk: string) => void
): Promise<{ output: string; agent: string }> {
  const startTime = Date.now();
  logger.info('Starting direct API agent', {
    agent: agent.name,
    input: input.substring(0, 100)
  });

  return withRetry(async () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: input }
    ];

    let finalOutput = '';
    let toolUseCount = 0;
    const maxToolUses = 10; // Prevent infinite loops

    // Agentic loop: keep calling API until no more tool uses
    while (toolUseCount < maxToolUses) {
      logger.debug('API call iteration', { toolUseCount, messagesLength: messages.length });

      const provider = getCurrentProvider();
      let response;

      try {
        // Use router for non-Anthropic providers
        if (provider === 'gemini' || provider === 'openrouter') {
          const routerInstance = getRouter();

          // Convert Anthropic messages format to router format
          const routerMessages: Message[] = messages.map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : msg.content.map((block: any) => {
              if ('text' in block) return { type: 'text' as const, text: block.text };
              if ('tool_use_id' in block) return {
                type: 'tool_result' as const,
                content: block.content
              };
              if ('name' in block && 'input' in block) return {
                type: 'tool_use' as const,
                id: block.id,
                name: block.name,
                input: block.input
              };
              return { type: 'text' as const, text: '' };
            }).filter((b: ContentBlock) => b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result')
          }));

          // Add system prompt as first message if needed
          const messagesWithSystem = agent.systemPrompt
            ? [{ role: 'system' as const, content: agent.systemPrompt }, ...routerMessages]
            : routerMessages;

          const params: ChatParams = {
            model: provider === 'gemini'
              ? (process.env.COMPLETION_MODEL || 'gemini-2.0-flash-exp')
              : (process.env.COMPLETION_MODEL || 'deepseek/deepseek-chat'),
            messages: messagesWithSystem,
            maxTokens: 8192,
            temperature: 0.7
          };

          const routerResponse = await routerInstance.chat(params);

          // Convert router response to Anthropic format
          response = {
            id: routerResponse.id,
            model: routerResponse.model,
            stop_reason: routerResponse.stopReason,
            content: routerResponse.content.map(block => {
              if (block.type === 'text') return { type: 'text' as const, text: block.text || '' };
              if (block.type === 'tool_use') return {
                type: 'tool_use' as const,
                id: block.id || '',
                name: block.name || '',
                input: block.input || {}
              };
              return { type: 'text' as const, text: '' };
            }) as any
          };
        } else {
          // Use Anthropic client for Anthropic provider
          const client = getAnthropicClient();
          response = await client.messages.create({
            model: process.env.COMPLETION_MODEL || 'claude-sonnet-4-5-20250929',
            max_tokens: 8192,
            system: agent.systemPrompt || 'You are a helpful AI assistant.',
            messages,
            tools: claudeFlowTools
          });
        }
      } catch (error: any) {
        // Enhance authentication errors with helpful guidance
        if (error?.status === 401 || error?.statusCode === 401) {
          const providerName = provider === 'gemini' ? 'Google Gemini' : provider === 'openrouter' ? 'OpenRouter' : 'Anthropic';
          const apiKey = provider === 'gemini'
            ? process.env.GOOGLE_GEMINI_API_KEY
            : provider === 'openrouter'
            ? process.env.OPENROUTER_API_KEY
            : process.env.ANTHROPIC_API_KEY;

          throw new Error(
            `❌ ${providerName} API authentication failed (401)\n\n` +
            `Your API key is invalid, expired, or lacks permissions.\n` +
            `Current key: ${apiKey?.substring(0, 15)}...\n\n` +
            `Please check your ${providerName} API key and update your .env file.\n\n` +
            `Alternative providers:\n` +
            `  --provider anthropic  (Claude models)\n` +
            `  --provider openrouter (100+ models, 99% cost savings)\n` +
            `  --provider gemini     (Google models)\n` +
            `  --provider onnx       (free local inference)`
          );
        }
        throw error;
      }

      logger.debug('API response', {
        stopReason: response.stop_reason,
        contentBlocks: response.content.length
      });

      // Process response content
      const toolResults: any[] = [];
      for (const block of response.content) {
        if (block.type === 'text') {
          finalOutput += block.text;
          if (onStream) {
            onStream(block.text);
          }
        } else if (block.type === 'tool_use') {
          toolUseCount++;
          logger.info('Tool use requested', {
            toolName: block.name,
            toolUseId: block.id
          });

          // Execute the tool
          const toolResult = await executeToolCall(block.name, block.input);

          // Collect tool result
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult
          });

          logger.debug('Tool result collected', {
            toolUseId: block.id,
            resultLength: toolResult.length
          });
        }
      }

      // If there were tool uses, add assistant message and all tool results
      if (toolResults.length > 0) {
        // Add assistant message with tool uses
        messages.push({
          role: 'assistant',
          content: response.content
        });

        // Add all tool results in one user message
        messages.push({
          role: 'user',
          content: toolResults
        });

        logger.debug('Tool results added to conversation', {
          count: toolResults.length
        });
      }

      // Stop if no tool use or end_turn
      if (response.stop_reason === 'end_turn' || response.content.every((b: any) => b.type === 'text')) {
        // Add final assistant message if it has text
        const textContent = response.content.filter((b: any) => b.type === 'text');
        if (textContent.length > 0 && messages[messages.length - 1].role !== 'assistant') {
          messages.push({
            role: 'assistant',
            content: response.content
          });
        }
        break;
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Direct API agent completed', {
      agent: agent.name,
      duration,
      toolUseCount,
      outputLength: finalOutput.length
    });

    return { output: finalOutput, agent: agent.name };
  });
}
