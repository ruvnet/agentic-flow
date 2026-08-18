// Direct API agent that uses Anthropic SDK without Claude Code dependency
import Anthropic from '@anthropic-ai/sdk';
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { AgentDefinition } from "../utils/agentLoader.js";

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
  // Use DEFAULT_MODEL or COMPLETION_MODEL from environment (both supported for backward compatibility)
  const envModel = process.env.DEFAULT_MODEL || process.env.COMPLETION_MODEL;

  switch (provider) {
    case 'gemini':
      return {
        model: envModel || 'gemini-2.0-flash-exp',
        apiKey: process.env.GOOGLE_GEMINI_API_KEY || '',
        baseURL: process.env.GEMINI_PROXY_URL || `http://localhost:${process.env.PROXY_PORT || '3000'}`
      };

    case 'requesty':
      return {
        model: envModel || 'deepseek/deepseek-chat',
        apiKey: process.env.REQUESTY_API_KEY || '',
        baseURL: process.env.REQUESTY_PROXY_URL || `http://localhost:${process.env.PROXY_PORT || '3000'}`
      };

    case 'openrouter':
      return {
        model: envModel || 'deepseek/deepseek-chat',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        baseURL: process.env.OPENROUTER_PROXY_URL || `http://localhost:${process.env.PROXY_PORT || '3000'}`
      };

    case 'onnx':
      return {
        model: 'onnx-local',
        apiKey: 'local',
        baseURL: process.env.ONNX_PROXY_URL || `http://localhost:${process.env.ONNX_PROXY_PORT || '3001'}`
      };

    case 'anthropic':
    default:
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
      }
      return {
        model: envModel || 'claude-sonnet-4-5-20250929',
        apiKey,
        // Direct Anthropic API - no baseURL needed
      };
  }
}

export async function claudeAgentDirect(
  agent: AgentDefinition,
  input: string,
  onStream?: (chunk: string) => void,
  modelOverride?: string
) {
  const startTime = Date.now();
  const provider = getCurrentProvider();

  logger.info('Starting Direct Anthropic SDK (no Claude Code dependency)', {
    agent: agent.name,
    provider,
    input: input.substring(0, 100),
    model: modelOverride || 'default'
  });

  return withRetry(async () => {
    const modelConfig = getModelForProvider(provider);
    const finalModel = modelOverride || modelConfig.model;

    // Create Anthropic client with provider-specific configuration
    const anthropic = new Anthropic({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL, // undefined for direct Anthropic, proxy URL for others
      timeout: 120000,
      maxRetries: 3
    });

    logger.info('Direct API configuration', {
      provider,
      model: finalModel,
      hasApiKey: !!modelConfig.apiKey,
      hasBaseURL: !!modelConfig.baseURL
    });

    try {
      // Build messages array
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: input }
      ];

      // Call Anthropic API directly (no Claude Code subprocess)
      const stream = await anthropic.messages.create({
        model: finalModel,
        max_tokens: 4096,
        system: agent.systemPrompt,
        messages,
        stream: true
      });

      let output = '';
      let toolCallCount = 0;

      // Process streaming response
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            // Text content start
            continue;
          } else if (event.content_block.type === 'tool_use') {
            // Tool use detected
            toolCallCount++;
            const toolName = event.content_block.name || 'unknown';
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const progressMsg = `\n[${timestamp}] 🔍 Tool call #${toolCallCount}: ${toolName}\n`;
            process.stderr.write(progressMsg);

            if (onStream) {
              onStream(progressMsg);
            }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const chunk = event.delta.text;
            output += chunk;

            if (onStream && chunk) {
              onStream(chunk);
            }
          }
        } else if (event.type === 'content_block_stop') {
          if (toolCallCount > 0) {
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const resultMsg = `[${timestamp}] ✅ Tool completed\n`;
            process.stderr.write(resultMsg);

            if (onStream) {
              onStream(resultMsg);
            }
          }
        } else if (event.type === 'message_stop') {
          // Stream complete
          break;
        }

        // Flush output for immediate visibility
        if (process.stderr.uncork) {
          process.stderr.uncork();
        }
        if (process.stdout.uncork) {
          process.stdout.uncork();
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Direct SDK completed', {
        agent: agent.name,
        provider,
        duration,
        outputLength: output.length
      });

      return { output, agent: agent.name };
    } catch (error: any) {
      logger.error('Direct SDK execution failed', {
        provider,
        model: finalModel,
        error: error.message
      });
      throw error;
    }
  });
}
