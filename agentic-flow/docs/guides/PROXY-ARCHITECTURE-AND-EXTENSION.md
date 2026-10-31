# Proxy Architecture and Extension Guide

## 📖 Table of Contents

- [How the Proxy Works](#how-the-proxy-works)
- [Architecture Overview](#architecture-overview)
- [Adding New Cloud Providers](#adding-new-cloud-providers)
- [Adding Local LLM Providers](#adding-local-llm-providers)
- [Message Format Conversion](#message-format-conversion)
- [Tool/Function Calling Support](#toolfunction-calling-support)
- [Testing Your Proxy](#testing-your-proxy)
- [Examples](#examples)

---

## How the Proxy Works

### The Problem

Claude Code and the Claude Agent SDK expect requests in **Anthropic's Messages API format**. When you want to use cheaper alternatives (OpenRouter, Gemini, local models), you need to:

1. Translate Anthropic request format → Provider's format
2. Forward request to the provider's API
3. Translate provider's response → Anthropic response format
4. Return to Claude Code/SDK (which thinks it's talking to Anthropic)

### The Solution

A transparent HTTP proxy that sits between Claude Code and the LLM provider:

```
┌─────────────┐       ┌──────────────┐       ┌──────────────┐
│ Claude Code │──────▶│ Proxy Server │──────▶│   Provider   │
│   /SDK      │       │ (localhost)  │       │ (OpenRouter, │
│             │◀──────│              │◀──────│  Gemini, etc)│
└─────────────┘       └──────────────┘       └──────────────┘
   Anthropic API         Translates            Provider API
```

**Key Benefits:**
- ✅ No code changes to Claude Code or Agent SDK
- ✅ 99% cost savings with OpenRouter models
- ✅ 100% free with Gemini free tier
- ✅ All MCP tools work through the proxy
- ✅ Streaming support
- ✅ Function/tool calling support

---

## Architecture Overview

### File Structure

```
src/proxy/
├── anthropic-to-openrouter.ts    # OpenRouter proxy
├── anthropic-to-gemini.ts        # Gemini proxy
└── provider-instructions.ts      # Model-specific configs
```

### Core Components

#### 1. **Express Server**
- Listens on port 3000 (configurable)
- Handles `/v1/messages` endpoint (Anthropic's Messages API)
- Health check at `/health`

#### 2. **Request Converter**
Translates Anthropic → Provider format:
```typescript
private convertAnthropicToOpenAI(anthropicReq: AnthropicRequest): OpenAIRequest {
  // 1. Extract system prompt
  // 2. Convert messages array
  // 3. Convert tools (if present)
  // 4. Map model names
  // 5. Apply provider-specific configs
}
```

#### 3. **Response Converter**
Translates Provider → Anthropic format:
```typescript
private convertOpenAIToAnthropic(openaiRes: any): any {
  // 1. Extract choice/candidate
  // 2. Convert tool_calls → tool_use blocks
  // 3. Extract text content
  // 4. Map finish reasons
  // 5. Convert usage stats
}
```

#### 4. **Streaming Handler**
For real-time token-by-token output:
```typescript
private convertOpenAIStreamToAnthropic(chunk: string): string {
  // Convert SSE format: OpenAI → Anthropic
}
```

---

## Adding New Cloud Providers

### Example: Adding Mistral AI

**Step 1: Create proxy file**

`src/proxy/anthropic-to-mistral.ts`:

```typescript
import express, { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { createProxyAuthMiddleware, resolveProxyHost, resolveProxyToken } from './proxy-auth.js';

interface MistralMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MistralRequest {
  model: string;
  messages: MistralMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

// Every proxy that holds an upstream key must bind loopback and require a
// token (3.0.0+). proxy-auth.ts gives you both.
export class AnthropicToMistralProxy {
  private app: express.Application;
  private mistralApiKey: string;
  private mistralBaseUrl: string;
  private defaultModel: string;
  private authToken: string;

  constructor(config: {
    mistralApiKey: string;
    mistralBaseUrl?: string;
    defaultModel?: string;
    authToken?: string; // default: AGENTIC_FLOW_PROXY_TOKEN or a random token
  }) {
    this.app = express();
    this.authToken = config.authToken || resolveProxyToken();
    this.mistralApiKey = config.mistralApiKey;
    this.mistralBaseUrl = config.mistralBaseUrl || 'https://api.mistral.ai/v1';
    this.defaultModel = config.defaultModel || 'mistral-large-latest';

    this.setupMiddleware();
    this.setupRoutes();
  }

  public getAuthToken(): string {
    return this.authToken;
  }

  private setupMiddleware(): void {
    // Reject callers without the token before parsing their body. /health stays open.
    this.app.use(createProxyAuthMiddleware(this.authToken));
    this.app.use(express.json({ limit: '50mb' }));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'anthropic-to-mistral-proxy' });
    });

    // Main conversion endpoint
    this.app.post('/v1/messages', async (req: Request, res: Response) => {
      try {
        const anthropicReq = req.body;

        // Convert Anthropic → Mistral
        const mistralReq = this.convertAnthropicToMistral(anthropicReq);

        // Forward to Mistral
        const response = await fetch(`${this.mistralBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.mistralApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mistralReq)
        });

        if (!response.ok) {
          const error = await response.text();
          logger.error('Mistral API error', { status: response.status, error });
          return res.status(response.status).json({
            error: { type: 'api_error', message: error }
          });
        }

        // Convert Mistral → Anthropic
        const mistralRes = await response.json();
        const anthropicRes = this.convertMistralToAnthropic(mistralRes);

        res.json(anthropicRes);
      } catch (error: any) {
        logger.error('Mistral proxy error', { error: error.message });
        res.status(500).json({
          error: { type: 'proxy_error', message: error.message }
        });
      }
    });
  }

  private convertAnthropicToMistral(anthropicReq: any): MistralRequest {
    const messages: MistralMessage[] = [];

    // Add system prompt if present
    if (anthropicReq.system) {
      messages.push({
        role: 'system',
        content: typeof anthropicReq.system === 'string'
          ? anthropicReq.system
          : anthropicReq.system.map((b: any) => b.text).join('\n')
      });
    }

    // Convert messages
    for (const msg of anthropicReq.messages) {
      messages.push({
        role: msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      });
    }

    return {
      model: this.defaultModel,
      messages,
      temperature: anthropicReq.temperature,
      max_tokens: anthropicReq.max_tokens || 4096,
      stream: anthropicReq.stream || false
    };
  }

  private convertMistralToAnthropic(mistralRes: any): any {
    const choice = mistralRes.choices?.[0];
    if (!choice) throw new Error('No choices in Mistral response');

    const content = choice.message?.content || '';

    return {
      id: mistralRes.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: mistralRes.model,
      content: [{ type: 'text', text: content }],
      stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : 'max_tokens',
      usage: {
        input_tokens: mistralRes.usage?.prompt_tokens || 0,
        output_tokens: mistralRes.usage?.completion_tokens || 0
      }
    };
  }

  public start(port: number, host: string = resolveProxyHost()): void {
    this.app.listen(port, host, () => {
      logger.info('Mistral proxy started', { port, host });
      console.log(`\n✅ Mistral Proxy running at http://${host}:${port}`);
      console.log(`   export ANTHROPIC_API_KEY=${this.authToken}\n`);
    });
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3000');
  const mistralApiKey = process.env.MISTRAL_API_KEY;

  if (!mistralApiKey) {
    console.error('❌ Error: MISTRAL_API_KEY environment variable required');
    process.exit(1);
  }

  const proxy = new AnthropicToMistralProxy({ mistralApiKey });
  proxy.start(port);
}
```

**Step 2: Update TypeScript build**

Add to `config/tsconfig.json` if needed (usually auto-detected).

**Step 3: Test the proxy**

```bash
# Terminal 1: Start proxy
export MISTRAL_API_KEY=your-key-here
npm run build
node dist/proxy/anthropic-to-mistral.js

# Terminal 2: Use with Claude Code
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY='<token printed by the proxy>'
npx agentic-flow --agent coder --task "Write hello world"
```

---

## Adding Local LLM Providers

### Example: Adding Ollama Support

**Step 1: Create proxy file**

`src/proxy/anthropic-to-ollama.ts`:

```typescript
import express, { Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export class AnthropicToOllamaProxy {
  private app: express.Application;
  private ollamaBaseUrl: string;
  private defaultModel: string;

  constructor(config: {
    ollamaBaseUrl?: string;
    defaultModel?: string;
  }) {
    this.app = express();
    this.ollamaBaseUrl = config.ollamaBaseUrl || 'http://localhost:11434';
    this.defaultModel = config.defaultModel || 'llama3.3:70b';

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '50mb' }));
  }

  private setupRoutes(): void {
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'anthropic-to-ollama-proxy' });
    });

    this.app.post('/v1/messages', async (req: Request, res: Response) => {
      try {
        const anthropicReq = req.body;

        // Build prompt from messages
        let prompt = '';
        if (anthropicReq.system) {
          prompt += `System: ${anthropicReq.system}\n\n`;
        }

        for (const msg of anthropicReq.messages) {
          const content = typeof msg.content === 'string'
            ? msg.content
            : msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');

          prompt += `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${content}\n\n`;
        }

        prompt += 'Assistant: ';

        // Call Ollama API
        const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.defaultModel,
            prompt,
            stream: false,
            options: {
              temperature: anthropicReq.temperature || 0.7,
              num_predict: anthropicReq.max_tokens || 4096
            }
          })
        });

        if (!response.ok) {
          const error = await response.text();
          logger.error('Ollama API error', { status: response.status, error });
          return res.status(response.status).json({
            error: { type: 'api_error', message: error }
          });
        }

        const ollamaRes = await response.json();

        // Convert to Anthropic format
        const anthropicRes = {
          id: `msg_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: this.defaultModel,
          content: [{ type: 'text', text: ollamaRes.response }],
          stop_reason: ollamaRes.done ? 'end_turn' : 'max_tokens',
          usage: {
            input_tokens: ollamaRes.prompt_eval_count || 0,
            output_tokens: ollamaRes.eval_count || 0
          }
        };

        res.json(anthropicRes);
      } catch (error: any) {
        logger.error('Ollama proxy error', { error: error.message });
        res.status(500).json({
          error: { type: 'proxy_error', message: error.message }
        });
      }
    });
  }

  public start(port: number): void {
    this.app.listen(port, () => {
      logger.info('Ollama proxy started', { port, ollamaBaseUrl: this.ollamaBaseUrl });
      console.log(`\n✅ Ollama Proxy running at http://localhost:${port}`);
      console.log(`   Ollama Server: ${this.ollamaBaseUrl}`);
      console.log(`   Default Model: ${this.defaultModel}\n`);
    });
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3000');

  const proxy = new AnthropicToOllamaProxy({
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    defaultModel: process.env.OLLAMA_MODEL || 'llama3.3:70b'
  });

  proxy.start(port);
}
```

**Step 2: Start Ollama server**

```bash
# Install Ollama (https://ollama.ai)
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.3:70b

# Server starts automatically on port 11434
```

**Step 3: Use with Agentic Flow**

```bash
# Terminal 1: Start proxy
npm run build
node dist/proxy/anthropic-to-ollama.js

# Terminal 2: Use with agents
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY='<token printed by the proxy>'
npx agentic-flow --agent coder --task "Write hello world"
```

---

## Message Format Conversion

### Anthropic Messages API Format

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "system": "You are a helpful assistant",
  "max_tokens": 1024,
  "temperature": 0.7
}
```

### OpenAI Chat Completions Format

```json
{
  "model": "gpt-4",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant"
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "max_tokens": 1024,
  "temperature": 0.7
}
```

### Gemini generateContent Format

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "System: You are a helpful assistant\n\nHello!"
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 1024
  }
}
```

### Key Differences

| Feature | Anthropic | OpenAI | Gemini |
|---------|-----------|--------|--------|
| **System Prompt** | Separate `system` field | First message with `role: "system"` | Prepended to first user message |
| **Message Content** | String or array of blocks | Always string | Array of `parts` with `text` |
| **Role Names** | `user`, `assistant` | `user`, `assistant`, `system` | `user`, `model` |
| **Max Tokens** | `max_tokens` | `max_tokens` | `generationConfig.maxOutputTokens` |
| **Response Format** | `content` array with typed blocks | `message.content` string | `candidates[0].content.parts[0].text` |

---

## Tool/Function Calling Support

### Anthropic Tool Format

```json
{
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather for a location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        },
        "required": ["location"]
      }
    }
  ]
}
```

### OpenAI Tool Format

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string" }
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

### Conversion Logic

```typescript
// Anthropic → OpenAI
if (anthropicReq.tools && anthropicReq.tools.length > 0) {
  openaiReq.tools = anthropicReq.tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || {
        type: 'object',
        properties: {},
        required: []
      }
    }
  }));
}

// OpenAI → Anthropic (tool_calls in response)
if (message.tool_calls && message.tool_calls.length > 0) {
  for (const toolCall of message.tool_calls) {
    contentBlocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: JSON.parse(toolCall.function.arguments)
    });
  }
}
```

---

## Testing Your Proxy

### Unit Tests

Create `tests/proxy-mistral.test.ts`:

```typescript
import { AnthropicToMistralProxy } from '../src/proxy/anthropic-to-mistral.js';
import fetch from 'node-fetch';

describe('Mistral Proxy', () => {
  let proxy: AnthropicToMistralProxy;
  const port = 3001;

  beforeAll(() => {
    proxy = new AnthropicToMistralProxy({
      mistralApiKey: process.env.MISTRAL_API_KEY || 'test-key'
    });
    proxy.start(port);
  });

  it('should convert Anthropic request to Mistral format', async () => {
    const response = await fetch(`http://localhost:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': proxy.getAuthToken() },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello!' }],
        max_tokens: 100
      })
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('content');
    expect(data.role).toBe('assistant');
  });
});
```

### Manual Testing

```bash
# Test health check
curl http://localhost:3000/health

# Test message endpoint
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

---

## Examples

### Complete Example: Adding Cohere

See full implementation: [examples/proxy-cohere.ts](../examples/proxy-cohere.ts)

### Integration with Agentic Flow

```typescript
// src/cli-proxy.ts - Add new provider option
if (options.provider === 'mistral' || process.env.USE_MISTRAL) {
  // Start Mistral proxy
  const proxy = new AnthropicToMistralProxy({
    mistralApiKey: process.env.MISTRAL_API_KEY!
  });
  proxy.start(3000);

  // Set environment for SDK; the proxy rejects requests without its token
  process.env.ANTHROPIC_BASE_URL = 'http://localhost:3000';
  process.env.ANTHROPIC_API_KEY = proxy.getAuthToken();
}
```

---

## Best Practices

1. **Error Handling**: Always catch and log errors with context
2. **Streaming**: Support both streaming and non-streaming modes
3. **Tool Calling**: Handle MCP tools via native function calling when possible
4. **Logging**: Use verbose logging during development, info in production
5. **API Keys**: Never hardcode keys, use environment variables
6. **Health Checks**: Always provide a `/health` endpoint
7. **Rate Limiting**: Respect provider rate limits
8. **Timeouts**: Set appropriate timeouts for API calls

---

## Resources

- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat)
- [Google Gemini API](https://ai.google.dev/gemini-api/docs)
- [OpenRouter API](https://openrouter.ai/docs)
- [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md)

---

## Support

Need help adding a provider? Open an issue: [GitHub Issues](https://github.com/ruvnet/agentic-flow/issues)
