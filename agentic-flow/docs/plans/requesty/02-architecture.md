# Requesty.ai Integration Architecture

## Architecture Overview

### High-Level Design

The Requesty integration will follow the **exact same proxy pattern** as OpenRouter, with minimal modifications:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agentic Flow CLI                            │
│                  (cli-proxy.ts entry point)                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─ Parse CLI flags (--provider requesty)
                         ├─ Detect REQUESTY_API_KEY
                         └─ Route to appropriate handler
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌────────────────┐              ┌────────────────┐
│   Direct API   │              │  Proxy Mode    │
│   (Anthropic)  │              │  (Requesty)    │
└────────────────┘              └────────┬───────┘
                                         │
                                         ▼
                        ┌────────────────────────────────┐
                        │ AnthropicToRequestyProxy       │
                        │ (Port 3000 local server)       │
                        ├────────────────────────────────┤
                        │ 1. Accept Anthropic format     │
                        │    (/v1/messages endpoint)     │
                        │ 2. Convert to OpenAI format    │
                        │ 3. Forward to Requesty router  │
                        │ 4. Convert response back       │
                        │ 5. Handle streaming/tools      │
                        └────────────┬───────────────────┘
                                     │
                                     │ HTTP POST
                                     ▼
                        ┌────────────────────────────────┐
                        │  Requesty Router               │
                        │  router.requesty.ai/v1         │
                        ├────────────────────────────────┤
                        │ • Auto-routing                 │
                        │ • Caching                      │
                        │ • Load balancing               │
                        │ • Cost optimization            │
                        └────────────┬───────────────────┘
                                     │
                                     ├─ Model Execution
                                     │
                        ┌────────────┴───────────────────┐
                        │                                │
                ┌───────▼──────┐              ┌─────────▼────────┐
                │  OpenAI      │              │  Anthropic       │
                │  (GPT-4o)    │              │  (Claude 3.5)    │
                └──────────────┘              └──────────────────┘
                        │                                │
                ┌───────▼──────┐              ┌─────────▼────────┐
                │  Google      │              │  DeepSeek        │
                │  (Gemini)    │              │  (Chat V3)       │
                └──────────────┘              └──────────────────┘
```

### Component Breakdown

#### 1. CLI Integration (`src/cli-proxy.ts`)

**Responsibilities:**
- Detect `--provider requesty` flag
- Check for `REQUESTY_API_KEY` environment variable
- Initialize Requesty proxy server
- Configure environment for Claude Agent SDK

**Code Changes Required:**

```typescript
// Add to shouldUseRequesty() method
private shouldUseRequesty(options: any): boolean {
  if (options.provider === 'requesty' || process.env.PROVIDER === 'requesty') {
    return true;
  }

  if (process.env.USE_REQUESTY === 'true') {
    return true;
  }

  if (process.env.REQUESTY_API_KEY &&
      !process.env.ANTHROPIC_API_KEY &&
      !process.env.OPENROUTER_API_KEY &&
      !process.env.GOOGLE_GEMINI_API_KEY) {
    return true;
  }

  return false;
}

// Add to start() method
if (useRequesty) {
  console.log('🚀 Initializing Requesty proxy...');
  await this.startRequestyProxy(options.model);
}

// Add startRequestyProxy() method (clone from startOpenRouterProxy)
private async startRequestyProxy(modelOverride?: string): Promise<void> {
  const requestyKey = process.env.REQUESTY_API_KEY;

  if (!requestyKey) {
    console.error('❌ Error: REQUESTY_API_KEY required for Requesty models');
    console.error('Set it in .env or export REQUESTY_API_KEY=requesty-xxxxx');
    process.exit(1);
  }

  logger.info('Starting integrated Requesty proxy');

  const defaultModel = modelOverride ||
                      process.env.COMPLETION_MODEL ||
                      'openai/gpt-4o-mini';

  const capabilities = detectModelCapabilities(defaultModel);

  const proxy = new AnthropicToRequestyProxy({
    requestyApiKey: requestyKey,
    requestyBaseUrl: process.env.REQUESTY_BASE_URL,
    defaultModel,
    capabilities: capabilities
  });

  proxy.start(this.proxyPort);
  this.proxyServer = proxy;

  process.env.ANTHROPIC_BASE_URL = `http://localhost:${this.proxyPort}`;

  // The proxy rejects requests without its per-run token (3.0.0+)
  process.env.ANTHROPIC_API_KEY = proxy.getAuthToken();

  console.log(`🔗 Proxy Mode: Requesty`);
  console.log(`🔧 Proxy URL: http://localhost:${this.proxyPort}`);
  console.log(`🤖 Default Model: ${defaultModel}`);

  if (capabilities.requiresEmulation) {
    console.log(`\n⚙️  Detected: Model lacks native tool support`);
    console.log(`🔧 Using ${capabilities.emulationStrategy.toUpperCase()} emulation pattern`);
  }
  console.log('');

  await new Promise(resolve => setTimeout(resolve, 1500));
}
```

#### 2. Proxy Server (`src/proxy/anthropic-to-requesty.ts`)

**Based on:** `src/proxy/anthropic-to-openrouter.ts` (95% identical)

**Class Structure:**

```typescript
export class AnthropicToRequestyProxy {
  private app: express.Application;
  private requestyApiKey: string;
  private requestyBaseUrl: string;
  private defaultModel: string;
  private capabilities?: ModelCapabilities;

  constructor(config: {
    requestyApiKey: string;
    requestyBaseUrl?: string;
    defaultModel?: string;
    capabilities?: ModelCapabilities;
  }) {
    this.app = express();
    this.requestyApiKey = config.requestyApiKey;
    this.requestyBaseUrl = config.requestyBaseUrl ||
                           'https://router.requesty.ai/v1';
    this.defaultModel = config.defaultModel || 'openai/gpt-4o-mini';
    this.capabilities = config.capabilities;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'anthropic-to-requesty-proxy' });
    });

    // Anthropic Messages API → Requesty Chat Completions
    this.app.post('/v1/messages', async (req, res) => {
      // Convert and forward request
      const result = await this.handleRequest(req.body, res);
      if (result) res.json(result);
    });
  }

  private async handleRequest(
    anthropicReq: AnthropicRequest,
    res: Response
  ): Promise<any> {
    const capabilities = this.capabilities ||
                        detectModelCapabilities(anthropicReq.model || this.defaultModel);

    if (capabilities.requiresEmulation && anthropicReq.tools?.length > 0) {
      return this.handleEmulatedRequest(anthropicReq, capabilities);
    }

    return this.handleNativeRequest(anthropicReq, res);
  }

  private async handleNativeRequest(
    anthropicReq: AnthropicRequest,
    res: Response
  ): Promise<any> {
    // Convert Anthropic → OpenAI format
    const openaiReq = this.convertAnthropicToOpenAI(anthropicReq);

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
        error: { type: 'api_error', message: error }
      });
      return null;
    }

    // Handle streaming vs non-streaming
    if (anthropicReq.stream) {
      // Stream response
      res.setHeader('Content-Type', 'text/event-stream');
      const reader = response.body?.getReader();
      // ... streaming logic
    } else {
      // Non-streaming
      const openaiRes = await response.json();
      return this.convertOpenAIToAnthropic(openaiRes);
    }
  }

  private convertAnthropicToOpenAI(req: AnthropicRequest): OpenAIRequest {
    // IDENTICAL to OpenRouter conversion
    // See anthropic-to-openrouter.ts lines 376-532
  }

  private convertOpenAIToAnthropic(res: any): any {
    // IDENTICAL to OpenRouter conversion
    // See anthropic-to-openrouter.ts lines 588-685
  }

  public start(port: number): void {
    this.app.listen(port, () => {
      logger.info('Anthropic to Requesty proxy started', {
        port,
        requestyBaseUrl: this.requestyBaseUrl,
        defaultModel: this.defaultModel
      });
      console.log(`\n✅ Anthropic Proxy running at http://localhost:${port}`);
      console.log(`   Requesty Base URL: ${this.requestyBaseUrl}`);
      console.log(`   Default Model: ${this.defaultModel}\n`);
    });
  }
}
```

**Key Differences from OpenRouter Proxy:**

| Component | OpenRouter | Requesty | Change Required |
|-----------|-----------|----------|-----------------|
| Class name | `AnthropicToOpenRouterProxy` | `AnthropicToRequestyProxy` | Rename |
| Base URL | `https://openrouter.ai/api/v1` | `https://router.requesty.ai/v1` | Update constant |
| API key variable | `openrouterApiKey` | `requestyApiKey` | Rename |
| Auth header | `Bearer sk-or-...` | `Bearer requesty-...` | No code change |
| Endpoint | `/chat/completions` | `/chat/completions` | Identical |
| Request format | OpenAI | OpenAI | Identical |
| Response format | OpenAI | OpenAI | Identical |
| Tool format | OpenAI functions | OpenAI functions | Identical |

**Lines of Code to Copy:** ~750 lines (95% reusable)

#### 3. Agent Integration (`src/agents/claudeAgent.ts`)

**Changes Required:**

```typescript
function getCurrentProvider(): string {
  // Add Requesty detection
  if (process.env.PROVIDER === 'requesty' || process.env.USE_REQUESTY === 'true') {
    return 'requesty';
  }
  // ... existing providers
}

function getModelForProvider(provider: string): {
  model: string;
  apiKey: string;
  baseURL?: string;
} {
  switch (provider) {
    case 'requesty':
      return {
        model: process.env.COMPLETION_MODEL || 'openai/gpt-4o-mini',
        apiKey: process.env.REQUESTY_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        baseURL: process.env.PROXY_URL || undefined
      };
    // ... existing cases
  }
}

// In claudeAgent() function, add Requesty handling
if (provider === 'requesty' && process.env.REQUESTY_API_KEY) {
  envOverrides.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'proxy-key';
  envOverrides.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ||
                                   process.env.REQUESTY_PROXY_URL ||
                                   'http://localhost:3000';

  logger.info('Using Requesty proxy', {
    proxyUrl: envOverrides.ANTHROPIC_BASE_URL,
    model: finalModel
  });
}
```

#### 4. Model Capabilities (`src/utils/modelCapabilities.ts`)

**Add Requesty Model Definitions:**

```typescript
const MODEL_CAPABILITIES: Record<string, Partial<ModelCapabilities>> = {
  // Existing models...

  // Requesty - OpenAI models
  'openai/gpt-4o': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.50,
    provider: 'requesty'
  },
  'openai/gpt-4o-mini': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.03,
    provider: 'requesty'
  },

  // Requesty - Anthropic models
  'anthropic/claude-3.5-sonnet': {
    supportsNativeTools: true,
    contextWindow: 200000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.60,
    provider: 'requesty'
  },

  // Requesty - Google models
  'google/gemini-2.5-flash': {
    supportsNativeTools: true,
    contextWindow: 1000000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.0, // FREE
    provider: 'requesty'
  },

  // Requesty - DeepSeek models
  'deepseek/deepseek-chat-v3': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.03,
    provider: 'requesty'
  },

  // ... add more Requesty models
};
```

#### 5. Model Optimizer (`src/utils/modelOptimizer.ts`)

**Add Requesty Models to Optimizer Database:**

```typescript
// In MODEL_DATABASE constant, add Requesty models
const MODEL_DATABASE: ModelInfo[] = [
  // Existing models...

  // Requesty models
  {
    provider: 'requesty',
    modelId: 'openai/gpt-4o',
    name: 'GPT-4o (Requesty)',
    contextWindow: 128000,
    maxOutput: 4096,
    qualityScore: 95,
    speedScore: 85,
    costPer1MTokens: { input: 0.50, output: 1.50 },
    capabilities: {
      toolCalling: true,
      streaming: true,
      vision: true,
      jsonMode: true
    },
    useCase: ['reasoning', 'coding', 'analysis'],
    requiresKey: 'REQUESTY_API_KEY'
  },
  {
    provider: 'requesty',
    modelId: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini (Requesty)',
    contextWindow: 128000,
    maxOutput: 4096,
    qualityScore: 80,
    speedScore: 95,
    costPer1MTokens: { input: 0.03, output: 0.06 },
    capabilities: {
      toolCalling: true,
      streaming: true,
      vision: false,
      jsonMode: true
    },
    useCase: ['coding', 'analysis', 'chat'],
    requiresKey: 'REQUESTY_API_KEY'
  },
  {
    provider: 'requesty',
    modelId: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Requesty)',
    contextWindow: 1000000,
    maxOutput: 8192,
    qualityScore: 85,
    speedScore: 98,
    costPer1MTokens: { input: 0.0, output: 0.0 }, // FREE
    capabilities: {
      toolCalling: true,
      streaming: true,
      vision: true,
      jsonMode: true
    },
    useCase: ['coding', 'analysis', 'chat'],
    requiresKey: 'REQUESTY_API_KEY'
  },
  // ... add more Requesty models
];
```

## Data Flow Diagrams

### Request Flow - Chat Completion

```
User CLI Command
    │
    └─> npx agentic-flow --agent coder --task "Create API" --provider requesty
         │
         ├─> CLI Parser (cli-proxy.ts)
         │    ├─ Detect --provider requesty
         │    ├─ Load REQUESTY_API_KEY from env
         │    └─ Start AnthropicToRequestyProxy on port 3000
         │
         ├─> Set Environment Variables
         │    ├─ ANTHROPIC_BASE_URL = http://localhost:3000
         │    └─ ANTHROPIC_API_KEY = <proxy's per-run token>
         │
         └─> Execute Agent (claudeAgent.ts)
              │
              └─> Claude Agent SDK query()
                   │
                   ├─> Reads ANTHROPIC_BASE_URL (proxy)
                   │
                   └─> POST http://localhost:3000/v1/messages
                        │
                        └─> AnthropicToRequestyProxy
                             │
                             ├─> Receive Anthropic format request
                             │    {
                             │      model: "openai/gpt-4o-mini",
                             │      messages: [...],
                             │      tools: [...]
                             │    }
                             │
                             ├─> Convert to OpenAI format
                             │    {
                             │      model: "openai/gpt-4o-mini",
                             │      messages: [...],
                             │      tools: [...]
                             │    }
                             │
                             ├─> POST https://router.requesty.ai/v1/chat/completions
                             │    Headers:
                             │      Authorization: Bearer requesty-xxxxx
                             │      Content-Type: application/json
                             │
                             └─> Requesty Router
                                  │
                                  ├─> Auto-route to optimal model
                                  ├─> Check cache
                                  ├─> Execute model
                                  │
                                  └─> Return OpenAI format response
                                       │
                                       └─> AnthropicToRequestyProxy
                                            │
                                            ├─> Convert to Anthropic format
                                            │    {
                                            │      id: "msg_xxx",
                                            │      role: "assistant",
                                            │      content: [...]
                                            │    }
                                            │
                                            └─> Return to Claude Agent SDK
                                                 │
                                                 └─> Display to user
```

### Tool Calling Flow

```
User asks agent to read a file
    │
    └─> Agent determines tool call needed
         │
         └─> POST /v1/messages with tools array
              {
                "tools": [{
                  "type": "function",
                  "function": {
                    "name": "Read",
                    "parameters": {...}
                  }
                }]
              }
              │
              └─> Proxy converts to OpenAI format (no change needed)
                   │
                   └─> Requesty executes model
                        │
                        └─> Model returns tool_calls
                             {
                               "choices": [{
                                 "message": {
                                   "tool_calls": [{
                                     "id": "call_abc",
                                     "function": {
                                       "name": "Read",
                                       "arguments": "{...}"
                                     }
                                   }]
                                 }
                               }]
                             }
                             │
                             └─> Proxy converts to Anthropic format
                                  {
                                    "content": [{
                                      "type": "tool_use",
                                      "id": "call_abc",
                                      "name": "Read",
                                      "input": {...}
                                    }]
                                  }
                                  │
                                  └─> Claude Agent SDK executes tool
                                       │
                                       └─> Returns result to model
```

## File Organization

### New Files

```
src/
└── proxy/
    └── anthropic-to-requesty.ts        (~750 lines, cloned from OpenRouter)

docs/
└── plans/
    └── requesty/
        ├── 00-overview.md
        ├── 01-api-research.md
        ├── 02-architecture.md          (this file)
        ├── 03-implementation-phases.md
        ├── 04-testing-strategy.md
        └── 05-migration-guide.md
```

### Modified Files

```
src/
├── cli-proxy.ts                        (+ ~80 lines)
│   ├── shouldUseRequesty()
│   ├── startRequestyProxy()
│   └── Updated help text
│
├── agents/
│   └── claudeAgent.ts                  (+ ~15 lines)
│       ├── getCurrentProvider()
│       └── getModelForProvider()
│
└── utils/
    ├── modelCapabilities.ts            (+ ~50 lines)
    │   └── Add Requesty model definitions
    │
    └── modelOptimizer.ts               (+ ~100 lines)
        └── Add Requesty models to database
```

### Total Code Impact

| Metric | Count |
|--------|-------|
| New files | 1 |
| Modified files | 4 |
| New lines of code | ~1,000 |
| Reused lines of code | ~750 (95% from OpenRouter) |
| Original code needed | ~250 |

## Configuration Management

### Environment Variables

```bash
# Required for Requesty
REQUESTY_API_KEY=requesty-xxxxxxxxxxxxx

# Optional overrides
REQUESTY_BASE_URL=https://router.requesty.ai/v1  # Custom base URL
REQUESTY_PROXY_URL=http://localhost:3000         # Proxy override
PROVIDER=requesty                                # Force Requesty
USE_REQUESTY=true                                # Alternative flag
COMPLETION_MODEL=openai/gpt-4o-mini              # Default model

# Proxy configuration
PROXY_PORT=3000                                  # Proxy server port
```

### .env.example Update

```bash
# Add to .env.example
# ============================================
# Requesty Configuration
# ============================================
REQUESTY_API_KEY=                               # Get from https://app.requesty.ai
REQUESTY_BASE_URL=https://router.requesty.ai/v1 # Optional: Custom base URL
USE_REQUESTY=false                              # Set to 'true' to force Requesty
```

### Config File Support

Consider adding `~/.agentic-flow/requesty.json`:

```json
{
  "apiKey": "requesty-xxxxx",
  "baseUrl": "https://router.requesty.ai/v1",
  "defaultModel": "openai/gpt-4o-mini",
  "autoRouting": true,
  "caching": {
    "enabled": true,
    "ttl": 3600
  },
  "fallback": {
    "enabled": true,
    "providers": ["openrouter", "anthropic"]
  }
}
```

## Error Handling Strategy

### Error Mapping

```typescript
// Map Requesty errors to user-friendly messages
private mapRequestyError(error: any): string {
  const errorMappings = {
    'invalid_api_key': 'Invalid REQUESTY_API_KEY. Check your API key.',
    'rate_limit_exceeded': 'Rate limit exceeded. Please wait and retry.',
    'model_not_found': 'Model not available. Check model ID.',
    'insufficient_quota': 'Insufficient Requesty credits.',
    'model_overloaded': 'Model temporarily overloaded. Retrying...',
    'timeout': 'Request timeout. Model took too long to respond.'
  };

  return errorMappings[error.code] || error.message;
}
```

### Retry Logic

```typescript
private async callRequestyWithRetry(
  request: any,
  maxRetries: number = 3
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(/* ... */);
      if (response.ok) return await response.json();

      // Check if error is retryable
      if ([429, 503, 504].includes(response.status)) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.warn(`Retrying after ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Non-retryable error
      throw new Error(`Requesty API error: ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries) throw error;
    }
  }
}
```

## Performance Considerations

### Latency Optimization

1. **Keep-Alive Connections**
   ```typescript
   import https from 'https';

   const agent = new https.Agent({
     keepAlive: true,
     maxSockets: 10
   });

   fetch(url, { agent });
   ```

2. **Request Pooling**
   - Reuse HTTP connections
   - Connection pooling for concurrent requests

3. **Streaming**
   - Enable streaming by default for large responses
   - Reduce time-to-first-token

### Caching Strategy

Requesty has built-in caching, but we can add client-side caching too:

```typescript
interface CacheEntry {
  key: string;
  value: any;
  timestamp: number;
  ttl: number;
}

class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();

  set(key: string, value: any, ttl: number = 3600): void {
    this.cache.set(key, {
      key,
      value,
      timestamp: Date.now(),
      ttl: ttl * 1000
    });
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  generateKey(request: any): string {
    return crypto.createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');
  }
}
```

## Security Architecture

### API Key Security

1. **Never log API keys**
   ```typescript
   logger.info('Request to Requesty', {
     apiKeyPresent: !!this.requestyApiKey,
     apiKeyPrefix: this.requestyApiKey?.substring(0, 10) // Only log prefix
   });
   ```

2. **Environment variable validation**
   ```typescript
   if (!requestyKey || !requestyKey.startsWith('requesty-')) {
     throw new Error('Invalid REQUESTY_API_KEY format');
   }
   ```

3. **Rate limit API key exposure**
   - Don't include API key in error messages
   - Don't send API key to client in proxy responses

### Request Validation

```typescript
private validateRequest(req: AnthropicRequest): void {
  if (!req.messages || req.messages.length === 0) {
    throw new Error('Messages array cannot be empty');
  }

  if (req.max_tokens && req.max_tokens > 100000) {
    logger.warn('Unusually high max_tokens requested', {
      requested: req.max_tokens
    });
  }

  // Prevent injection attacks in system prompts
  if (req.system && typeof req.system === 'string') {
    this.sanitizeSystemPrompt(req.system);
  }
}
```

## Monitoring and Observability

### Logging Strategy

```typescript
// Request logging
logger.info('Requesty request', {
  model: request.model,
  messageCount: request.messages.length,
  toolCount: request.tools?.length || 0,
  streaming: request.stream,
  maxTokens: request.max_tokens
});

// Response logging
logger.info('Requesty response', {
  id: response.id,
  model: response.model,
  finishReason: response.choices[0].finish_reason,
  tokensUsed: response.usage.total_tokens,
  latencyMs: Date.now() - startTime
});

// Error logging
logger.error('Requesty error', {
  errorType: error.type,
  errorCode: error.code,
  message: error.message,
  model: request.model,
  retryAttempt: attempt
});
```

### Metrics Collection

```typescript
interface RequestMetrics {
  requestId: string;
  model: string;
  startTime: number;
  endTime: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  cost: number;
  success: boolean;
  errorType?: string;
}

class MetricsCollector {
  private metrics: RequestMetrics[] = [];

  recordRequest(metrics: RequestMetrics): void {
    this.metrics.push(metrics);

    // Optional: Send to analytics service
    if (process.env.ANALYTICS_ENABLED === 'true') {
      this.sendToAnalytics(metrics);
    }
  }

  getStats(period: '1h' | '24h' | '7d'): any {
    // Calculate aggregate stats
    const relevantMetrics = this.filterByPeriod(period);
    return {
      totalRequests: relevantMetrics.length,
      avgLatency: this.average(relevantMetrics.map(m => m.latencyMs)),
      totalTokens: this.sum(relevantMetrics.map(m => m.tokensTotal)),
      totalCost: this.sum(relevantMetrics.map(m => m.cost)),
      successRate: this.successRate(relevantMetrics)
    };
  }
}
```

## Deployment Considerations

### Standalone Proxy Mode

Support running Requesty proxy as standalone server:

```bash
# Terminal 1 - Run proxy
export REQUESTY_API_KEY=requesty-xxxxx
npx agentic-flow proxy --provider requesty --port 3000 --model "openai/gpt-4o-mini"

# Terminal 2 - Use with Claude Code
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY='<token printed by the proxy>'
claude
```

### Docker Support

```dockerfile
# Add to existing Dockerfile
ENV REQUESTY_API_KEY=""
ENV REQUESTY_BASE_URL="https://router.requesty.ai/v1"
ENV USE_REQUESTY="false"
```

### Health Checks

```typescript
// Enhanced health check endpoint
this.app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    service: 'anthropic-to-requesty-proxy',
    version: packageJson.version,
    uptime: process.uptime(),
    requesty: {
      baseUrl: this.requestyBaseUrl,
      apiKeyConfigured: !!this.requestyApiKey,
      defaultModel: this.defaultModel
    }
  };

  // Optional: Ping Requesty API
  try {
    const response = await fetch(`${this.requestyBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.requestyApiKey}` }
    });
    health.requesty.apiReachable = response.ok;
  } catch (error) {
    health.requesty.apiReachable = false;
  }

  res.json(health);
});
```

## Future Enhancements

### Phase 2 Features

1. **Auto-Routing Integration**
   - Support Requesty's auto-routing feature
   - Let Requesty choose optimal model based on request

2. **Caching Control**
   - Expose cache control headers
   - Per-request cache configuration

3. **Analytics Dashboard**
   - Local web UI showing Requesty usage stats
   - Cost tracking and optimization recommendations

4. **Fallback Chain**
   - Automatic fallback to OpenRouter if Requesty fails
   - Configurable provider priority

### Phase 3 Features

1. **Model Benchmarking**
   - Compare same task across Requesty vs OpenRouter vs Anthropic
   - Quality/cost/speed metrics

2. **Smart Provider Selection**
   - Automatically choose Requesty vs OpenRouter based on:
     - Current rate limits
     - Model availability
     - Cost optimization
     - Latency requirements

3. **Webhook Support**
   - Async request processing
   - Long-running task support

## Architecture Decision Records

### ADR-001: Copy OpenRouter Proxy Pattern

**Decision:** Clone OpenRouter proxy implementation for Requesty

**Rationale:**
- 95% code reuse
- Proven pattern already tested
- Minimal development time
- Consistent user experience

**Alternatives Considered:**
- Generic proxy factory (over-engineered for 2 providers)
- Shared base class (adds complexity)

### ADR-002: Same Port for All Proxies

**Decision:** Use port 3000 for all proxies (only one active at a time)

**Rationale:**
- Simplifies configuration
- Prevents port conflicts
- Clear user experience

**Alternatives Considered:**
- Different ports per provider (confusing)
- Dynamic port allocation (complex)

### ADR-003: OpenAI Format as Intermediate

**Decision:** Use OpenAI format for all proxy conversions

**Rationale:**
- Industry standard
- Most providers support it
- Rich tool calling support

**Alternatives Considered:**
- Direct Anthropic-to-Requesty (loses generalization)
- Custom intermediate format (reinventing wheel)

## Summary

The Requesty integration follows a **proven, low-risk architecture**:

1. **Clone OpenRouter proxy** (~750 lines, 95% reusable)
2. **Update 4 existing files** (~250 new lines total)
3. **Add model definitions** (~100 lines for optimizer)
4. **Minimal testing overhead** (reuse OpenRouter test suite)

**Total Implementation Time:** ~4 hours for core functionality

**Risk Level:** LOW (following established pattern)

**Maintenance Burden:** MINIMAL (almost identical to OpenRouter)
