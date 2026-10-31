# Requesty.ai Integration - Implementation Phases

## Overview

This document provides a step-by-step implementation plan for adding Requesty.ai support to agentic-flow. The implementation is divided into 5 phases, each with clear deliverables and acceptance criteria.

## Phase Summary

| Phase | Focus | Duration | Effort | Risk |
|-------|-------|----------|--------|------|
| Phase 1 | Core Proxy | 4 hours | Medium | Low |
| Phase 2 | CLI Integration | 2 hours | Low | Low |
| Phase 3 | Model Support | 2 hours | Medium | Low |
| Phase 4 | Testing & Validation | 3 hours | High | Medium |
| Phase 5 | Documentation & Polish | 2 hours | Low | Low |
| **Total** | | **13 hours** | | |

---

## Phase 1: Core Proxy Implementation

### Duration: 4 hours

### Objective
Create the `AnthropicToRequestyProxy` class by cloning and adapting the existing OpenRouter proxy.

### Tasks

#### 1.1 Create Proxy File (30 min)

```bash
# Create new proxy file
cp src/proxy/anthropic-to-openrouter.ts src/proxy/anthropic-to-requesty.ts
```

**Steps:**
1. Copy `anthropic-to-openrouter.ts` to `anthropic-to-requesty.ts`
2. Global find/replace:
   - `OpenRouter` → `Requesty`
   - `openrouter` → `requesty`
   - `OPENROUTER` → `REQUESTY`
   - `https://openrouter.ai/api/v1` → `https://router.requesty.ai/v1`

**Files to modify:**
- Create: `/workspaces/agentic-flow/agentic-flow/src/proxy/anthropic-to-requesty.ts`

**Acceptance Criteria:**
- [ ] File created successfully
- [ ] All class/variable names updated
- [ ] Base URL updated to Requesty endpoint
- [ ] Code compiles without errors

#### 1.2 Update Constructor & Configuration (30 min)

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
    this.requestyBaseUrl = config.requestyBaseUrl || 'https://router.requesty.ai/v1';
    this.defaultModel = config.defaultModel || 'openai/gpt-4o-mini';
    this.capabilities = config.capabilities;

    this.setupMiddleware();
    this.setupRoutes();
  }
}
```

**Acceptance Criteria:**
- [ ] Constructor accepts `requestyApiKey`
- [ ] Default base URL points to Requesty
- [ ] Default model is `openai/gpt-4o-mini`
- [ ] Capabilities parameter supported

#### 1.3 Update API Call Headers (30 min)

```typescript
private async handleNativeRequest(anthropicReq: AnthropicRequest, res: Response): Promise<any> {
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

  // ... rest of method
}
```

**Acceptance Criteria:**
- [ ] Authorization header uses Requesty API key
- [ ] Referer and Title headers included
- [ ] Request body is JSON stringified

#### 1.4 Update Logging Messages (30 min)

Update all logger calls to reference Requesty:

```typescript
logger.info('Anthropic to Requesty proxy started', {
  port,
  requestyBaseUrl: this.requestyBaseUrl,
  defaultModel: this.defaultModel
});

logger.error('Requesty API error', {
  status: response.status,
  error
});
```

**Acceptance Criteria:**
- [ ] All log messages reference "Requesty" instead of "OpenRouter"
- [ ] Console output says "Requesty" in user-facing messages
- [ ] Error messages are Requesty-specific

#### 1.5 Update Start Method (30 min)

```typescript
public start(port: number): void {
  this.app.listen(port, () => {
    logger.info('Anthropic to Requesty proxy started', {
      port,
      requestyBaseUrl: this.requestyBaseUrl,
      defaultModel: this.defaultModel
    });
    console.log(`\n✅ Anthropic Proxy running at http://localhost:${port}`);
    console.log(`   Requesty Base URL: ${this.requestyBaseUrl}`);
    console.log(`   Default Model: ${this.defaultModel}`);

    if (this.capabilities?.requiresEmulation) {
      console.log(`\n   ⚙️  Tool Emulation: ${this.capabilities.emulationStrategy.toUpperCase()} pattern`);
      console.log(`   📊 Expected reliability: ${this.capabilities.emulationStrategy === 'react' ? '70-85%' : '50-70%'}`);
    }
    console.log('');
  });
}
```

**Acceptance Criteria:**
- [ ] Startup message shows "Requesty" branding
- [ ] Base URL displayed correctly
- [ ] Tool emulation status shown if applicable

#### 1.6 Test Proxy Compilation (30 min)

```bash
cd agentic-flow
npm run build
```

**Acceptance Criteria:**
- [ ] TypeScript compiles without errors
- [ ] No linting errors
- [ ] Proxy file included in build output

### Phase 1 Deliverables

- [x] `src/proxy/anthropic-to-requesty.ts` created
- [x] All references updated to Requesty
- [x] Code compiles successfully
- [x] Logging updated

### Phase 1 Acceptance Criteria

- [ ] Proxy server can be instantiated
- [ ] Health check endpoint works
- [ ] No compilation errors
- [ ] All references to OpenRouter removed

---

## Phase 2: CLI Integration

### Duration: 2 hours

### Objective
Integrate Requesty provider detection and proxy startup in CLI.

### Tasks

#### 2.1 Add Provider Detection (45 min)

**File:** `src/cli-proxy.ts`

```typescript
private shouldUseRequesty(options: any): boolean {
  // Don't use Requesty if ONNX or Gemini is explicitly requested
  if (options.provider === 'onnx' || process.env.USE_ONNX === 'true' ||
      process.env.PROVIDER === 'onnx') {
    return false;
  }

  if (options.provider === 'gemini' || process.env.PROVIDER === 'gemini') {
    return false;
  }

  if (options.provider === 'openrouter' || process.env.PROVIDER === 'openrouter') {
    return false;
  }

  // Use Requesty if:
  // 1. Provider is explicitly set to requesty
  // 2. USE_REQUESTY env var is set
  // 3. REQUESTY_API_KEY is set and ANTHROPIC_API_KEY is not
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
```

**Acceptance Criteria:**
- [ ] `shouldUseRequesty()` method added
- [ ] Respects `--provider requesty` flag
- [ ] Checks `USE_REQUESTY` environment variable
- [ ] Falls back to Requesty if only `REQUESTY_API_KEY` is set

#### 2.2 Add Proxy Startup Method (45 min)

**File:** `src/cli-proxy.ts`

```typescript
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
                      process.env.REASONING_MODEL ||
                      'openai/gpt-4o-mini';

  const capabilities = detectModelCapabilities(defaultModel);

  const { AnthropicToRequestyProxy } = await import('./proxy/anthropic-to-requesty.js');

  const proxy = new AnthropicToRequestyProxy({
    requestyApiKey: requestyKey,
    requestyBaseUrl: process.env.REQUESTY_BASE_URL,
    defaultModel,
    capabilities: capabilities
  });

  // Start proxy in background
  proxy.start(this.proxyPort);
  this.proxyServer = proxy;

  // Set ANTHROPIC_BASE_URL to proxy
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${this.proxyPort}`;

  // The proxy rejects requests without its per-run token (3.0.0+);
  // the upstream call still uses REQUESTY_API_KEY
  process.env.ANTHROPIC_API_KEY = proxy.getAuthToken();

  console.log(`🔗 Proxy Mode: Requesty`);
  console.log(`🔧 Proxy URL: http://localhost:${this.proxyPort}`);
  console.log(`🤖 Default Model: ${defaultModel}`);

  if (capabilities.requiresEmulation) {
    console.log(`\n⚙️  Detected: Model lacks native tool support`);
    console.log(`🔧 Using ${capabilities.emulationStrategy.toUpperCase()} emulation pattern`);
    console.log(`📊 Expected reliability: ${capabilities.emulationStrategy === 'react' ? '70-85%' : '50-70%'}`);
  }
  console.log('');

  // Wait for proxy to be ready
  await new Promise(resolve => setTimeout(resolve, 1500));
}
```

**Acceptance Criteria:**
- [ ] `startRequestyProxy()` method added
- [ ] Validates `REQUESTY_API_KEY` presence
- [ ] Imports and instantiates proxy dynamically
- [ ] Sets environment variables for SDK
- [ ] Shows user-friendly startup messages

#### 2.3 Integrate into Start Flow (30 min)

**File:** `src/cli-proxy.ts`

```typescript
async start() {
  const options = parseArgs();

  // ... existing code ...

  // Determine which provider to use
  const useONNX = this.shouldUseONNX(options);
  const useOpenRouter = this.shouldUseOpenRouter(options);
  const useGemini = this.shouldUseGemini(options);
  const useRequesty = this.shouldUseRequesty(options); // ADD THIS

  try {
    // Start proxy if needed
    if (useONNX) {
      console.log('🚀 Initializing ONNX local inference proxy...');
      await this.startONNXProxy(options.model);
    } else if (useOpenRouter) {
      console.log('🚀 Initializing OpenRouter proxy...');
      await this.startOpenRouterProxy(options.model);
    } else if (useGemini) {
      console.log('🚀 Initializing Gemini proxy...');
      await this.startGeminiProxy(options.model);
    } else if (useRequesty) { // ADD THIS BLOCK
      console.log('🚀 Initializing Requesty proxy...');
      await this.startRequestyProxy(options.model);
    } else {
      console.log('🚀 Using direct Anthropic API...\n');
    }

    // Run agent
    await this.runAgent(options, useOpenRouter, useGemini, useONNX, useRequesty); // ADD PARAM

    logger.info('Execution completed successfully');
    process.exit(0);
  } catch (err: unknown) {
    logger.error('Execution failed', { error: err });
    console.error(err);
    process.exit(1);
  }
}
```

**Acceptance Criteria:**
- [ ] Requesty detection integrated into start flow
- [ ] Proxy starts before agent execution
- [ ] useRequesty flag passed to runAgent

#### 2.4 Update runAgent Method (30 min)

**File:** `src/cli-proxy.ts`

```typescript
private async runAgent(
  options: any,
  useOpenRouter: boolean,
  useGemini: boolean,
  useONNX: boolean = false,
  useRequesty: boolean = false // ADD THIS
): Promise<void> {
  // ... existing validation ...

  // Check for API key (unless using ONNX)
  const isOnnx = options.provider === 'onnx' || process.env.USE_ONNX === 'true';

  if (!isOnnx && !useOpenRouter && !useGemini && !useRequesty &&
      !process.env.ANTHROPIC_API_KEY) { // ADD useRequesty CHECK
    console.error('\n❌ Error: ANTHROPIC_API_KEY is required\n');
    console.error('Please set your API key:');
    console.error('  export ANTHROPIC_API_KEY=sk-ant-xxxxx\n');
    console.error('Or use alternative providers:');
    console.error('  --provider openrouter  (requires OPENROUTER_API_KEY)');
    console.error('  --provider gemini      (requires GOOGLE_GEMINI_API_KEY)');
    console.error('  --provider requesty    (requires REQUESTY_API_KEY)'); // ADD THIS
    console.error('  --provider onnx        (free local inference)\n');
    process.exit(1);
  }

  // ADD REQUESTY API KEY VALIDATION
  if (!isOnnx && useRequesty && !process.env.REQUESTY_API_KEY) {
    console.error('\n❌ Error: REQUESTY_API_KEY is required for Requesty\n');
    console.error('Please set your API key:');
    console.error('  export REQUESTY_API_KEY=requesty-xxxxx\n');
    console.error('Or use alternative providers:');
    console.error('  --provider anthropic   (requires ANTHROPIC_API_KEY)');
    console.error('  --provider openrouter  (requires OPENROUTER_API_KEY)');
    console.error('  --provider gemini      (requires GOOGLE_GEMINI_API_KEY)');
    console.error('  --provider onnx        (free local inference)\n');
    process.exit(1);
  }

  // ... existing agent loading ...

  // ADD REQUESTY DISPLAY LOGIC
  if (useRequesty) {
    const model = options.model || process.env.COMPLETION_MODEL || 'openai/gpt-4o-mini';
    console.log(`🔧 Provider: Requesty (via proxy)`);
    console.log(`🔧 Model: ${model}`);

    const capabilities = detectModelCapabilities(model);
    if (capabilities.requiresEmulation) {
      console.log(`⚙️  Tool Emulation: ${capabilities.emulationStrategy.toUpperCase()} pattern`);
      console.log(`📊 Note: This model uses prompt-based tool emulation`);
    }
    console.log('');
  } else if (useOpenRouter) {
    // ... existing OpenRouter logic ...
  }

  // ... rest of method ...
}
```

**Acceptance Criteria:**
- [ ] `useRequesty` parameter added
- [ ] Requesty API key validation
- [ ] User-friendly error messages
- [ ] Provider displayed in console output

### Phase 2 Deliverables

- [x] Provider detection for Requesty
- [x] Proxy startup integration
- [x] API key validation
- [x] User-facing console messages

### Phase 2 Acceptance Criteria

- [ ] `--provider requesty` flag works
- [ ] `USE_REQUESTY=true` environment variable works
- [ ] Proxy starts automatically
- [ ] Clear error messages for missing API key
- [ ] Console shows Requesty branding

---

## Phase 3: Model Support & Capabilities

### Duration: 2 hours

### Objective
Add Requesty model definitions to model capabilities and optimizer.

### Tasks

#### 3.1 Add Model Capabilities (60 min)

**File:** `src/utils/modelCapabilities.ts`

```typescript
const MODEL_CAPABILITIES: Record<string, Partial<ModelCapabilities>> = {
  // ... existing models ...

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
  'openai/gpt-4-turbo': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 1.00,
    provider: 'requesty'
  },
  'openai/gpt-3.5-turbo': {
    supportsNativeTools: true,
    contextWindow: 16385,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.05,
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
  'anthropic/claude-3-opus': {
    supportsNativeTools: true,
    contextWindow: 200000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 1.50,
    provider: 'requesty'
  },
  'anthropic/claude-3-sonnet': {
    supportsNativeTools: true,
    contextWindow: 200000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.30,
    provider: 'requesty'
  },
  'anthropic/claude-3-haiku': {
    supportsNativeTools: true,
    contextWindow: 200000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.08,
    provider: 'requesty'
  },

  // Requesty - Google models
  'google/gemini-2.5-pro': {
    supportsNativeTools: true,
    contextWindow: 2000000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.10,
    provider: 'requesty'
  },
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
  'deepseek/deepseek-coder': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.03,
    provider: 'requesty'
  },

  // Requesty - Meta/Llama models
  'meta-llama/llama-3.3-70b-instruct': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.10,
    provider: 'requesty'
  },
  'meta-llama/llama-3.3-8b-instruct': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.02,
    provider: 'requesty'
  },

  // Requesty - Qwen models
  'qwen/qwen-2.5-coder-32b-instruct': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.05,
    provider: 'requesty'
  },

  // Requesty - Mistral models
  'mistralai/mistral-large': {
    supportsNativeTools: true,
    contextWindow: 128000,
    requiresEmulation: false,
    emulationStrategy: 'none',
    costPerMillionTokens: 0.20,
    provider: 'requesty'
  },
};
```

**Acceptance Criteria:**
- [ ] At least 15 Requesty models defined
- [ ] Tool calling support marked correctly
- [ ] Cost estimates included
- [ ] Provider set to 'requesty'

#### 3.2 Update Agent Integration (30 min)

**File:** `src/agents/claudeAgent.ts`

```typescript
function getCurrentProvider(): string {
  // Add Requesty detection
  if (process.env.PROVIDER === 'requesty' || process.env.USE_REQUESTY === 'true') {
    return 'requesty';
  }
  if (process.env.PROVIDER === 'gemini' || process.env.USE_GEMINI === 'true') {
    return 'gemini';
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
    case 'requesty':
      return {
        model: process.env.COMPLETION_MODEL || 'openai/gpt-4o-mini',
        apiKey: process.env.REQUESTY_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        baseURL: process.env.PROXY_URL || undefined
      };

    // ... existing cases ...
  }
}

// In claudeAgent() function
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

**Acceptance Criteria:**
- [ ] `requesty` case added to `getCurrentProvider()`
- [ ] `requesty` case added to `getModelForProvider()`
- [ ] Proxy configuration for Requesty
- [ ] Logging for Requesty provider

#### 3.3 Add to Model Optimizer (30 min)

**File:** `src/utils/modelOptimizer.ts`

Add Requesty models to `MODEL_DATABASE` (see Architecture doc for full list).

**Acceptance Criteria:**
- [ ] At least 10 Requesty models in optimizer
- [ ] Quality scores assigned
- [ ] Cost data accurate
- [ ] Use cases defined

### Phase 3 Deliverables

- [x] 15+ Requesty models in capabilities
- [x] Agent integration for Requesty
- [x] Model optimizer support

### Phase 3 Acceptance Criteria

- [ ] Model capabilities detect Requesty models
- [ ] Agent SDK routes to Requesty proxy
- [ ] Optimizer can recommend Requesty models
- [ ] All models have accurate metadata

---

## Phase 4: Testing & Validation

### Duration: 3 hours

### Objective
Comprehensive testing of Requesty integration across multiple models and scenarios.

### Tasks

#### 4.1 Unit Tests (60 min)

**File:** Create `src/proxy/anthropic-to-requesty.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicToRequestyProxy } from './anthropic-to-requesty';

describe('AnthropicToRequestyProxy', () => {
  let proxy: AnthropicToRequestyProxy;

  beforeEach(() => {
    proxy = new AnthropicToRequestyProxy({
      requestyApiKey: 'test-key',
      defaultModel: 'openai/gpt-4o-mini'
    });
  });

  it('should initialize with correct config', () => {
    expect(proxy).toBeDefined();
  });

  it('should convert Anthropic request to OpenAI format', () => {
    // Test conversion logic
  });

  it('should handle tool calling in requests', () => {
    // Test tool conversion
  });

  it('should convert OpenAI response to Anthropic format', () => {
    // Test response conversion
  });

  it('should handle streaming responses', () => {
    // Test streaming
  });

  it('should handle errors gracefully', () => {
    // Test error handling
  });
});
```

**Acceptance Criteria:**
- [ ] Test file created
- [ ] At least 6 test cases
- [ ] All tests pass
- [ ] Code coverage >80%

#### 4.2 Integration Tests (60 min)

**File:** Create `tests/integration/requesty.test.ts`

```bash
# Test basic chat
npx agentic-flow --agent coder \
  --task "Say hello" \
  --provider requesty \
  --model "openai/gpt-4o-mini"

# Test with tool calling
npx agentic-flow --agent coder \
  --task "Create a file test.txt with 'Hello World'" \
  --provider requesty

# Test streaming
npx agentic-flow --agent coder \
  --task "Explain async/await" \
  --provider requesty \
  --stream

# Test model override
npx agentic-flow --agent researcher \
  --task "Research AI trends" \
  --provider requesty \
  --model "anthropic/claude-3.5-sonnet"

# Test error handling (invalid key)
REQUESTY_API_KEY=invalid npx agentic-flow --agent coder \
  --task "Test" \
  --provider requesty
```

**Test Matrix:**

| Test | Model | Tools | Streaming | Expected Result |
|------|-------|-------|-----------|-----------------|
| Basic chat | gpt-4o-mini | No | No | Success |
| Tool calling | gpt-4o-mini | Yes | No | File created |
| Streaming | gpt-4o | No | Yes | Stream output |
| Claude model | claude-3.5-sonnet | Yes | No | Success |
| Gemini model | gemini-2.5-flash | Yes | No | Success (FREE) |
| DeepSeek model | deepseek-chat-v3 | Yes | No | Success |
| Invalid key | gpt-4o-mini | No | No | Auth error |
| Rate limit | gpt-4o-mini | No | No | Retry/error |

**Acceptance Criteria:**
- [ ] All 8 test scenarios documented
- [ ] At least 5 test scenarios executed successfully
- [ ] Tool calling works with multiple models
- [ ] Streaming works correctly
- [ ] Error handling validated

#### 4.3 Multi-Model Testing (60 min)

Test with different model types:

```bash
# OpenAI models
npx agentic-flow --agent coder --task "Create function" --provider requesty --model "openai/gpt-4o-mini"
npx agentic-flow --agent coder --task "Create function" --provider requesty --model "openai/gpt-4-turbo"

# Anthropic models
npx agentic-flow --agent coder --task "Create function" --provider requesty --model "anthropic/claude-3.5-sonnet"
npx agentic-flow --agent coder --task "Create function" --provider requesty --model "anthropic/claude-3-haiku"

# Google models
npx agentic-flow --agent coder --task "Create function" --provider requesty --model "google/gemini-2.5-flash"

# DeepSeek models
npx agentic-flow --agent coder --task "Create function" --provider requesty --model "deepseek/deepseek-chat-v3"

# Meta models
npx agentic-flow --agent coder --task "Create function" --provider requesty --model "meta-llama/llama-3.3-70b-instruct"
```

**Acceptance Criteria:**
- [ ] Tested with at least 5 different providers
- [ ] All models return valid responses
- [ ] Tool calling works across models
- [ ] No provider-specific errors

### Phase 4 Deliverables

- [x] Unit test suite
- [x] Integration test suite
- [x] Multi-model validation
- [x] Test documentation

### Phase 4 Acceptance Criteria

- [ ] All unit tests pass
- [ ] At least 5 integration tests pass
- [ ] 5+ models tested successfully
- [ ] Tool calling validated
- [ ] Streaming validated
- [ ] Error handling validated

---

## Phase 5: Documentation & Polish

### Duration: 2 hours

### Objective
Complete user-facing documentation and polish user experience.

### Tasks

#### 5.1 Update README (30 min)

**File:** `README.md`

Add Requesty section:

```markdown
### Requesty Integration

Access 300+ AI models through Requesty's unified gateway:

```bash
# Set your Requesty API key
export REQUESTY_API_KEY="requesty-xxxxxxxxxxxxx"

# Use with any agent
npx agentic-flow --agent coder \
  --task "Create a Python function" \
  --provider requesty

# Specify model
npx agentic-flow --agent researcher \
  --task "Research AI trends" \
  --provider requesty \
  --model "anthropic/claude-3.5-sonnet"

# Enable streaming
npx agentic-flow --agent coder \
  --task "Explain async/await" \
  --provider requesty \
  --stream
```

**Popular Requesty Models:**
- `openai/gpt-4o-mini` - Fast, cost-effective
- `anthropic/claude-3.5-sonnet` - High quality
- `google/gemini-2.5-flash` - FREE tier
- `deepseek/deepseek-chat-v3` - Cheap, good quality
- `meta-llama/llama-3.3-70b-instruct` - Open source
```

**Acceptance Criteria:**
- [ ] Requesty section added to README
- [ ] Examples provided
- [ ] Model list documented
- [ ] API key setup explained

#### 5.2 Create Migration Guide (30 min)

**File:** `docs/plans/requesty/05-migration-guide.md`

(See separate file content below)

**Acceptance Criteria:**
- [ ] Migration guide created
- [ ] User-facing documentation
- [ ] Examples for all use cases
- [ ] Troubleshooting section

#### 5.3 Update Help Text (30 min)

**File:** `src/cli-proxy.ts`

Update `printHelp()` method:

```typescript
console.log(`
PROVIDERS:
  --provider, -p <name>       Provider to use:
                              • anthropic (Claude models, premium quality)
                              • openrouter (100+ models, 90% savings)
                              • gemini (Google models, free tier)
                              • requesty (300+ models, 80% savings)  <-- ADD THIS
                              • onnx (local inference, 100% free)

REQUESTY MODELS (300+ available):
  ✅ openai/gpt-4o-mini              (fast, $0.03/1M tokens)
  ✅ anthropic/claude-3.5-sonnet     (quality, $0.60/1M tokens)
  ✅ google/gemini-2.5-flash         (FREE tier)
  ✅ deepseek/deepseek-chat-v3       (cheap, $0.03/1M tokens)
  ✅ meta-llama/llama-3.3-70b        (OSS, $0.10/1M tokens)

  See https://app.requesty.ai/model-list for full catalog.

ENVIRONMENT VARIABLES:
  REQUESTY_API_KEY       Requesty API key (300+ models)  <-- ADD THIS
  ANTHROPIC_API_KEY      Anthropic API key (Claude models)
  OPENROUTER_API_KEY     OpenRouter API key (100+ models)
  GOOGLE_GEMINI_API_KEY  Google Gemini API key
  USE_REQUESTY           Set to 'true' to force Requesty  <-- ADD THIS
`);
```

**Acceptance Criteria:**
- [ ] Help text updated
- [ ] Requesty documented in providers list
- [ ] Example models listed
- [ ] Environment variables documented

#### 5.4 Add .env.example (30 min)

**File:** `.env.example`

```bash
# Add Requesty section
# ============================================
# Requesty Configuration (300+ Models)
# ============================================
REQUESTY_API_KEY=                    # Get from https://app.requesty.ai
REQUESTY_BASE_URL=https://router.requesty.ai/v1  # Optional: Custom base URL
USE_REQUESTY=false                   # Set to 'true' to force Requesty provider
```

**Acceptance Criteria:**
- [ ] .env.example updated
- [ ] Requesty variables documented
- [ ] Comments explain purpose
- [ ] Link to API key page

### Phase 5 Deliverables

- [x] README updated
- [x] Migration guide created
- [x] Help text updated
- [x] .env.example updated

### Phase 5 Acceptance Criteria

- [ ] All documentation files updated
- [ ] Clear user-facing examples
- [ ] No broken links
- [ ] Consistent formatting

---

## Post-Implementation Checklist

### Code Quality

- [ ] All TypeScript code compiles without errors
- [ ] No linting warnings
- [ ] Code follows existing patterns
- [ ] Proper error handling
- [ ] Logging at appropriate levels

### Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Tested with 5+ models
- [ ] Tool calling validated
- [ ] Streaming validated
- [ ] Error handling validated

### Documentation

- [ ] README updated
- [ ] Migration guide complete
- [ ] Help text updated
- [ ] .env.example updated
- [ ] Code comments added

### User Experience

- [ ] Clear error messages
- [ ] Helpful console output
- [ ] Consistent with other providers
- [ ] API key validation works
- [ ] Provider detection works

### Security

- [ ] API keys not logged in full
- [ ] API keys not committed to git
- [ ] Proper .gitignore entries
- [ ] Secure proxy communication

## Rollback Plan

If critical issues are discovered:

### Immediate Rollback

```bash
# Revert all Requesty changes
git revert <commit-hash>
git push
```

### Partial Rollback

```bash
# Remove Requesty files but keep docs
rm src/proxy/anthropic-to-requesty.ts
git checkout HEAD -- src/cli-proxy.ts
git checkout HEAD -- src/agents/claudeAgent.ts
```

### Feature Flag

Add feature flag to disable Requesty:

```typescript
if (process.env.ENABLE_REQUESTY !== 'true') {
  // Skip Requesty provider detection
  return false;
}
```

## Success Metrics

### Phase 1 Success
- Proxy compiles and starts
- Health check returns 200

### Phase 2 Success
- CLI detects `--provider requesty`
- Proxy starts automatically
- Environment variables set correctly

### Phase 3 Success
- At least 10 models defined
- Model capabilities accurate
- Optimizer includes Requesty

### Phase 4 Success
- 5+ models tested successfully
- Tool calling works
- Streaming works
- Error handling works

### Phase 5 Success
- Documentation complete
- Clear user examples
- Help text updated

## Timeline

| Week | Phases | Deliverables |
|------|--------|--------------|
| Week 1 | Phase 1-2 | Proxy + CLI integration |
| Week 2 | Phase 3-4 | Models + Testing |
| Week 3 | Phase 5 | Documentation + Polish |

## Conclusion

This implementation plan provides a **clear, step-by-step path** to adding Requesty support. By following the established OpenRouter pattern, we minimize risk and maximize code reuse.

**Estimated Total Effort:** 13 hours
**Risk Level:** LOW
**Code Reuse:** 95%
