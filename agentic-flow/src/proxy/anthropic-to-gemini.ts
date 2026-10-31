// Anthropic to Gemini Proxy Server
// Converts Anthropic API format to Google Gemini format
import express, { Request, Response, NextFunction } from 'express';
import type { Server } from 'http';
import { logger } from '../utils/logger.js';
import { createProxyAuthMiddleware, resolveProxyHost, resolveProxyToken } from './proxy-auth.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: any }>;
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface AnthropicRequest {
  model?: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  system?: string;
  stream?: boolean;
  tools?: AnthropicTool[];
  [key: string]: any;
}

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: any;
  }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    [key: string]: any;
  };
  tools?: GeminiTool[];
}

export class AnthropicToGeminiProxy {
  private app: express.Application;
  private geminiApiKey: string;
  private geminiBaseUrl: string;
  private defaultModel: string;
  private authToken: string;
  private server?: Server;

  constructor(config: {
    geminiApiKey: string;
    geminiBaseUrl?: string;
    defaultModel?: string;
    /** Token clients must send; defaults to AGENTIC_FLOW_PROXY_TOKEN or a random one. */
    authToken?: string;
  }) {
    this.app = express();
    this.authToken = config.authToken || resolveProxyToken();
    this.geminiApiKey = config.geminiApiKey;
    this.geminiBaseUrl = config.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = config.defaultModel || 'gemini-2.0-flash-exp';

    this.setupMiddleware();
    this.setupRoutes();
  }

  /** The token clients must present as x-api-key or Authorization: Bearer. */
  public getAuthToken(): string {
    return this.authToken;
  }

  private setupMiddleware(): void {
    // Reject unauthenticated callers before parsing their (up to 50mb) body
    this.app.use(createProxyAuthMiddleware(this.authToken));

    // Parse JSON bodies
    this.app.use(express.json({ limit: '50mb' }));

    // Logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      logger.debug('Gemini proxy request', {
        method: req.method,
        path: req.path,
        headers: Object.keys(req.headers)
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'anthropic-to-gemini-proxy' });
    });

    // Anthropic Messages API → Gemini generateContent
    this.app.post('/v1/messages', async (req: Request, res: Response) => {
      try {
        const anthropicReq: AnthropicRequest = req.body;

        // Convert Anthropic format to Gemini format
        const geminiReq = this.convertAnthropicToGemini(anthropicReq);

        logger.info('Converting Anthropic request to Gemini', {
          anthropicModel: anthropicReq.model,
          geminiModel: this.defaultModel,
          messageCount: geminiReq.contents.length,
          stream: anthropicReq.stream,
          apiKeyPresent: !!this.geminiApiKey
        });

        // Determine endpoint based on streaming
        const endpoint = anthropicReq.stream ? 'streamGenerateContent' : 'generateContent';
        // BUG FIX: Add &alt=sse for streaming to get Server-Sent Events format
        const streamParam = anthropicReq.stream ? '&alt=sse' : '';
        const url = `${this.geminiBaseUrl}/models/${this.defaultModel}:${endpoint}?key=${this.geminiApiKey}${streamParam}`;

        // Forward to Gemini
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(geminiReq)
        });

        if (!response.ok) {
          const error = await response.text();
          logger.error('Gemini API error', { status: response.status, error });
          return res.status(response.status).json({
            error: {
              type: 'api_error',
              message: error
            }
          });
        }

        // Handle streaming vs non-streaming
        if (anthropicReq.stream) {
          // Stream response
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body');
          }

          const decoder = new TextDecoder();
          let chunkCount = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            chunkCount++;
            logger.debug('Gemini stream chunk received', { chunkCount, chunkLength: chunk.length, chunkPreview: chunk.substring(0, 200) });

            const anthropicChunk = this.convertGeminiStreamToAnthropic(chunk);
            logger.debug('Anthropic stream chunk generated', { chunkCount, anthropicLength: anthropicChunk.length, anthropicPreview: anthropicChunk.substring(0, 200) });

            res.write(anthropicChunk);
          }

          logger.info('Gemini stream complete', { totalChunks: chunkCount });
          res.end();
        } else {
          // Non-streaming response
          const geminiRes = await response.json();

          // DEBUG: Log raw Gemini response
          logger.debug('Raw Gemini API response', {
            hasResponse: !!geminiRes,
            hasCandidates: !!geminiRes.candidates,
            candidatesLength: geminiRes.candidates?.length,
            firstCandidate: geminiRes.candidates?.[0],
            fullResponse: JSON.stringify(geminiRes).substring(0, 500)
          });

          const anthropicRes = this.convertGeminiToAnthropic(geminiRes);

          logger.info('Gemini proxy response sent', {
            model: this.defaultModel,
            usage: anthropicRes.usage,
            contentBlocks: anthropicRes.content?.length,
            hasText: anthropicRes.content?.some((c: any) => c.type === 'text'),
            firstContent: anthropicRes.content?.[0]
          });

          res.json(anthropicRes);
        }
      } catch (error: any) {
        logger.error('Gemini proxy error', { error: error.message, stack: error.stack });
        res.status(500).json({
          error: {
            type: 'proxy_error',
            message: error.message
          }
        });
      }
    });

    // Fallback for other Anthropic API endpoints
    this.app.use((req: Request, res: Response) => {
      logger.warn('Unsupported endpoint', { path: req.path, method: req.method });
      res.status(404).json({
        error: {
          type: 'not_found',
          message: `Endpoint ${req.path} not supported by Gemini proxy`
        }
      });
    });
  }

  private convertAnthropicToGemini(anthropicReq: AnthropicRequest): GeminiRequest {
    const contents: GeminiContent[] = [];

    // Add system message as first user message if present
    // Gemini doesn't have a dedicated system role, so we prepend it to the first user message
    let systemPrefix = '';
    if (anthropicReq.system) {
      systemPrefix = `System: ${anthropicReq.system}\n\n`;
    }

    // Add tool instructions for Gemini to understand file operations
    // Since Gemini doesn't have native tool calling, we instruct it to use structured XML-like commands
    const toolInstructions = `
IMPORTANT: You have access to file system operations through structured commands. Use these exact formats:

<file_write path="filename.ext">
content here
</file_write>

<file_read path="filename.ext"/>

<bash_command>
command here
</bash_command>

When you need to create, edit, or read files, use these structured commands in your response.
The system will automatically execute these commands and provide results.

`;

    // Prepend tool instructions to system prompt
    if (systemPrefix) {
      systemPrefix = toolInstructions + systemPrefix;
    } else {
      systemPrefix = toolInstructions;
    }

    // Convert Anthropic messages to Gemini format
    for (let i = 0; i < anthropicReq.messages.length; i++) {
      const msg = anthropicReq.messages[i];
      let text: string;

      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Extract text from content blocks
        text = msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
      } else {
        text = '';
      }

      // Add system prefix to first user message
      if (i === 0 && msg.role === 'user' && systemPrefix) {
        text = systemPrefix + text;
      }

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text }]
      });
    }

    const geminiReq: GeminiRequest = {
      contents
    };

    // Add generation config if temperature or max_tokens specified
    if (anthropicReq.temperature !== undefined || anthropicReq.max_tokens !== undefined) {
      geminiReq.generationConfig = {};

      if (anthropicReq.temperature !== undefined) {
        geminiReq.generationConfig.temperature = anthropicReq.temperature;
      }

      if (anthropicReq.max_tokens !== undefined) {
        geminiReq.generationConfig.maxOutputTokens = anthropicReq.max_tokens;
      }
    }

    // Convert MCP/Anthropic tools to Gemini tools format
    if (anthropicReq.tools && anthropicReq.tools.length > 0) {
      geminiReq.tools = [{
        functionDeclarations: anthropicReq.tools.map(tool => {
          // Clean schema: Remove fields that Gemini doesn't support
          const cleanSchema = (schema: any): any => {
            if (!schema || typeof schema !== 'object') return schema;

            const {
              $schema,
              additionalProperties,
              exclusiveMinimum,
              exclusiveMaximum,
              ...rest
            } = schema;
            const cleaned: any = { ...rest };

            // Recursively clean nested objects
            if (cleaned.properties) {
              cleaned.properties = Object.fromEntries(
                Object.entries(cleaned.properties).map(([key, value]: [string, any]) => [
                  key,
                  cleanSchema(value)
                ])
              );
            }

            // Clean items if present
            if (cleaned.items) {
              cleaned.items = cleanSchema(cleaned.items);
            }

            return cleaned;
          };

          return {
            name: tool.name,
            description: tool.description || '',
            parameters: cleanSchema(tool.input_schema) || {
              type: 'object',
              properties: {},
              required: []
            }
          };
        })
      }];

      logger.info('Forwarding MCP tools to Gemini', {
        toolCount: anthropicReq.tools.length,
        toolNames: anthropicReq.tools.map(t => t.name)
      });
    }

    return geminiReq;
  }

  private parseStructuredCommands(text: string): {
    cleanText: string;
    toolUses: any[]
  } {
    const toolUses: any[] = [];
    let cleanText = text;

    // Parse file_write commands
    const fileWriteRegex = /<file_write path="([^"]+)">([\s\S]*?)<\/file_write>/g;
    let match;
    while ((match = fileWriteRegex.exec(text)) !== null) {
      toolUses.push({
        type: 'tool_use',
        id: `tool_${Date.now()}_${toolUses.length}`,
        name: 'Write',
        input: {
          file_path: match[1],
          content: match[2].trim()
        }
      });
      cleanText = cleanText.replace(match[0], `[File written: ${match[1]}]`);
    }

    // Parse file_read commands
    const fileReadRegex = /<file_read path="([^"]+)"\/>/g;
    while ((match = fileReadRegex.exec(text)) !== null) {
      toolUses.push({
        type: 'tool_use',
        id: `tool_${Date.now()}_${toolUses.length}`,
        name: 'Read',
        input: {
          file_path: match[1]
        }
      });
      cleanText = cleanText.replace(match[0], `[Reading file: ${match[1]}]`);
    }

    // Parse bash commands
    const bashRegex = /<bash_command>([\s\S]*?)<\/bash_command>/g;
    while ((match = bashRegex.exec(text)) !== null) {
      toolUses.push({
        type: 'tool_use',
        id: `tool_${Date.now()}_${toolUses.length}`,
        name: 'Bash',
        input: {
          command: match[1].trim()
        }
      });
      cleanText = cleanText.replace(match[0], `[Executing: ${match[1].trim()}]`);
    }

    return { cleanText: cleanText.trim(), toolUses };
  }

  private convertGeminiToAnthropic(geminiRes: any): any {
    const candidate = geminiRes.candidates?.[0];
    if (!candidate) {
      logger.error('No candidates in Gemini response', { geminiRes });
      throw new Error('No candidates in Gemini response');
    }

    const content = candidate.content;
    const parts = content?.parts || [];

    logger.info('Converting Gemini to Anthropic', {
      hasParts: !!parts,
      partsCount: parts.length,
      partTypes: parts.map((p: any) => Object.keys(p))
    });

    // Extract text and function calls
    let rawText = '';
    const functionCalls: any[] = [];

    for (const part of parts) {
      if (part.text) {
        rawText += part.text;
        logger.debug('Found text in part', { textLength: part.text.length, textPreview: part.text.substring(0, 100) });
      }
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }

    logger.debug('Extracted content from Gemini', {
      rawTextLength: rawText.length,
      functionCallsCount: functionCalls.length,
      rawTextPreview: rawText.substring(0, 200)
    });

    // Parse structured commands from Gemini's text response
    const { cleanText, toolUses } = this.parseStructuredCommands(rawText);

    // Build content array with text and tool uses
    const contentBlocks: any[] = [];

    if (cleanText) {
      contentBlocks.push({
        type: 'text',
        text: cleanText
      });
    }

    // Add tool uses from structured commands
    contentBlocks.push(...toolUses);

    // Add tool uses from Gemini function calls (MCP tools)
    if (functionCalls.length > 0) {
      for (const functionCall of functionCalls) {
        contentBlocks.push({
          type: 'tool_use',
          id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: functionCall.name,
          input: functionCall.args || {}
        });
      }

      logger.info('Converted Gemini function calls to Anthropic format', {
        functionCallCount: functionCalls.length,
        functionNames: functionCalls.map((fc: any) => fc.name)
      });
    }

    return {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: this.defaultModel,
      content: contentBlocks.length > 0 ? contentBlocks : [
        {
          type: 'text',
          text: rawText
        }
      ],
      stop_reason: this.mapFinishReason(candidate.finishReason),
      usage: {
        input_tokens: geminiRes.usageMetadata?.promptTokenCount || 0,
        output_tokens: geminiRes.usageMetadata?.candidatesTokenCount || 0
      }
    };
  }

  private convertGeminiStreamToAnthropic(chunk: string): string {
    // Gemini streaming returns Server-Sent Events format: "data: {json}"
    const lines = chunk.split('\n').filter(line => line.trim());
    const anthropicChunks: string[] = [];

    for (const line of lines) {
      try {
        // Parse SSE format: "data: {json}"
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6); // Remove "data: " prefix
          const parsed = JSON.parse(jsonStr);
          const candidate = parsed.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text;

          if (text) {
            anthropicChunks.push(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                delta: { type: 'text_delta', text }
              })}\n\n`
            );
          }

          // Check for finish
          if (candidate?.finishReason) {
            anthropicChunks.push('event: message_stop\ndata: {}\n\n');
          }
        }
      } catch (e) {
        // Ignore parse errors
        logger.debug('Failed to parse Gemini stream chunk', { line, error: (e as Error).message });
      }
    }

    return anthropicChunks.join('');
  }

  private mapFinishReason(reason?: string): string {
    const mapping: Record<string, string> = {
      'STOP': 'end_turn',
      'MAX_TOKENS': 'max_tokens',
      'SAFETY': 'stop_sequence',
      'RECITATION': 'stop_sequence',
      'OTHER': 'end_turn'
    };
    return mapping[reason || 'STOP'] || 'end_turn';
  }

  /**
   * Start listening. Binds 127.0.0.1 unless `host` or AGENTIC_FLOW_PROXY_HOST
   * says otherwise. Returns the underlying server.
   */
  public start(port: number, host: string = resolveProxyHost()): Server {
    this.server = this.app.listen(port, host, () => {
      logger.info('Anthropic to Gemini proxy started', {
        port,
        host,
        geminiBaseUrl: this.geminiBaseUrl,
        defaultModel: this.defaultModel
      });
      console.log(`\n✅ Gemini Proxy running at http://${host}:${port}`);
      console.log(`   Gemini Base URL: ${this.geminiBaseUrl}`);
      console.log(`   Default Model: ${this.defaultModel}\n`);
    });
    return this.server;
  }

  /** Stop listening. Safe to call when the proxy was never started. */
  public stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3001');
  const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!geminiApiKey) {
    console.error('❌ Error: GOOGLE_GEMINI_API_KEY environment variable required');
    process.exit(1);
  }

  const proxy = new AnthropicToGeminiProxy({
    geminiApiKey,
    geminiBaseUrl: process.env.GEMINI_BASE_URL,
    defaultModel: process.env.COMPLETION_MODEL || process.env.REASONING_MODEL
  });

  proxy.start(port);
  console.log(`   Proxy token (send as x-api-key / ANTHROPIC_API_KEY): ${proxy.getAuthToken()}`);
}
