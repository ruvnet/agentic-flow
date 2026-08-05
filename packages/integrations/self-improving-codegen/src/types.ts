/**
 * Type definitions for self-improving code generation
 */

/**
 * Code generation request with context
 */
export interface CodeGenerationRequest {
  /** Natural language prompt describing what to generate */
  prompt: string;
  /** Programming language target */
  language: string;
  /** Optional existing code context */
  existingCode?: string;
  /** Optional framework/library context */
  framework?: string;
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
}

/**
 * Code generation result with metrics
 */
export interface CodeGenerationResult {
  /** Generated code */
  code: string;
  /** Whether generation succeeded */
  success: boolean;
  /** Confidence score (0-1) */
  confidence: number;
  /** Generation time in milliseconds */
  latency: number;
  /** Strategy used for generation */
  strategy: string;
  /** Quality metrics */
  metrics: GenerationMetrics;
  /** Learned patterns applied */
  patternsApplied: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Additional context for code generation
 */
export interface CodeContext {
  /** Project type (e.g., 'web-app', 'cli-tool', 'library') */
  projectType?: string;
  /** Dependencies in use */
  dependencies?: string[];
  /** Code style preferences */
  styleGuide?: Record<string, any>;
  /** Test framework in use */
  testFramework?: string;
}

/**
 * Metrics for code generation
 */
export interface GenerationMetrics {
  /** Lines of code generated */
  linesOfCode: number;
  /** Estimated complexity (cyclomatic) */
  complexity: number;
  /** Number of functions/classes */
  entities: number;
  /** Syntax validity */
  syntaxValid: boolean;
  /** Code quality score (0-1) */
  qualityScore: number;
}

/**
 * Trajectory of a code generation attempt
 */
export interface Trajectory {
  /** Unique trajectory ID */
  id: string;
  /** Timestamp */
  timestamp: number;
  /** Original request */
  request: CodeGenerationRequest;
  /** Generated code */
  code: string;
  /** Success/failure outcome */
  success: boolean;
  /** Metrics about the generation */
  metrics: TrajectoryMetrics;
  /** Reward signal (0-1, based on quality) */
  reward: number;
  /** Verdict: 'success', 'failure', 'partial' */
  verdict: 'success' | 'failure' | 'partial';
  /** User feedback if provided */
  feedback?: string;
}

/**
 * Metrics for trajectory analysis
 */
export interface TrajectoryMetrics {
  /** Generation latency */
  latency: number;
  /** Confidence score */
  confidence: number;
  /** Quality metrics */
  quality: QualityMetrics;
  /** Compilation/syntax check passed */
  compilationSuccess: boolean;
  /** Test pass rate if tests were run */
  testPassRate?: number;
}

/**
 * Code pattern learned from trajectories
 */
export interface CodePattern {
  /** Pattern ID */
  id: string;
  /** Pattern name/description */
  name: string;
  /** Language this pattern applies to */
  language: string;
  /** Pattern type (e.g., 'function', 'class', 'module') */
  type: string;
  /** Template or structure */
  template: string;
  /** Success rate of this pattern */
  successRate: number;
  /** Number of times used */
  usageCount: number;
  /** Average quality score */
  avgQuality: number;
  /** Conditions when this pattern works best */
  conditions: Record<string, any>;
}

/**
 * Pattern match result
 */
export interface PatternMatch {
  /** Matched pattern */
  pattern: CodePattern;
  /** Similarity score (0-1) */
  similarity: number;
  /** Confidence in applying this pattern */
  confidence: number;
}

/**
 * Quality metrics for code
 */
export interface QualityMetrics {
  /** Syntax validity */
  syntaxValid: boolean;
  /** Complexity score (0-100, lower is better) */
  complexity: number;
  /** Maintainability index (0-100, higher is better) */
  maintainability: number;
  /** Code coverage estimate if tests generated */
  testCoverage?: number;
  /** Security score (0-1) */
  securityScore: number;
  /** Best practices adherence (0-1) */
  bestPractices: number;
}

/**
 * Learning statistics
 */
export interface LearningStats {
  /** Total trajectories stored */
  totalTrajectories: number;
  /** Successful generations */
  successCount: number;
  /** Failed generations */
  failureCount: number;
  /** Overall success rate */
  successRate: number;
  /** Total patterns learned */
  patternsLearned: number;
  /** Average quality improvement over time */
  qualityImprovement: number;
  /** Average latency */
  avgLatency: number;
}
