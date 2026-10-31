// Anthropic to ONNX Local Proxy Server
// Converts Anthropic API format to ONNX Runtime local inference
import express, { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { resolveProxyHost } from './proxy-auth.js';
import { ONNXLocalProvider } from '../router/providers/onnx-local.js';
import type { Message } from '../router/types.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: any }>;
}

interface AnthropicRequest {
  model?: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  system?: string | Array<{ type: string; text?: string; [key: string]: any }>;
  stream?: boolean;
  [key: string]: any;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicToONNXProxy {
  private app: express.Application;
  private onnxProvider: ONNXLocalProvider;
  private port: number;
  private server: any;

  constructor(config: {
    port?: number;
    modelPath?: string;
    executionProviders?: string[];
  } = {}) {
    this.app = express();
    this.port = config.port || 3001;

    // Initialize ONNX provider with configuration
    this.onnxProvider = new ONNXLocalProvider({
      modelPath: config.modelPath,
      executionProviders: config.executionProviders || ['cpu'],
      maxTokens: 512,
      temperature: 0.7
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json({ limit: '50mb' }));

    // Logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      logger.debug('ONNX proxy request', {
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
      const modelInfo = this.onnxProvider.getModelInfo();
      res.json({
        status: 'ok',
        service: 'anthropic-to-onnx-proxy',
        onnx: {
          initialized: modelInfo.initialized,
          tokenizerLoaded: modelInfo.tokenizerLoaded,
          executionProviders: modelInfo.executionProviders
        }
      });
    });

    // Anthropic Messages API → ONNX Local Inference
    this.app.post('/v1/messages', async (req: Request, res: Response) => {
      try {
        const anthropicReq: AnthropicRequest = req.body;

        // Extract system prompt
        let systemPrompt = '';
        if (typeof anthropicReq.system === 'string') {
          systemPrompt = anthropicReq.system;
        } else if (Array.isArray(anthropicReq.system)) {
          systemPrompt = anthropicReq.system
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');
        }

        logger.info('Converting Anthropic request to ONNX', {
          anthropicModel: anthropicReq.model,
          onnxModel: 'Phi-4-mini-instruct',
          messageCount: anthropicReq.messages.length,
          systemPromptLength: systemPrompt.length,
          maxTokens: anthropicReq.max_tokens,
          temperature: anthropicReq.temperature
        });

        // Convert Anthropic messages to internal format
        const messages: Message[] = [];

        // Add system message if present
        if (systemPrompt) {
          messages.push({
            role: 'system',
            content: systemPrompt
          });
        }

        // Add user/assistant messages
        for (const msg of anthropicReq.messages) {
          let content: string;
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else {
            content = msg.content
              .filter((block: any) => block.type === 'text')
              .map((block: any) => block.text || '')
              .join('\n');
          }

          messages.push({
            role: msg.role,
            content
          });
        }

        // Streaming not supported by ONNX provider yet
        if (anthropicReq.stream) {
          logger.warn('Streaming requested but not supported by ONNX provider, falling back to non-streaming');
        }

        // Run ONNX inference
        const result = await this.onnxProvider.chat({
          model: 'phi-4-mini-instruct',
          messages,
          maxTokens: anthropicReq.max_tokens || 512,
          temperature: anthropicReq.temperature || 0.7
        });

        // Convert ONNX response to Anthropic format
        const anthropicResponse: AnthropicResponse = {
          id: result.id,
          type: 'message',
          role: 'assistant',
          content: result.content.map(block => ({
            type: 'text',
            text: block.text || ''
          })),
          model: 'onnx-local/phi-4-mini-instruct',
          stop_reason: result.stopReason || 'end_turn',
          usage: {
            input_tokens: result.usage?.inputTokens || 0,
            output_tokens: result.usage?.outputTokens || 0
          }
        };

        logger.info('ONNX inference completed', {
          inputTokens: result.usage?.inputTokens || 0,
          outputTokens: result.usage?.outputTokens || 0,
          latency: result.metadata?.latency,
          tokensPerSecond: result.metadata?.tokensPerSecond
        });

        res.json(anthropicResponse);

      } catch (error: any) {
        logger.error('ONNX proxy error', {
          error: error.message,
          provider: error.provider,
          retryable: error.retryable
        });

        res.status(500).json({
          error: {
            type: 'api_error',
            message: `ONNX inference failed: ${error.message}`
          }
        });
      }
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: {
          type: 'not_found',
          message: `Route not found: ${req.method} ${req.path}`
        }
      });
    });
  }

  /** Binds 127.0.0.1 unless `host` or AGENTIC_FLOW_PROXY_HOST says otherwise. */
  start(host: string = resolveProxyHost()): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, host, () => {
        logger.info('ONNX proxy server started', {
          port: this.port,
          host,
          endpoint: `http://localhost:${this.port}`,
          healthCheck: `http://localhost:${this.port}/health`,
          messagesEndpoint: `http://localhost:${this.port}/v1/messages`
        });
        console.log(`\n🚀 ONNX Proxy Server running on http://localhost:${this.port}`);
        console.log(`   📋 Messages API: POST http://localhost:${this.port}/v1/messages`);
        console.log(`   ❤️  Health check: GET http://localhost:${this.port}/health\n`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('ONNX proxy server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.onnxProvider.dispose();
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const proxy = new AnthropicToONNXProxy({
    port: parseInt(process.env.ONNX_PROXY_PORT || '3001')
  });

  proxy.start().catch(error => {
    console.error('Failed to start ONNX proxy:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down ONNX proxy...');
    await proxy.dispose();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down ONNX proxy...');
    await proxy.dispose();
    process.exit(0);
  });
}
