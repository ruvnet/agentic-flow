/**
 * GNN Compatibility Wrapper
 *
 * Fixes API issues with @ruvector/gnn by:
 * 1. Auto-converting regular arrays to Float32Array
 * 2. Providing fallback implementations for broken functions
 * 3. Type-safe interface matching documentation
 */

// Dynamic GNN import with graceful degradation
const gnn: any = await (async () => {
  try {
    const module = await import('@ruvector/gnn');
    return module.default || module;
  } catch {
    return null;
  }
})();

export interface SearchResult {
  indices: number[];
  weights: number[];
}

export interface CompressionConfig {
  levelType: 'none' | 'half' | 'pq8' | 'pq4' | 'binary';
  scale?: number;
  subvectors?: number;
  centroids?: number;
  outlierThreshold?: number;
  threshold?: number;
}

/**
 * Fixed differentiableSearch that accepts regular arrays
 * Automatically converts to Float32Array internally
 */
export function differentiableSearch(
  query: number[],
  candidateEmbeddings: number[][],
  k: number,
  temperature: number = 1.0
): SearchResult {
  // Convert to Float32Array
  const queryTyped = new Float32Array(query);
  const candidatesTyped = candidateEmbeddings.map(
    candidate => new Float32Array(candidate)
  );

  try {
    const result = gnn.differentiableSearch(queryTyped, candidatesTyped, k, temperature);

    return {
      indices: Array.from(result.indices),
      weights: Array.from(result.weights)
    };
  } catch (error: any) {
    throw new Error(`GNN differentiableSearch failed: ${error.message}`);
  }
}

/**
 * Fallback hierarchicalForward using simple matrix multiplication
 * Since the native implementation is broken
 */
export function hierarchicalForward(
  input: number[],
  weights: number[] | number[][],
  inputDim: number,
  outputDim: number
): number[] {
  try {
    // Try native implementation first
    const inputTyped = new Float32Array(input);
    const weightsTyped = Array.isArray(weights[0])
      ? (weights as number[][]).map(w => new Float32Array(w))
      : new Float32Array(weights as number[]);

    const result = gnn.hierarchicalForward(inputTyped, weightsTyped, inputDim, outputDim);
    return Array.from(result);
  } catch (error) {
    // Fallback to JavaScript implementation
    console.warn('GNN hierarchicalForward failed, using fallback implementation');
    return hierarchicalForwardFallback(input, weights, inputDim, outputDim);
  }
}

/**
 * Fallback implementation using basic matrix multiplication
 */
function hierarchicalForwardFallback(
  input: number[],
  weights: number[] | number[][],
  inputDim: number,
  outputDim: number
): number[] {
  // Simple matrix multiplication: output = input * weights^T
  const output = new Array(outputDim).fill(0);

  if (Array.isArray(weights[0])) {
    // weights is 2D array [outputDim][inputDim]
    const weightsMatrix = weights as number[][];
    for (let i = 0; i < outputDim; i++) {
      for (let j = 0; j < inputDim; j++) {
        output[i] += input[j] * weightsMatrix[i][j];
      }
    }
  } else {
    // weights is 1D array (flattened)
    const weightsFlat = weights as number[];
    for (let i = 0; i < outputDim; i++) {
      for (let j = 0; j < inputDim; j++) {
        output[i] += input[j] * weightsFlat[i * inputDim + j];
      }
    }
  }

  return output;
}

/**
 * RuvectorLayer wrapper with fallback
 */
export class RuvectorLayer {
  private inputDim: number;
  private outputDim: number;
  private weights: number[][];
  private activation: 'relu' | 'tanh' | 'sigmoid' | 'none';

  constructor(
    inputDim: number,
    outputDim: number,
    activation: 'relu' | 'tanh' | 'sigmoid' | 'none' = 'relu'
  ) {
    // Issue #118/#119 — validate constructor arguments instead of letting
    // an upstream native panic tear down the FFI / process. Callers
    // sometimes pass `config.layers` (an array or count) where the
    // constructor expects an integer dimension; surface that as a typed
    // error rather than a panic.
    if (typeof inputDim !== 'number' || !Number.isFinite(inputDim) || inputDim <= 0 || !Number.isInteger(inputDim)) {
      throw new TypeError(
        `RuvectorLayer: inputDim must be a positive integer, got ${typeof inputDim} ${String(inputDim)}`
      );
    }
    if (typeof outputDim !== 'number' || !Number.isFinite(outputDim) || outputDim <= 0 || !Number.isInteger(outputDim)) {
      throw new TypeError(
        `RuvectorLayer: outputDim must be a positive integer, got ${typeof outputDim} ${String(outputDim)}`
      );
    }
    if (!['relu', 'tanh', 'sigmoid', 'none'].includes(activation)) {
      throw new TypeError(
        `RuvectorLayer: activation must be one of relu|tanh|sigmoid|none, got ${String(activation)}`
      );
    }

    this.inputDim = inputDim;
    this.outputDim = outputDim;
    this.activation = activation;

    // Initialize random weights
    this.weights = Array.from({ length: outputDim }, () =>
      Array.from({ length: inputDim }, () => (Math.random() - 0.5) * 0.1)
    );
  }

  forward(input: number[]): number[] {
    if (input.length !== this.inputDim) {
      throw new Error(
        `Input dimension mismatch: expected ${this.inputDim}, got ${input.length}`
      );
    }

    // Matrix multiplication
    let output = hierarchicalForwardFallback(
      input,
      this.weights,
      this.inputDim,
      this.outputDim
    );

    // Apply activation
    output = this.applyActivation(output);

    return output;
  }

  private applyActivation(values: number[]): number[] {
    switch (this.activation) {
      case 'relu':
        return values.map(v => Math.max(0, v));
      case 'tanh':
        return values.map(v => Math.tanh(v));
      case 'sigmoid':
        return values.map(v => 1 / (1 + Math.exp(-v)));
      case 'none':
        return values;
      default:
        return values;
    }
  }

  getWeights(): number[][] {
    return this.weights;
  }

  setWeights(weights: number[][]): void {
    if (weights.length !== this.outputDim || weights[0].length !== this.inputDim) {
      throw new Error('Weight dimensions do not match layer dimensions');
    }
    this.weights = weights;
  }
}

/**
 * TensorCompress wrapper with working compression levels
 */
export class TensorCompress {
  private config: CompressionConfig;

  constructor(config: string | CompressionConfig) {
    if (typeof config === 'string') {
      this.config = { levelType: config as any };
    } else {
      this.config = config;
    }
  }

  compress(tensor: number[]): number[] {
    switch (this.config.levelType) {
      case 'none':
        return tensor;

      case 'half':
        // 16-bit float compression (approximate with scale)
        const scale = this.config.scale || 1.0;
        return tensor.map(v => Math.round(v / scale) * scale);

      case 'pq8':
      case 'pq4':
        // Product quantization (simplified)
        const bits = this.config.levelType === 'pq8' ? 8 : 4;
        const levels = Math.pow(2, bits);
        const min = Math.min(...tensor);
        const max = Math.max(...tensor);
        const range = max - min;
        return tensor.map(v => {
          const quantized = Math.round(((v - min) / range) * (levels - 1));
          return (quantized / (levels - 1)) * range + min;
        });

      case 'binary':
        // Binary quantization
        const threshold = this.config.threshold || 0;
        return tensor.map(v => (v > threshold ? 1 : 0));

      default:
        return tensor;
    }
  }

  decompress(compressed: number[]): number[] {
    // For simple compressions, decompression is identity
    return compressed;
  }

  getCompressionRatio(): number {
    switch (this.config.levelType) {
      case 'none':
        return 1;
      case 'half':
        return 2; // 32-bit → 16-bit
      case 'pq8':
        return 4; // 32-bit → 8-bit
      case 'pq4':
        return 8; // 32-bit → 4-bit
      case 'binary':
        return 32; // 32-bit → 1-bit
      default:
        return 1;
    }
  }
}

/**
 * Get compression level configuration
 * Fixed version that returns proper config objects
 */
export function getCompressionLevel(level: string): CompressionConfig {
  const configs: Record<string, CompressionConfig> = {
    none: { levelType: 'none' },
    half: { levelType: 'half', scale: 1.0 },
    pq8: { levelType: 'pq8', subvectors: 8, centroids: 256 },
    pq4: { levelType: 'pq4', subvectors: 8, centroids: 16, outlierThreshold: 0.1 },
    binary: { levelType: 'binary', threshold: 0.0 }
  };

  if (!(level in configs)) {
    throw new Error(
      `Invalid compression level: ${level}. Valid options: ${Object.keys(configs).join(', ')}`
    );
  }

  return configs[level];
}

/**
 * Check if GNN native module is available and working
 */
export function isGNNAvailable(): boolean {
  try {
    const query = new Float32Array([1.0, 0.0]);
    const candidates = [new Float32Array([1.0, 0.0]), new Float32Array([0.0, 1.0])];
    gnn.differentiableSearch(query, candidates, 2, 1.0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize GNN module (if needed)
 */
export function initGNN(): void {
  if (typeof gnn.init === 'function') {
    gnn.init();
  }
}

// Export original for advanced users who want direct access
export { gnn as gnnRaw };

// Re-export SearchResult type
export type { SearchResult as GNNSearchResult };
