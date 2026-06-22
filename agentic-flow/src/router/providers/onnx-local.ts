/**
 * ONNX Runtime Local Inference Provider for Phi-4
 *
 * Uses onnxruntime-node for true local CPU/GPU inference
 * Falls back gracefully when native module isn't available (Windows)
 *
 * NOTE (ruvnet/ruflo#2048): `onnxruntime-node` is loaded LAZILY on first
 * `initializeSession()` call, not at module import. The previous top-level
 * `await import('onnxruntime-node')` fired the native-binding load
 * (`onnxruntime_binding.node`) at module load time, which crashed Windows
 * environments where the NAPI binary cannot be loaded — even when the
 * consumer (e.g. `agentic-flow/reasoningbank`) never actually invokes
 * the router. Moving the import inside `loadOrt()` keeps importing
 * `reasoningbank` side-effect-free with respect to native bindings.
 */

let ort: any = null;
let ortAvailable = false;
let ortLoaded = false;

async function loadOrt(): Promise<void> {
  if (ortLoaded) return;
  ortLoaded = true;
  try {
    ort = await import('onnxruntime-node');
    ortAvailable = true;
  } catch {
    console.warn('[ONNX] onnxruntime-node not available - local inference disabled');
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { get_encoding } from 'tiktoken';
import { ensurePhi4Model, ModelDownloader } from '../../utils/model-downloader.js';
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  StreamChunk,
  ProviderError,
  Message,
  ContentBlock
} from '../types.js';

export interface ONNXLocalConfig {
  modelPath?: string;
  executionProviders?: string[];
  maxTokens?: number;
  temperature?: number;
}

export class ONNXLocalProvider implements LLMProvider {
  name = 'onnx-local';
  type = 'custom' as const;
  supportsStreaming = false; // Streaming requires complex token generation loop
  supportsTools = false;
  supportsMCP = false;

  private session: any = null;
  private config: Required<ONNXLocalConfig>;
  private tokenizer: any = null;
  private tiktoken: any = null;

  constructor(config: ONNXLocalConfig = {}) {
    this.config = {
      modelPath: config.modelPath || './models/phi-4/cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4/model.onnx',
      executionProviders: config.executionProviders || ['cpu'],
      maxTokens: config.maxTokens || 100,
      temperature: config.temperature || 0.7
    };
  }

  /**
   * Load optimized tiktoken tokenizer (cl100k_base for Phi-4)
   */
  private async loadTokenizer(): Promise<void> {
    if (this.tiktoken) return;

    try {
      // Use cl100k_base encoding (GPT-4, similar to Phi-4)
      this.tiktoken = get_encoding('cl100k_base');

      console.log('✅ Tokenizer loaded (tiktoken cl100k_base)');
    } catch (error) {
      console.error('❌ Failed to load tiktoken:', error);
      throw new Error(`Tokenizer loading failed: ${error}`);
    }
  }

  /**
   * Encode text using tiktoken (fast BPE)
   */
  private encode(text: string): number[] {
    return Array.from(this.tiktoken.encode(text));
  }

  /**
   * Decode tokens using tiktoken
   */
  private decode(ids: number[]): string {
    try {
      const decoded = this.tiktoken.decode(new Uint32Array(ids));
      // tiktoken returns buffer, convert to string
      if (typeof decoded === 'string') {
        return decoded;
      } else if (decoded instanceof Uint8Array || decoded instanceof Buffer) {
        return new TextDecoder().decode(decoded);
      }
      return String(decoded);
    } catch (error) {
      console.warn('Decode error, returning raw IDs:', error);
      return ids.join(',');
    }
  }

  /**
   * Initialize ONNX session (with automatic model download)
   */
  private async initializeSession(): Promise<void> {
    if (this.session) return;

    await loadOrt();
    if (!ortAvailable || !ort) {
      throw new Error('onnxruntime-node not available - install with: npm install onnxruntime-node');
    }

    try {
      // Ensure model is downloaded
      console.log(`🔍 Checking for Phi-4 ONNX model...`);

      const modelPath = await ensurePhi4Model((progress) => {
        if (progress.percentage % 10 < 1) { // Log every ~10%
          console.log(`   📥 Downloading: ${ModelDownloader.formatProgress(progress)}`);
        }
      });

      // Update config with actual model path
      this.config.modelPath = modelPath;

      console.log(`📦 Loading ONNX model: ${this.config.modelPath}`);

      this.session = await ort.InferenceSession.create(
        this.config.modelPath,
        {
          executionProviders: this.config.executionProviders as any,
          graphOptimizationLevel: 'all',
          enableCpuMemArena: true,
          enableMemPattern: true
        }
      );

      console.log(`✅ ONNX model loaded`);
      console.log(`🔧 Execution providers: ${this.config.executionProviders.join(', ')}`);

      // Load tokenizer
      await this.loadTokenizer();

    } catch (error) {
      const providerError: ProviderError = {
        name: 'ONNXInitError',
        message: `Failed to initialize ONNX model: ${error}`,
        provider: 'onnx-local',
        retryable: false
      };
      throw providerError;
    }
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
   * Initialize KV cache tensors for all 32 layers
   * Phi-4 architecture: 32 layers, 8 KV heads, 128 head_dim
   */
  private initializeKVCache(batchSize: number, sequenceLength: number) {
    const numLayers = 32;
    const numKVHeads = 8;
    const headDim = 128; // 3072 / 24 = 128
    const kvCache: Record<string, any> = {};

    // Get Tensor constructor - use any for flexible access
    const TensorClass = (ort as any).Tensor;

    // Initialize empty cache for each layer (key and value)
    for (let i = 0; i < numLayers; i++) {
      // Empty cache: [batch_size, num_kv_heads, 0, head_dim]
      const emptyCache = new Float32Array(0);

      kvCache[`past_key_values.${i}.key`] = new TensorClass(
        'float32',
        emptyCache,
        [batchSize, numKVHeads, 0, headDim]
      );

      kvCache[`past_key_values.${i}.value`] = new TensorClass(
        'float32',
        emptyCache,
        [batchSize, numKVHeads, 0, headDim]
      );
    }

    return kvCache;
  }

  /**
   * Chat completion using ONNX with KV cache
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    await this.initializeSession();

    const startTime = Date.now();
    const prompt = this.formatMessages(params.messages);

    try {
      // Tokenize input using optimized tiktoken
      const inputIds = this.encode(prompt);
      console.log(`📝 Input tokens: ${inputIds.length}`);

      // Initialize KV cache (reusable for batch)
      let pastKVCache = this.initializeKVCache(1, 0);

      // Track all generated tokens
      const allTokenIds = [...inputIds];
      const outputIds: number[] = [];

      // Pre-allocate tensor buffers for performance
      const maxSeqLen = inputIds.length + (params.maxTokens || this.config.maxTokens);

      // Autoregressive generation loop
      const maxNewTokens = params.maxTokens || this.config.maxTokens;

      for (let step = 0; step < maxNewTokens; step++) {
        // For first step, use all input tokens; for subsequent steps, use only last token
        const currentInputIds = step === 0 ? inputIds : [outputIds[outputIds.length - 1]];
        const currentSeqLen = currentInputIds.length;

        // Get Tensor constructor - use any for flexible access
        const TensorClass = (ort as any).Tensor;

        // Create input tensor for current step
        const inputTensor = new TensorClass(
          'int64',
          BigInt64Array.from(currentInputIds.map(BigInt)),
          [1, currentSeqLen]
        );

        // Create attention mask for current step
        const totalSeqLen = allTokenIds.length;
        const attentionMask = new TensorClass(
          'int64',
          BigInt64Array.from(Array(totalSeqLen).fill(1n)),
          [1, totalSeqLen]
        );

        // Build feeds with input, attention mask, and KV cache
        const feeds: Record<string, any> = {
          input_ids: inputTensor,
          attention_mask: attentionMask,
          ...pastKVCache
        };

        // Run inference
        const results = await this.session!.run(feeds);

        // Get logits for next token (last position)
        const logits = results.logits.data as Float32Array;
        const vocabSize = results.logits.dims[results.logits.dims.length - 1];

        // Extract logits for last token
        const lastTokenLogitsOffset = (currentSeqLen - 1) * vocabSize;

        // Apply temperature and get next token
        let nextToken = 0;
        let maxVal = -Infinity;

        for (let i = 0; i < vocabSize; i++) {
          const logit = logits[lastTokenLogitsOffset + i] / (params.temperature || this.config.temperature);
          if (logit > maxVal) {
            maxVal = logit;
            nextToken = i;
          }
        }

        // Add to output
        outputIds.push(nextToken);
        allTokenIds.push(nextToken);

        // Check for end token (2 is typical EOS for Phi models)
        if (nextToken === 2 || nextToken === 0) {
          console.log(`🛑 Stop token detected: ${nextToken}`);
          break;
        }

        // Update KV cache from outputs for next iteration
        pastKVCache = {};
        for (let i = 0; i < 32; i++) {
          pastKVCache[`past_key_values.${i}.key`] = results[`present.${i}.key`];
          pastKVCache[`past_key_values.${i}.value`] = results[`present.${i}.value`];
        }

        // Progress indicator
        if ((step + 1) % 10 === 0) {
          console.log(`🔄 Generated ${step + 1} tokens...`);
        }
      }

      // Decode output using optimized tiktoken
      const generatedText = this.decode(outputIds);
      const latency = Date.now() - startTime;
      const tokensPerSecond = (outputIds.length / (latency / 1000)).toFixed(1);

      console.log(`✅ Generated: ${generatedText}`);
      console.log(`⏱️  Latency: ${latency}ms (${tokensPerSecond} tokens/sec)`);

      const content: ContentBlock[] = [{
        type: 'text',
        text: generatedText.trim()
      }];

      return {
        id: `onnx-local-${Date.now()}`,
        model: this.config.modelPath,
        content,
        stopReason: 'end_turn',
        usage: {
          inputTokens: inputIds.length,
          outputTokens: outputIds.length
        },
        metadata: {
          provider: 'onnx-local',
          model: 'Phi-4-mini-instruct-onnx',
          latency,
          cost: 0, // Local inference is free
          executionProviders: this.config.executionProviders,
          tokensPerSecond: parseFloat(tokensPerSecond)
        }
      };

    } catch (error) {
      const providerError: ProviderError = {
        name: 'ONNXInferenceError',
        message: `ONNX inference failed: ${error}`,
        provider: 'onnx-local',
        retryable: true
      };
      throw providerError;
    }
  }

  /**
   * Streaming not implemented (requires complex generation loop)
   */
  async *stream(params: ChatParams): AsyncGenerator<StreamChunk> {
    throw new Error('Streaming not yet implemented for ONNX local inference');
  }

  /**
   * Validate capabilities
   */
  validateCapabilities(features: string[]): boolean {
    const supported = ['chat'];
    return features.every(f => supported.includes(f));
  }

  /**
   * Get model info
   */
  getModelInfo() {
    return {
      modelPath: this.config.modelPath,
      executionProviders: this.config.executionProviders,
      initialized: this.session !== null,
      tokenizerLoaded: this.tiktoken !== null
    };
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.session) {
      // ONNX Runtime sessions don't have explicit disposal in Node.js
      this.session = null;
    }
    if (this.tiktoken) {
      this.tiktoken.free();
      this.tiktoken = null;
    }
  }
}
