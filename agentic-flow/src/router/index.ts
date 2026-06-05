/**
 * Router module - Multi-model routing for agentic-flow
 *
 * Provides intelligent routing between LLM providers:
 * - Anthropic
 * - OpenRouter
 * - Gemini
 * - ONNX Local
 */

// Main router class
export { ModelRouter } from './router.js';

// Types
export type {
  LLMProvider,
  ProviderType,
  ChatParams,
  ChatResponse,
  StreamChunk,
  Message,
  ContentBlock,
  Tool,
  ProviderConfig,
  RouterConfig,
  RoutingConfig,
  RoutingRule,
  ToolCallingConfig,
  MonitoringConfig,
  CacheConfig,
  RouterMetrics,
  ProviderError,
} from './types.js';

// Model mappings
export { CLAUDE_MODELS, mapModelId, getModelName, listModels } from './model-mapping.js';
export type { ModelMapping } from './model-mapping.js';

// Providers
export { OpenRouterProvider } from './providers/openrouter.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { GeminiProvider } from './providers/gemini.js';
export { ONNXLocalProvider } from './providers/onnx-local.js';
export { OllamaProvider } from './providers/ollama.js';
