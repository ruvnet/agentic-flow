#!/usr/bin/env node
/**
 * Agent Booster - Morph LLM Compatible API
 *
 * Drop-in replacement for Morph LLM with 52x better performance
 */

import * as path from 'path';
import * as fs from 'fs';

// Load WASM module
const wasmPath = path.join(__dirname, '../wasm/agent_booster_wasm.js');
let AgentBoosterWasm: any;

try {
  AgentBoosterWasm = require(wasmPath);
} catch (e) {
  throw new Error(`Failed to load WASM module from ${wasmPath}: ${e}`);
}

export interface MorphApplyRequest {
  /** Original code to modify */
  code: string;
  /** Edit instruction or snippet to apply */
  edit: string;
  /** Programming language (e.g., 'javascript', 'typescript', 'python') */
  language?: string;
}

export interface MorphApplyResponse {
  /** Modified code after applying the edit (Morph-compatible) */
  output: string;
  /** Whether the edit was successful (Morph-compatible) */
  success: boolean;
  /** Latency in milliseconds (Morph-compatible) */
  latency: number;
  /** Token usage (Morph-compatible) */
  tokens: {
    input: number;
    output: number;
  };
  /** Confidence score (0-1) - Agent Booster extension */
  confidence: number;
  /** Strategy used for merging - Agent Booster extension */
  strategy: string;
}

export interface AgentBoosterConfig {
  /** Minimum confidence threshold (0-1). Default: 0.5 */
  confidenceThreshold?: number;
  /** Maximum chunks to analyze. Default: 100 */
  maxChunks?: number;
}

/**
 * Agent Booster - Morph-compatible code editor
 *
 * @example
 * ```typescript
 * const booster = new AgentBooster();
 * const result = await booster.apply({
 *   code: 'function add(a, b) { return a + b; }',
 *   edit: 'function add(a: number, b: number): number { return a + b; }',
 *   language: 'typescript'
 * });
 * console.log(result.code); // Modified code
 * ```
 */
export class AgentBooster {
  private config: AgentBoosterConfig;
  private wasmInstance: any;

  constructor(config: AgentBoosterConfig = {}) {
    this.config = {
      confidenceThreshold: config.confidenceThreshold || 0.5,
      maxChunks: config.maxChunks || 100,
    };

    // Initialize WASM instance. The threshold is set on the WASM config because
    // apply_edit() takes no threshold argument (max_chunks keeps the WASM default).
    const wasmConfig = new AgentBoosterWasm.WasmConfig();
    wasmConfig.confidence_threshold = this.config.confidenceThreshold;
    this.wasmInstance = AgentBoosterWasm.AgentBoosterWasm.with_config(wasmConfig);
  }

  /**
   * Map a language name to the WASM `WasmLanguage` enum value.
   *
   * apply_edit() takes the numeric enum, not a string. Older wasm-bindgen glue
   * coerced a string to 0 (JavaScript) silently; current glue rejects it with
   * "invalid enum value passed", which made every edit fail. Unknown names fall
   * back to JavaScript, matching what 0.2.2 actually did for every language.
   */
  private toWasmLanguage(language?: string): number {
    try {
      return AgentBoosterWasm.AgentBoosterWasm.parse_language(language || 'javascript');
    } catch {
      return AgentBoosterWasm.WasmLanguage.JavaScript;
    }
  }

  /**
   * Apply a code edit (100% Morph-compatible API)
   *
   * @param request - Apply request
   * @returns Modified code in Morph-compatible format
   */
  async apply(request: MorphApplyRequest): Promise<MorphApplyResponse> {
    const startTime = Date.now();

    try {
      // Validate input - detect vague instructions
      if (!request.edit || request.edit.trim().length === 0) {
        throw new Error('Edit instruction cannot be empty. Provide specific code snippet or transformation.');
      }

      // Detect vague/non-code instructions
      const vaguePhrases = [
        'make it better', 'improve', 'optimize', 'fix', 'refactor',
        'add feature', 'implement', 'create', 'design', 'build',
        'handle', 'manage', 'process', 'support'
      ];

      const isVague = vaguePhrases.some(phrase =>
        request.edit.toLowerCase().includes(phrase) &&
        !request.edit.includes('{') && // No code blocks
        !request.edit.includes('function') && // No function def
        !request.edit.includes('const') && // No variable def
        !request.edit.includes('class') // No class def
      );

      if (isVague) {
        throw new Error(`Vague instruction detected: "${request.edit}". Agent Booster requires specific code snippets, not high-level instructions. Use an LLM for vague tasks.`);
      }

      // Call WASM module (threshold comes from the WASM config set in the constructor)
      const result = this.wasmInstance.apply_edit(
        request.code,
        request.edit,
        this.toWasmLanguage(request.language)
      );

      const latency = Date.now() - startTime;

      // Debug: Log WASM result structure
      if (process.env.DEBUG_AGENT_BOOSTER) {
        console.log('WASM result:', {
          type: typeof result,
          confidence: result.confidence,
          strategy: result.strategy,
          merged_code_length: result.merged_code?.length,
        });
      }

      // Convert WASM result to Morph-compatible format
      const confidence = this.getConfidence(result);
      const strategy = this.getStrategy(result);
      const mergedCode = this.getMergedCode(result);

      // Calculate token estimates (WASM doesn't track tokens, so we estimate)
      const inputTokens = Math.ceil(request.code.length / 4);
      const outputTokens = Math.ceil(mergedCode.length / 4);

      return {
        // Morph-compatible fields
        output: mergedCode,
        success: confidence > this.config.confidenceThreshold!,
        latency: latency,
        tokens: {
          input: inputTokens,
          output: outputTokens,
        },
        // Agent Booster extensions (don't break Morph compatibility)
        confidence: confidence,
        strategy: this.strategyToString(strategy),
      };
    } catch (error: any) {
      // Return failure in Morph-compatible format
      const latency = Date.now() - startTime;

      // Debug: Log error
      if (process.env.DEBUG_AGENT_BOOSTER) {
        console.error('Error in apply():', error.message || error);
      }

      return {
        output: request.code,
        success: false,
        latency: latency,
        tokens: { input: 0, output: 0 },
        confidence: 0,
        strategy: 'failed',
      };
    }
  }

  /**
   * Batch apply multiple edits
   *
   * @param requests - Array of apply requests
   * @returns Array of results
   */
  async batchApply(requests: MorphApplyRequest[]): Promise<MorphApplyResponse[]> {
    return Promise.all(requests.map(req => this.apply(req)));
  }

  // Helper methods to extract data from WASM result
  private getConfidence(result: any): number {
    if (typeof result === 'object' && result !== null) {
      if (typeof result.confidence === 'number') return result.confidence;
      if (typeof result.get_confidence === 'function') return result.get_confidence();
    }
    return 0.5;
  }

  private getStrategy(result: any): number | string {
    if (typeof result === 'object' && result !== null) {
      if (typeof result.strategy === 'number') return result.strategy;
      if (typeof result.strategy === 'string') return result.strategy;
      if (typeof result.get_strategy === 'function') return result.get_strategy();
    }
    return 2; // Default to InsertAfter
  }

  private getMergedCode(result: any): string {
    if (typeof result === 'object' && result !== null) {
      if (typeof result.merged_code === 'string') return result.merged_code;
      if (typeof result.get_merged_code === 'function') return result.get_merged_code();
      if (typeof result.code === 'string') return result.code;
    }
    return '';
  }

  private strategyToString(strategy: number | string): string {
    if (typeof strategy === 'string') return strategy;

    const strategies: { [key: number]: string } = {
      0: 'exact_replace',
      1: 'fuzzy_replace',
      2: 'insert_after',
      3: 'insert_before',
      4: 'append',
    };

    return strategies[strategy] || 'unknown';
  }
}

/**
 * Convenience function for single apply operation
 *
 * @param request - Apply request
 * @returns Modified code with metadata
 */
export async function apply(request: MorphApplyRequest): Promise<MorphApplyResponse> {
  const booster = new AgentBooster();
  return booster.apply(request);
}

// Default export
export default AgentBooster;
