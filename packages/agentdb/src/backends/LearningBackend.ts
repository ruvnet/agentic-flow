/**
 * LearningBackend Interface - GNN self-learning capabilities (Optional)
 *
 * Provides Graph Neural Network (GNN) based learning for query enhancement
 * and adaptive pattern recognition. Available when @ruvector/gnn is installed.
 *
 * Features:
 * - Query enhancement using attention mechanisms
 * - Automatic learning from search patterns
 * - Model persistence and versioning
 */

/**
 * Learning backend configuration
 */
export interface LearningConfig {
  /** Enable learning features */
  enabled: boolean;

  /** Input dimension (must match vector dimension) */
  inputDim: number;

  /** Output dimension (defaults to inputDim) */
  outputDim?: number;

  /** Number of attention heads for GNN */
  heads?: number;

  /** Learning rate for training */
  learningRate?: number;

  /** Batch size for training */
  batchSize?: number;

  /** Path for model persistence */
  modelPath?: string;

  /** Auto-train interval in seconds (0 = disabled) */
  autoTrainInterval?: number;
}

/**
 * Training sample for supervised learning
 */
export interface TrainingSample {
  /** Input embedding */
  embedding: Float32Array;

  /** Label or class (for classification) */
  label: number;

  /** Sample weight (importance) */
  weight?: number;

  /** Additional context for learning */
  context?: Record<string, any>;
}

/**
 * Training result metrics
 */
export interface TrainingResult {
  /** Number of training epochs completed */
  epochs: number;

  /** Final loss value */
  finalLoss: number;

  /** Improvement percentage from initial loss */
  improvement: number;

  /** Training duration in milliseconds */
  duration: number;

  /** Additional metrics */
  metrics?: Record<string, number>;
}

/**
 * Learning backend statistics
 */
export interface LearningStats {
  /** Whether learning is enabled */
  enabled: boolean;

  /** Number of samples collected */
  samplesCollected: number;

  /** Timestamp of last training (null if never trained) */
  lastTrainingTime: number | null;

  /** Current model version */
  modelVersion: number;

  /** Average training loss */
  avgLoss?: number;

  /** Model accuracy (if applicable) */
  accuracy?: number;
}

/**
 * LearningBackend - Optional GNN-based learning interface
 *
 * Implementations:
 * - RuVectorLearning: Native Rust GNN with @ruvector/gnn
 * - MockLearningBackend: No-op implementation for testing
 */
export interface LearningBackend {
  /**
   * Initialize the learning backend and load models
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<void>;

  // ============================================================================
  // GNN Operations
  // ============================================================================

  /**
   * Enhance query vector using GNN attention mechanism
   *
   * Takes a query vector and its k-nearest neighbors, applies graph attention,
   * and returns an enhanced query vector with better semantic representation.
   *
   * @param query - Query vector to enhance
   * @param neighbors - Neighbor vectors for context
   * @param weights - Importance weights for each neighbor (0-1)
   * @returns Enhanced query vector
   */
  enhance(
    query: Float32Array,
    neighbors: Float32Array[],
    weights: number[]
  ): Float32Array;

  // ============================================================================
  // Training
  // ============================================================================

  /**
   * Add a training sample for future learning
   *
   * Samples are accumulated and used during the next training cycle.
   *
   * @param sample - Training sample with embedding and label
   */
  addSample(sample: TrainingSample): void;

  /**
   * Train the model on accumulated samples
   *
   * @param options - Training options (epochs, etc.)
   * @returns Training result with metrics
   */
  train(options?: { epochs?: number }): Promise<TrainingResult>;

  /**
   * Clear accumulated training samples
   */
  clearSamples(): void;

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Save trained model to disk
   *
   * @param path - File path to save the model
   * @returns Promise that resolves when model is saved
   */
  saveModel(path: string): Promise<void>;

  /**
   * Load trained model from disk
   *
   * @param path - File path to load the model from
   * @returns Promise that resolves when model is loaded
   */
  loadModel(path: string): Promise<void>;

  // ============================================================================
  // Stats
  // ============================================================================

  /**
   * Get learning statistics and metadata
   *
   * @returns Current statistics of the learning backend
   */
  getStats(): LearningStats;

  /**
   * Reset learning state (clear samples, reset model)
   */
  reset(): void;
}

/**
 * Type guard to check if an object implements LearningBackend
 */
export function isLearningBackend(obj: any): obj is LearningBackend {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.enhance === 'function' &&
    typeof obj.addSample === 'function' &&
    typeof obj.train === 'function' &&
    typeof obj.clearSamples === 'function' &&
    typeof obj.saveModel === 'function' &&
    typeof obj.loadModel === 'function' &&
    typeof obj.getStats === 'function' &&
    typeof obj.reset === 'function'
  );
}
