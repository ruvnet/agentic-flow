// Generic agent that uses .claude/agents definitions with multi-provider SDK routing
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { AgentDefinition } from "../utils/agentLoader.js";
import { claudeFlowSdkServer } from "../mcp/claudeFlowSdkServer.js";
import { resolveAgentPermissions } from "./permission-mode.js";

function getCurrentProvider(): string {
  // Determine provider from environment
  if (process.env.PROVIDER === 'gemini' || process.env.USE_GEMINI === 'true') {
    return 'gemini';
  }
  if (process.env.PROVIDER === 'requesty' || process.env.USE_REQUESTY === 'true') {
    return 'requesty';
  }
  if (process.env.PROVIDER === 'openrouter' || process.env.USE_OPENROUTER === 'true') {
    return 'openrouter';
  }
  if (process.env.PROVIDER === 'onnx' || process.env.USE_ONNX === 'true') {
    return 'onnx';
  }
  return 'anthropic'; // Default
}

function getModelForProvider(provider: string): {
  model: string;
  apiKey: string;
  baseURL?: string;
} {
  switch (provider) {
    case 'gemini':
      const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
      if (!geminiKey) {
        throw new Error(
          'GOOGLE_GEMINI_API_KEY is required for Gemini provider.\n' +
          'Set it via environment variable or use --provider anthropic for Claude models.\n' +
          'Get your API key at: https://makersuite.google.com/app/apikey'
        );
      }
      return {
        model: process.env.COMPLETION_MODEL || 'gemini-2.0-flash-exp',
        apiKey: geminiKey,
        baseURL: process.env.PROXY_URL || undefined
      };

    case 'requesty':
      const requestyKey = process.env.REQUESTY_API_KEY;
      if (!requestyKey) {
        throw new Error(
          'REQUESTY_API_KEY is required for Requesty provider.\n' +
          'Set it via environment variable or use --provider anthropic for Claude models.\n' +
          'Get your API key at: https://requesty.ai'
        );
      }
      return {
        model: process.env.COMPLETION_MODEL || 'deepseek/deepseek-chat',
        apiKey: requestyKey,
        baseURL: process.env.PROXY_URL || undefined
      };

    case 'openrouter':
      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterKey) {
        throw new Error(
          'OPENROUTER_API_KEY is required for OpenRouter provider.\n' +
          'Set it via environment variable or use --provider anthropic for Claude models.\n' +
          'Get your API key at: https://openrouter.ai/keys'
        );
      }
      return {
        model: process.env.COMPLETION_MODEL || 'deepseek/deepseek-chat',
        apiKey: openrouterKey,
        baseURL: process.env.PROXY_URL || undefined
      };

    case 'onnx':
      return {
        model: 'onnx-local',
        apiKey: 'local',
        baseURL: process.env.PROXY_URL || undefined
      };

    case 'anthropic':
    default:
      // For anthropic provider, require ANTHROPIC_API_KEY
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required but not set for Anthropic provider');
      }
      return {
        model: process.env.COMPLETION_MODEL || 'claude-sonnet-4-5-20250929',
        apiKey,
        // No baseURL for direct Anthropic
      };
  }
}

export async function claudeAgent(
  agent: AgentDefinition,
  input: string,
  onStream?: (chunk: string) => void,
  modelOverride?: string
) {
  const startTime = Date.now();
  const provider = getCurrentProvider();

  logger.info('Starting Claude Agent SDK with multi-provider support', {
    agent: agent.name,
    provider,
    input: input.substring(0, 100),
    model: modelOverride || 'default'
  });

  return withRetry(async () => {
    // Get model configuration for the selected provider
    const modelConfig = getModelForProvider(provider);
    const finalModel = modelOverride || modelConfig.model;

    // Configure environment for Claude Agent SDK with proxy routing
    // The SDK internally uses Anthropic client which reads ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY
    const envOverrides: Record<string, string> = {};

    if (provider === 'gemini' && process.env.GOOGLE_GEMINI_API_KEY) {
      // Use ANTHROPIC_BASE_URL if already set by CLI (proxy mode)
      envOverrides.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'proxy-key';
      envOverrides.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || process.env.GEMINI_PROXY_URL || 'http://localhost:3000';

      logger.info('Using Gemini proxy', {
        proxyUrl: envOverrides.ANTHROPIC_BASE_URL,
        model: finalModel
      });
    } else if (provider === 'requesty' && process.env.REQUESTY_API_KEY) {
      // Use ANTHROPIC_BASE_URL if already set by CLI (proxy mode)
      envOverrides.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'proxy-key';
      envOverrides.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || process.env.REQUESTY_PROXY_URL || 'http://localhost:3000';

      logger.info('Using Requesty proxy', {
        proxyUrl: envOverrides.ANTHROPIC_BASE_URL,
        model: finalModel
      });
    } else if (provider === 'openrouter' && process.env.OPENROUTER_API_KEY) {
      // Use ANTHROPIC_BASE_URL if already set by CLI (proxy mode)
      envOverrides.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'proxy-key';
      envOverrides.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || process.env.OPENROUTER_PROXY_URL || 'http://localhost:3000';

      logger.info('Using OpenRouter proxy', {
        proxyUrl: envOverrides.ANTHROPIC_BASE_URL,
        model: finalModel
      });
    } else if (provider === 'onnx') {
      // For ONNX: Use ANTHROPIC_BASE_URL if already set by CLI (proxy mode)
      envOverrides.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-onnx-local-key';
      envOverrides.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || process.env.ONNX_PROXY_URL || 'http://localhost:3001';

      logger.info('Using ONNX local proxy', {
        proxyUrl: envOverrides.ANTHROPIC_BASE_URL,
        model: finalModel
      });
    }
    // For Anthropic provider, use existing ANTHROPIC_API_KEY (no proxy needed)

    logger.info('Multi-provider configuration', {
      provider,
      model: finalModel,
      hasApiKey: !!envOverrides.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_API_KEY,
      hasBaseURL: !!envOverrides.ANTHROPIC_BASE_URL
    });

    try {
      // MCP server setup - enable in-SDK server and optional external servers
      const mcpServers: any = {};

      // CRITICAL FIX: Disable all MCP servers for Requesty provider
      // The Claude SDK hangs when trying to initialize MCP servers with Requesty
      // This is a fundamental incompatibility - SDK initialization fails before API call
      if (provider === 'requesty') {
        logger.info('⚠️  Requesty provider detected - disabling all MCP servers to prevent hang');
        console.log('⚠️  Requesty: MCP tools disabled (SDK incompatibility)');
        // Skip all MCP server initialization for Requesty
        // Continue with empty mcpServers object
      } else {
        // Enable in-SDK MCP server for custom tools (enabled by default)
        if (process.env.ENABLE_CLAUDE_FLOW_SDK !== 'false') {
          mcpServers['claude-flow-sdk'] = claudeFlowSdkServer;
        }

        // External MCP servers (enabled by default for full 213-tool access)
        // Disable by setting ENABLE_CLAUDE_FLOW_MCP=false
        if (process.env.ENABLE_CLAUDE_FLOW_MCP !== 'false') {
        mcpServers['claude-flow'] = {
          type: 'stdio',
          command: 'npx',
          args: ['claude-flow@alpha', 'mcp', 'start'],
          env: {
            ...process.env,
            MCP_AUTO_START: 'true',
            PROVIDER: provider
          }
        };
      }

      if (process.env.ENABLE_FLOW_NEXUS_MCP !== 'false') {
        mcpServers['flow-nexus'] = {
          type: 'stdio',
          command: 'npx',
          args: ['flow-nexus@latest', 'mcp', 'start'],
          env: {
            ...process.env,
            FLOW_NEXUS_AUTO_START: 'true'
          }
        };
      }

      if (process.env.ENABLE_AGENTIC_PAYMENTS_MCP !== 'false') {
        mcpServers['agentic-payments'] = {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'agentic-payments', 'mcp'],
          env: {
            ...process.env,
            AGENTIC_PAYMENTS_AUTO_START: 'true'
          }
        };
      }

      // Load MCP servers from user config file (~/.agentic-flow/mcp-config.json)
      try {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');

        const configPath = path.join(os.homedir(), '.agentic-flow', 'mcp-config.json');

        if (fs.existsSync(configPath)) {
          const configContent = fs.readFileSync(configPath, 'utf-8');
          const config = JSON.parse(configContent);

          // Add enabled user-configured servers
          for (const [name, server] of Object.entries(config.servers || {})) {
            const serverConfig = server as any;
            if (serverConfig.enabled) {
              mcpServers[name] = {
                type: 'stdio',
                command: serverConfig.command,
                args: serverConfig.args || [],
                env: {
                  ...process.env,
                  ...serverConfig.env
                }
              };
              console.log(`[agentic-flow] Loaded MCP server: ${name}`);
            }
          }
        }
        } catch (error) {
          // Silently fail if config doesn't exist or can't be read
          console.log('[agentic-flow] No user MCP config found (this is normal)');
        }
      } // End of provider !== 'requesty' check

      // Read-only by default; bypassPermissions with every built-in tool only
      // when AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS=1 (e.g. inside a sandbox).
      const permissions = resolveAgentPermissions();
      const queryOptions: any = {
        systemPrompt: agent.systemPrompt,
        model: finalModel, // Claude Agent SDK handles model selection
        permissionMode: permissions.permissionMode,
        // allowedTools are auto-approved by the SDK; anything else needs a prompt
        allowedTools: permissions.allowedTools,
        // Add MCP servers if configured
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined
      };

      // Add environment overrides if present
      if (Object.keys(envOverrides).length > 0) {
        queryOptions.env = {
          ...process.env,
          ...envOverrides
        };
      }

      const result = query({
        prompt: input,
        options: queryOptions
      });

      let output = '';
      let toolCallCount = 0;

      for await (const msg of result) {
        const msgAny = msg as any; // Use any to handle different event types from SDK

        // Debug: Log message structure to understand SDK events
        if (process.env.DEBUG_STREAMING === 'true') {
          console.error(`[DEBUG] Message type: ${msg.type}, keys: ${Object.keys(msg).join(', ')}`);
        }

        // Handle assistant text messages
        if (msg.type === 'assistant') {
          const chunk = msg.message.content?.map((c: any) => c.type === 'text' ? c.text : '').join('') || '';
          output += chunk;

          if (onStream && chunk) {
            onStream(chunk);
          }

          // Check for tool use in message content blocks
          const toolBlocks = msg.message.content?.filter((c: any) => c.type === 'tool_use') || [];
          for (const toolBlock of toolBlocks) {
            toolCallCount++;
            const toolName = (toolBlock as any).name || 'unknown';
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const progressMsg = `\n[${timestamp}] 🔍 Tool call #${toolCallCount}: ${toolName}\n`;
            process.stderr.write(progressMsg);

            if (onStream) {
              onStream(progressMsg);
            }
          }
        }

        // Handle stream events that contain tool information
        if (msgAny.streamEvent) {
          const event = msgAny.streamEvent;

          // Tool use event (content_block_start with tool_use)
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            toolCallCount++;
            const toolName = event.content_block.name || 'unknown';
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const progressMsg = `\n[${timestamp}] 🔍 Tool call #${toolCallCount}: ${toolName}\n`;
            process.stderr.write(progressMsg);

            if (onStream) {
              onStream(progressMsg);
            }
          }

          // Tool result event (content_block_stop)
          if (event.type === 'content_block_stop') {
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const resultMsg = `[${timestamp}] ✅ Tool completed\n`;
            process.stderr.write(resultMsg);

            if (onStream) {
              onStream(resultMsg);
            }
          }
        }

        // Flush output to ensure immediate visibility
        if (process.stderr.uncork) {
          process.stderr.uncork();
        }
        if (process.stdout.uncork) {
          process.stdout.uncork();
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Claude Agent SDK completed', {
        agent: agent.name,
        provider,
        duration,
        outputLength: output.length
      });

      return { output, agent: agent.name };
    } catch (error: any) {
      logger.error('Claude Agent SDK execution failed', {
        provider,
        model: finalModel,
        error: error.message
      });
      throw error;
    }
  });
}
