// Anthropic to Requesty Proxy Server
// Converts Anthropic API format to Requesty format
import express, { Request, Response, NextFunction } from 'express';
import type { Server } from 'http';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { logger } from '../utils/logger.js';
import { createProxyAuthMiddleware, resolveProxyHost, resolveProxyToken } from './proxy-auth.js';
import { forEachSseLines, sseLines } from './sse-lines.js';
import { getInstructionsForModel, formatInstructions, taskRequiresFileOps, getMaxTokensForModel } from './provider-instructions.js';
import { ModelCapabilities, detectModelCapabilities } from '../utils/modelCapabilities.js';
import { ToolEmulator, executeEmulation, ToolCall } from './tool-emulation.js';

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
  system?: string | Array<{ type: string; text?: string; [key: string]: any }>; // Can be string OR array of blocks
  stream?: boolean;
  tools?: AnthropicTool[];
  [key: string]: any;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: any;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  [key: string]: any;
}

export class AnthropicToRequestyProxy {
  private app: express.Application;
  private requestyApiKey: string;
  private requestyBaseUrl: string;
  private defaultModel: string;
  private authToken: string;
  private server?: Server;
  private capabilities?: ModelCapabilities;

  constructor(config: {
    requestyApiKey: string;
    requestyBaseUrl?: string;
    defaultModel?: string;
    capabilities?: ModelCapabilities;
    /** Token clients must send; defaults to AGENTIC_FLOW_PROXY_TOKEN or a random one. */
    authToken?: string;
  }) {
    this.app = express();
    this.authToken = config.authToken || resolveProxyToken();
    this.requestyApiKey = config.requestyApiKey;
    this.requestyBaseUrl = config.requestyBaseUrl || 'https://router.requesty.ai/v1';
    this.defaultModel = config.defaultModel || 'deepseek/deepseek-chat';
    this.capabilities = config.capabilities;

    // Debug logging
    if (this.capabilities) {
      logger.info('Proxy initialized with capabilities', {
        model: this.defaultModel,
        requiresEmulation: this.capabilities.requiresEmulation,
        strategy: this.capabilities.emulationStrategy
      });
    }

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
      logger.debug('Proxy request', {
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
      res.json({ status: 'ok', service: 'anthropic-to-requesty-proxy' });
    });

    // Anthropic Messages API → Requesty Chat Completions
    this.app.post('/v1/messages', async (req: Request, res: Response) => {
      console.log('🔵 REQUEST RECEIVED AT PROXY - /v1/messages');
      logger.info('🔵 REQUEST RECEIVED AT PROXY - /v1/messages');
      try {
        const anthropicReq: AnthropicRequest = req.body;
        console.log('🔵 Request body parsed successfully');

        // VERBOSE LOGGING: Log incoming Anthropic request
        // Handle system prompt which can be string OR array of content blocks
        const systemPreview = typeof anthropicReq.system === 'string'
          ? anthropicReq.system.substring(0, 200)
          : Array.isArray(anthropicReq.system)
          ? JSON.stringify(anthropicReq.system).substring(0, 200)
          : undefined;

        logger.debug('=== INCOMING ANTHROPIC REQUEST ===', {
          model: anthropicReq.model,
          systemPrompt: systemPreview,
          systemType: typeof anthropicReq.system,
          messageCount: anthropicReq.messages?.length,
          toolCount: anthropicReq.tools?.length || 0,
          toolNames: anthropicReq.tools?.map(t => t.name) || [],
          maxTokens: anthropicReq.max_tokens,
          temperature: anthropicReq.temperature,
          stream: anthropicReq.stream
        });

        // Log first user message for debugging
        if (anthropicReq.messages && anthropicReq.messages.length > 0) {
          const firstMsg = anthropicReq.messages[0];
          logger.debug('First user message:', {
            role: firstMsg.role,
            contentPreview: typeof firstMsg.content === 'string'
              ? firstMsg.content.substring(0, 200)
              : JSON.stringify(firstMsg.content).substring(0, 200)
          });
        }

        // Route to appropriate handler based on capabilities
        const result = await this.handleRequest(anthropicReq, res);
        if (result) {
          res.json(result);
        }
      } catch (error: any) {
        logger.error('Proxy error', { error: error.message, stack: error.stack });
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
          message: `Endpoint ${req.path} not supported by proxy`
        }
      });
    });
  }

  private async handleRequest(anthropicReq: AnthropicRequest, res: Response): Promise<any> {
    let model = anthropicReq.model || this.defaultModel;

    // If SDK is requesting a Claude model but we're using Requesty with a different default,
    // override to use the CLI-specified model
    if (model.startsWith('claude-') && this.defaultModel && !this.defaultModel.startsWith('claude-')) {
      logger.info(`Overriding SDK Claude model ${model} with CLI-specified ${this.defaultModel}`);
      model = this.defaultModel;
      anthropicReq.model = model;
    }

    const capabilities = this.capabilities || detectModelCapabilities(model);

    // Check if emulation is required
    if (capabilities.requiresEmulation && anthropicReq.tools && anthropicReq.tools.length > 0) {
      logger.info(`Using tool emulation for model: ${model}`);
      return this.handleEmulatedRequest(anthropicReq, capabilities);
    }

    return this.handleNativeRequest(anthropicReq, res);
  }

  private async handleNativeRequest(anthropicReq: AnthropicRequest, res: Response): Promise<any> {
    // Convert Anthropic format to OpenAI format
    const openaiReq = this.convertAnthropicToOpenAI(anthropicReq);

    // VERBOSE LOGGING: Log converted OpenAI request
    logger.debug('=== CONVERTED OPENAI REQUEST ===', {
      anthropicModel: anthropicReq.model,
      openaiModel: openaiReq.model,
      messageCount: openaiReq.messages.length,
      systemPrompt: openaiReq.messages[0]?.content?.substring(0, 300),
      toolCount: openaiReq.tools?.length || 0,
      toolNames: openaiReq.tools?.map(t => t.function.name) || [],
      maxTokens: openaiReq.max_tokens,
      apiKeyPresent: !!this.requestyApiKey
    });

    // Forward to Requesty
    const response = await fetch(`${this.requestyBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.requestyApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/ruvnet/agentic-flow',
        'X-Title': 'Agentic Flow'
      },
      body: JSON.stringify(openaiReq)
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Requesty API error', { status: response.status, error });
      res.status(response.status).json({
        error: {
          type: 'api_error',
          message: error
        }
      });
      return null;
    }

    // VERBOSE LOGGING: Log Requesty response status
    logger.info('=== REQUESTY RESPONSE RECEIVED ===', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries((response.headers as any).entries())
    });

    // Handle streaming vs non-streaming
    if (anthropicReq.stream) {
      logger.info('Handling streaming response...');
      // Stream response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      await forEachSseLines(reader, lines => {
        const anthropicChunk = this.convertOpenAIStreamToAnthropic(lines);
        if (anthropicChunk) res.write(anthropicChunk);
      });

      res.end();
      return null; // Already sent response
    } else {
      logger.info('Handling non-streaming response...');
      // Non-streaming response
      const openaiRes = await response.json();

      // VERBOSE LOGGING: Log raw OpenAI response
      logger.debug('=== RAW OPENAI RESPONSE ===', {
        id: openaiRes.id,
        model: openaiRes.model,
        choices: openaiRes.choices?.length,
        finishReason: openaiRes.choices?.[0]?.finish_reason,
        hasToolCalls: !!(openaiRes.choices?.[0]?.message?.tool_calls),
        toolCallCount: openaiRes.choices?.[0]?.message?.tool_calls?.length || 0,
        toolCallNames: openaiRes.choices?.[0]?.message?.tool_calls?.map((tc: any) => tc.function.name) || [],
        contentPreview: openaiRes.choices?.[0]?.message?.content?.substring(0, 300),
        usage: openaiRes.usage
      });

      const anthropicRes = this.convertOpenAIToAnthropic(openaiRes);

      // VERBOSE LOGGING: Log converted Anthropic response
      logger.info('=== CONVERTED ANTHROPIC RESPONSE ===', {
        id: anthropicRes.id,
        model: anthropicRes.model,
        role: anthropicRes.role,
        stopReason: anthropicRes.stop_reason,
        contentBlocks: anthropicRes.content?.length,
        contentTypes: anthropicRes.content?.map((c: any) => c.type),
        toolUseCount: anthropicRes.content?.filter((c: any) => c.type === 'tool_use').length,
        textPreview: anthropicRes.content?.find((c: any) => c.type === 'text')?.text?.substring(0, 200),
        usage: anthropicRes.usage
      });

      return anthropicRes;
    }
  }

  private async handleEmulatedRequest(
    anthropicReq: AnthropicRequest,
    capabilities: ModelCapabilities
  ): Promise<any> {
    const emulator = new ToolEmulator(
      anthropicReq.tools || [],
      capabilities.emulationStrategy as 'react' | 'prompt'
    );

    const lastMessage = anthropicReq.messages[anthropicReq.messages.length - 1];
    const userMessage = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : (lastMessage.content.find(c => c.type === 'text')?.text || '');

    const result = await executeEmulation(
      emulator,
      userMessage,
      async (prompt) => {
        // Call model with emulation prompt
        // Cap max_tokens at 8192 for OpenAI models via Requesty
        let maxTokens = anthropicReq.max_tokens;
        if (maxTokens && maxTokens > 8192) {
          maxTokens = 8192;
        }
        const openaiReq = {
          model: anthropicReq.model || this.defaultModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: anthropicReq.temperature,
          max_tokens: maxTokens
        };
        const response = await this.callRequesty(openaiReq);
        return response.choices[0].message.content;
      },
      async (toolCall: ToolCall) => {
        logger.warn(`Tool execution not yet implemented: ${toolCall.name}`);
        return { error: 'Tool execution not implemented in Phase 2' };
      },
      { maxIterations: 5, verbose: process.env.VERBOSE === 'true' }
    );

    return {
      id: `emulated_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: result.finalAnswer || 'No response' }],
      model: anthropicReq.model || this.defaultModel,
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }

  private async callRequesty(openaiReq: any): Promise<any> {
    // Add timeout for Requesty API calls (60 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${this.requestyBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.requestyApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/ruvnet/agentic-flow',
          'X-Title': 'Agentic Flow'
        },
        body: JSON.stringify(openaiReq),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Requesty API error: ${error}`);
      }

      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Requesty API request timed out after 60 seconds');
      }
      throw error;
    }
  }


  /**
   * Sanitize JSON Schema to be OpenAI-compatible
   * Fixes array properties without items, removes unsupported keywords
   */
  private sanitizeJsonSchema(schema: any, path: string = 'root'): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    // Create a shallow copy to avoid mutations
    const sanitized = { ...schema };

    // Fix array types without items
    if (sanitized.type === 'array' && !sanitized.items) {
      logger.warn(`Schema sanitization: Adding missing 'items' for array at ${path}`);
      sanitized.items = { type: 'string' };
    }

    // Remove JSON Schema 2020-12 keywords not supported by OpenAI
    const unsupportedKeywords = [
      '$schema', '$id', '$ref', '$defs', 'definitions',
      'if', 'then', 'else', 'dependentSchemas', 'dependentRequired',
      'prefixItems', 'unevaluatedItems', 'unevaluatedProperties',
      'minContains', 'maxContains', 'patternProperties',
      'additionalItems', 'contains'
    ];

    for (const keyword of unsupportedKeywords) {
      if (keyword in sanitized) {
        logger.warn(`Schema sanitization: Removing unsupported keyword '${keyword}' at ${path}`);
        delete sanitized[keyword];
      }
    }

    // Recursively sanitize nested properties
    if (sanitized.properties && typeof sanitized.properties === 'object') {
      sanitized.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        sanitized.properties[key] = this.sanitizeJsonSchema(value, `${path}.properties.${key}`);
      }
    }

    // Recursively sanitize array items
    if (sanitized.items && typeof sanitized.items === 'object') {
      sanitized.items = this.sanitizeJsonSchema(sanitized.items, `${path}.items`);
    }

    // Recursively sanitize allOf, anyOf, oneOf
    for (const combinator of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(sanitized[combinator])) {
        sanitized[combinator] = sanitized[combinator].map((subschema: any, index: number) =>
          this.sanitizeJsonSchema(subschema, `${path}.${combinator}[${index}]`)
        );
      }
    }

    return sanitized;
  }

  private convertAnthropicToOpenAI(anthropicReq: AnthropicRequest): OpenAIRequest {
    logger.info('=== STARTING ANTHROPIC TO OPENAI CONVERSION ===');
    const messages: OpenAIMessage[] = [];

    // Get model-specific tool instructions
    const modelId = anthropicReq.model || this.defaultModel;
    const provider = this.extractProvider(modelId);

    logger.info('Model detection:', {
      requestedModel: anthropicReq.model,
      defaultModel: this.defaultModel,
      finalModelId: modelId,
      extractedProvider: provider
    });

    // CRITICAL: Requesty models use native OpenAI tool calling
    // - If MCP tools are provided, Requesty handles them via function calling
    // - Do NOT inject XML instructions - they cause malformed output
    // - Let Requesty models use tools via OpenAI's tool_calls format

    let systemContent = '';

    // Check if we have MCP tools (function calling)
    const hasMcpTools = anthropicReq.tools && anthropicReq.tools.length > 0;

    logger.info('Tool detection:', {
      hasMcpTools,
      toolCount: anthropicReq.tools?.length || 0,
      toolNames: anthropicReq.tools?.map(t => t.name) || []
    });

    if (hasMcpTools) {
      // MCP tools present - Requesty will handle via function calling
      systemContent = 'You are a helpful AI assistant. When you need to perform actions, use the available tools by calling functions. Always explain what you\'re doing.';
      logger.info('Using MCP tools system prompt (with function calling support)');
    } else {
      // No tools - simple response mode
      systemContent = 'You are a helpful AI assistant. Provide clear, well-formatted code and explanations.';
      logger.info('Using simple system prompt (no tools)');
    }

    if (anthropicReq.system) {
      // System can be string OR array of content blocks
      let originalSystem: string;
      if (typeof anthropicReq.system === 'string') {
        originalSystem = anthropicReq.system;
      } else if (Array.isArray(anthropicReq.system)) {
        // Extract text from content blocks
        originalSystem = anthropicReq.system
          .filter(block => block.type === 'text' && block.text)
          .map(block => block.text)
          .join('\n');
      } else {
        originalSystem = '';
      }

      logger.debug('Appending original system prompt:', {
        systemType: typeof anthropicReq.system,
        isArray: Array.isArray(anthropicReq.system),
        originalSystemLength: originalSystem.length,
        originalSystemPreview: originalSystem.substring(0, 200)
      });

      if (originalSystem) {
        systemContent += '\n\n' + originalSystem;
      }
    }

    messages.push({
      role: 'system',
      content: systemContent
    });

    logger.info('System message created:', {
      systemContentLength: systemContent.length,
      systemContentPreview: systemContent.substring(0, 300)
    });

    // Override model - if request has a Claude model, use defaultModel instead
    const requestedModel = anthropicReq.model || '';
    const shouldOverrideModel = requestedModel.startsWith('claude-') || !requestedModel;
    const finalModel = shouldOverrideModel ? this.defaultModel : requestedModel;

    // Convert Anthropic messages to OpenAI format
    for (const msg of anthropicReq.messages) {
      let content: string;

      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Extract text from content blocks
        content = msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
      } else {
        content = '';
      }

      messages.push({
        role: msg.role as 'user' | 'assistant',
        content
      });
    }

    // Get appropriate max_tokens for this model
    let maxTokens = getMaxTokensForModel(finalModel, anthropicReq.max_tokens);

    // Cap at 8192 for OpenAI models via Requesty
    if (maxTokens && maxTokens > 8192) {
      maxTokens = 8192;
    }

    const openaiReq: OpenAIRequest = {
      model: finalModel,
      messages,
      max_tokens: maxTokens,
      temperature: anthropicReq.temperature,
      stream: anthropicReq.stream
    };

    // Convert MCP/Anthropic tools to OpenAI tools format
    if (anthropicReq.tools && anthropicReq.tools.length > 0) {
      logger.info('Converting MCP tools to OpenAI format...', {
        totalTools: anthropicReq.tools.length
      });

      // Requesty has strict limits - only send a subset of tools to avoid timeouts
      // Requesty also rejects empty tools arrays, so we either send tools or omit the parameter
      const MAX_TOOLS_FOR_REQUESTY = 10; // Very conservative limit - Requesty timeouts with more
      const toolsToConvert = anthropicReq.tools.slice(0, MAX_TOOLS_FOR_REQUESTY);

      if (anthropicReq.tools.length > MAX_TOOLS_FOR_REQUESTY) {
        logger.warn(`Limiting tools to ${MAX_TOOLS_FOR_REQUESTY} for Requesty (${anthropicReq.tools.length} available)`);
      }

      // Only set tools if we have at least one (Requesty rejects empty arrays)
      if (toolsToConvert.length > 0) {
        openaiReq.tools = toolsToConvert.map(tool => {
          // Sanitize the input schema to fix array properties without items
          const rawSchema = tool.input_schema || {
            type: 'object',
            properties: {},
            required: []
          };
          const sanitizedSchema = this.sanitizeJsonSchema(rawSchema, `tool.${tool.name}`);

          const openaiTool = {
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description || '',
              parameters: sanitizedSchema
            }
          };
          return openaiTool;
        });

        logger.info('Forwarding MCP tools to Requesty', {
          toolCount: openaiReq.tools.length,
          toolNames: openaiReq.tools.map(t => t.function.name).slice(0, 5)
        });
      } else {
        logger.info('No tools to send (omitting tools parameter entirely for Requesty)');
        // Don't set openaiReq.tools at all - Requesty rejects empty arrays
      }
    } else {
      logger.info('No MCP tools to convert');
    }

    logger.info('=== CONVERSION COMPLETE ===', {
      messageCount: openaiReq.messages.length,
      hasMcpTools: !!openaiReq.tools,
      toolCount: openaiReq.tools?.length || 0,
      maxTokens: openaiReq.max_tokens,
      model: openaiReq.model
    });

    return openaiReq;
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

  private convertOpenAIToAnthropic(openaiRes: any): any {
    const choice = openaiRes.choices?.[0];
    if (!choice) {
      throw new Error('No choices in OpenAI response');
    }

    const message = choice.message || {};
    const rawText = message.content || choice.text || '';
    const toolCalls = message.tool_calls || [];

    logger.info('=== CONVERTING OPENAI TO ANTHROPIC ===', {
      hasMessage: !!message,
      hasContent: !!rawText,
      contentLength: rawText?.length,
      hasToolCalls: toolCalls.length > 0,
      toolCallCount: toolCalls.length,
      finishReason: choice.finish_reason
    });

    // CRITICAL: Use ONLY native OpenAI tool_calls format
    // Do NOT parse XML from text - models output malformed XML
    // Requesty handles tools via OpenAI function calling standard

    const contentBlocks: any[] = [];

    // Add tool uses from OpenAI tool_calls (MCP tools via function calling)
    if (toolCalls.length > 0) {
      logger.info('Processing tool calls from OpenAI response...');
      for (const toolCall of toolCalls) {
        try {
          logger.info('Tool call details:', {
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsRaw: toolCall.function.arguments
          });

          contentBlocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments || '{}')
          });
        } catch (error) {
          logger.error('Failed to parse tool call arguments', {
            toolCall,
            error: (error as Error).message
          });
        }
      }

      logger.info('Converted Requesty tool calls to Anthropic format', {
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map((tc: any) => tc.function.name)
      });
    }

    // Add text response if present
    if (rawText && rawText.trim()) {
      logger.info('Adding text content block', {
        textLength: rawText.length,
        textPreview: rawText.substring(0, 200)
      });
      contentBlocks.push({
        type: 'text',
        text: rawText
      });
    }

    // If no content blocks, add empty text
    if (contentBlocks.length === 0) {
      logger.warn('No content blocks found, adding empty text block');
      contentBlocks.push({
        type: 'text',
        text: rawText || ''
      });
    }

    logger.info('Final content blocks:', {
      blockCount: contentBlocks.length,
      blockTypes: contentBlocks.map(b => b.type)
    });

    const result = {
      id: openaiRes.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: openaiRes.model,
      content: contentBlocks,
      stop_reason: this.mapFinishReason(choice.finish_reason),
      usage: {
        input_tokens: openaiRes.usage?.prompt_tokens || 0,
        output_tokens: openaiRes.usage?.completion_tokens || 0
      }
    };

    logger.info('Conversion complete, returning Anthropic response');
    return result;
  }

  // Takes only complete lines; forEachSseLines buffers any partial tail.
  private convertOpenAIStreamToAnthropic(chunk: string): string {
    // Convert OpenAI SSE format to Anthropic SSE format
    const lines = sseLines(chunk);
    const anthropicChunks: string[] = [];

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          anthropicChunks.push('event: message_stop\ndata: {}\n\n');
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          if (delta?.content) {
            anthropicChunks.push(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: delta.content }
              })}\n\n`
            );
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    return anthropicChunks.join('');
  }

  private extractProvider(modelId: string): string {
    // Extract provider from model ID (e.g., "openai/gpt-4" -> "openai")
    const parts = modelId.split('/');
    return parts.length > 1 ? parts[0] : '';
  }

  private mapFinishReason(reason?: string): string {
    const mapping: Record<string, string> = {
      'stop': 'end_turn',
      'length': 'max_tokens',
      'content_filter': 'stop_sequence',
      'function_call': 'tool_use'
    };
    return mapping[reason || 'stop'] || 'end_turn';
  }

  /**
   * Start listening. Binds 127.0.0.1 unless `host` or AGENTIC_FLOW_PROXY_HOST
   * says otherwise. Returns the underlying server.
   */
  public start(port: number, host: string = resolveProxyHost()): Server {
    this.server = this.app.listen(port, host, () => {
      logger.info('Anthropic to Requesty proxy started', {
        port,
        host,
        requestyBaseUrl: this.requestyBaseUrl,
        defaultModel: this.defaultModel
      });
      console.log(`\n✅ Anthropic Proxy running at http://${host}:${port}`);
      console.log(`   Requesty Base URL: ${this.requestyBaseUrl}`);
      console.log(`   Default Model: ${this.defaultModel}`);

      if (this.capabilities?.requiresEmulation) {
        console.log(`\n   ⚙️  Tool Emulation: ${this.capabilities.emulationStrategy.toUpperCase()} pattern`);
        console.log(`   📊 Expected reliability: ${this.capabilities.emulationStrategy === 'react' ? '70-85%' : '50-70%'}`);
      }
      console.log('');
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
  const port = parseInt(process.env.PORT || '3000');
  const requestyApiKey = process.env.REQUESTY_API_KEY;

  if (!requestyApiKey) {
    console.error('❌ Error: REQUESTY_API_KEY environment variable required');
    process.exit(1);
  }

  const proxy = new AnthropicToRequestyProxy({
    requestyApiKey,
    requestyBaseUrl: process.env.ANTHROPIC_PROXY_BASE_URL,
    defaultModel: process.env.COMPLETION_MODEL || process.env.REASONING_MODEL
  });

  proxy.start(port);
  console.log(`   Proxy token (send as x-api-key / ANTHROPIC_API_KEY): ${proxy.getAuthToken()}`);
}
