/**
 * Self-Improving Code Generation System
 *
 * Combines AgentBooster (352x faster code generation) with ReasoningBank
 * (adaptive learning) to create a system that learns from experience and
 * improves code generation over time.
 *
 * @module @agentic-flow/self-improving-codegen
 */

export { SelfImprovingCodegen } from './SelfImprovingCodegen.js';
export { TrajectoryManager } from './TrajectoryManager.js';
export { PatternLearner } from './PatternLearner.js';
export { CodeQualityAnalyzer } from './CodeQualityAnalyzer.js';

export type {
  CodeGenerationRequest,
  CodeGenerationResult,
  CodeContext,
  GenerationMetrics,
  Trajectory,
  TrajectoryMetrics,
  CodePattern,
  PatternMatch,
  QualityMetrics,
  LearningStats
} from './types.js';
