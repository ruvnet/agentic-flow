/**
 * ONNX Runtime Provider for Phi-4 Model
 *
 * Hybrid implementation with fallback to HuggingFace Inference API
 * when local ONNX model is not available
 */

import { HfInference } from '@huggingface/inference';
import { PHI4_MODEL_PATH } from '../../utils/model-downloader.js';
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  StreamChunk,
  ProviderError,
  Message,
  ContentBlock
} from '../types.js';

export interface ONNXPhi4Config {
  modelId?: string;
  useLocalONNX?: boolean;
  huggingfaceApiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export class ONNXPhi4Provider implements LLMProvider {
  name = 'onnx-phi4';
  type = 'custom' as const;
  supportsStreaming = true;
  supportsTools = false;
  supportsMCP = false;

  private config: Required<ONNXPhi4Config>;
  private hf: HfInference;
  private modelPath = PHI4_MODEL_PATH;

  constructor(config: ONNXPhi4Config = {}) {
    this.config = {
      modelId: config.modelId || 'microsoft/Phi-3-mini-4k-instruct',
      useLocalONNX: config.useLocalONNX ?? false, // Default to API until local model downloaded
      huggingfaceApiKey: config.huggingfaceApiKey || process.env.HUGGINGFACE_API_KEY || '',
      maxTokens: config.maxTokens || 512,
      temperature: config.temperature || 0.7
    };

    this.hf = new HfInference(this.config.huggingfaceApiKey);
  }

  /**
   * Format messages for Phi-4 chat template
   */
  private formatMessages(messages: Message[]): string {
    let prompt = '';

    for (const msg of messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map(c => c.type === 'text' ? c.text : '').join('');

      if (msg.role === 'system') {
        prompt += `<|system|>\n${content}<|end|>\n`;
      } else if (msg.role === 'user') {
        prompt += `<|user|>\n${content}<|end|>\n`;
      } else if (msg.role === 'assistant') {
        prompt += `<|assistant|>\n${content}<|end|>\n`;
      }
    }

    prompt += '<|assistant|>\n';
    return prompt;
  }

  /**
   * Chat completion via HuggingFace Inference API
   */
  private async chatViaAPI(params: ChatParams): Promise<ChatResponse> {
    const startTime = Date.now();
    const prompt = this.formatMessages(params.messages);

    try {
      const result = await this.hf.textGeneration({
        model: this.config.modelId,
        inputs: prompt,
        parameters: {
          max_new_tokens: params.maxTokens || this.config.maxTokens,
          temperature: params.temperature || this.config.temperature,
          return_full_text: false,
          do_sample: true,
          top_p: 0.9
        }
      });

      const latency = Date.now() - startTime;
      const generatedText = result.generated_text;

      // Clean up the response
      const assistantResponse = generatedText
        .split('<|end|>')[0]
        .trim();

      // Estimate token counts
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(assistantResponse.length / 4);

      const content: ContentBlock[] = [{
        type: 'text',
        text: assistantResponse
      }];

      return {
        id: `onnx-phi4-${Date.now()}`,
        model: this.config.modelId,
        content,
        stopReason: 'end_turn',
        usage: {
          inputTokens,
          outputTokens
        },
        metadata: {
          provider: 'onnx-phi4',
          model: this.config.modelId,
          latency,
          cost: outputTokens * 0.000002, // Rough estimate
          mode: 'api'
        }
      };

    } catch (error) {
      const providerError: ProviderError = {
        name: 'ONNXPhi4APIError',
        message: `HuggingFace API inference failed: ${error}`,
        provider: 'onnx-phi4',
        retryable: true
      };
      throw providerError;
    }
  }

  /**
   * Chat completion via local ONNX (not yet implemented)
   */
  private async chatViaONNX(params: ChatParams): Promise<ChatResponse> {
    throw new Error('Local ONNX inference not yet implemented. Download model.onnx.data first.');
  }

  /**
   * Chat completion (uses API or local ONNX based on config)
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    if (this.config.useLocalONNX) {
      return this.chatViaONNX(params);
    } else {
      return this.chatViaAPI(params);
    }
  }

  /**
   * Streaming generation via HuggingFace API
   */
  async *stream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const prompt = this.formatMessages(params.messages);

    try {
      const stream = this.hf.textGenerationStream({
        model: this.config.modelId,
        inputs: prompt,
        parameters: {
          max_new_tokens: params.maxTokens || this.config.maxTokens,
          temperature: params.temperature || this.config.temperature,
          return_full_text: false
        }
      });

      for await (const chunk of stream) {
        if (chunk.token.text) {
          yield {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: chunk.token.text
            }
          };
        }
      }

      yield {
        type: 'message_stop'
      };

    } catch (error) {
      const providerError: ProviderError = {
        name: 'ONNXPhi4StreamError',
        message: `Streaming failed: ${error}`,
        provider: 'onnx-phi4',
        retryable: true
      };
      throw providerError;
    }
  }

  /**
   * Validate capabilities
   */
  validateCapabilities(features: string[]): boolean {
    const supported = ['chat', 'stream'];
    return features.every(f => supported.includes(f));
  }

  /**
   * Get model info
   */
  getModelInfo() {
    return {
      modelId: this.config.modelId,
      mode: this.config.useLocalONNX ? 'local-onnx' : 'api',
      supportsLocalInference: false, // Will be true when model.onnx.data downloaded
      modelPath: this.modelPath,
      apiKey: this.config.huggingfaceApiKey ? '***' : undefined
    };
  }

  /**
   * Switch between API and local ONNX
   */
  setMode(useLocalONNX: boolean) {
    this.config.useLocalONNX = useLocalONNX;
  }
}
