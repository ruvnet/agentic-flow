/**
 * Main orchestrator for self-improving code generation
 * Combines AgentBooster (fast generation) with ReasoningBank (learning)
 */

import type {
  CodeGenerationRequest,
  CodeGenerationResult,
  CodeContext,
  LearningStats
} from './types.js';
import { TrajectoryManager } from './TrajectoryManager.js';
import { PatternLearner } from './PatternLearner.js';
import { CodeQualityAnalyzer } from './CodeQualityAnalyzer.js';

export interface SelfImprovingCodegenConfig {
  /** Enable learning from trajectories */
  enableLearning?: boolean;
  /** Minimum confidence to accept generation */
  minConfidence?: number;
  /** Maximum patterns to search */
  maxPatterns?: number;
  /** Enable pattern caching */
  enableCache?: boolean;
}

export class SelfImprovingCodegen {
  private trajectoryManager: TrajectoryManager;
  private patternLearner: PatternLearner;
  private qualityAnalyzer: CodeQualityAnalyzer;
  private config: Required<SelfImprovingCodegenConfig>;
  private agentBooster: any; // Will be loaded dynamically

  constructor(config: SelfImprovingCodegenConfig = {}) {
    this.config = {
      enableLearning: config.enableLearning ?? true,
      minConfidence: config.minConfidence ?? 0.5,
      maxPatterns: config.maxPatterns ?? 10,
      enableCache: config.enableCache ?? true
    };

    this.trajectoryManager = new TrajectoryManager();
    this.patternLearner = new PatternLearner();
    this.qualityAnalyzer = new CodeQualityAnalyzer();
  }

  /**
   * Initialize the system (loads AgentBooster)
   */
  async initialize(): Promise<void> {
    try {
      // Dynamically import AgentBooster
      const { AgentBooster } = await import('agent-booster');
      this.agentBooster = new AgentBooster({
        confidenceThreshold: this.config.minConfidence
      });
    } catch (error) {
      throw new Error(`Failed to initialize AgentBooster: ${error}`);
    }
  }

  /**
   * Generate code with learning from past attempts
   */
  async generateCode(
    request: CodeGenerationRequest,
    context?: CodeContext
  ): Promise<CodeGenerationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Query similar patterns from past successes
      const similarPatterns = await this.patternLearner.findSimilarPatterns(
        request.prompt,
        request.language,
        this.config.maxPatterns
      );

      // Step 2: Generate code using AgentBooster with learned patterns
      let generatedCode: string;
      let confidence: number;
      let strategy: string;

      if (!this.agentBooster) {
        await this.initialize();
      }

      // If we have learned patterns and existing code, use them
      if (similarPatterns.length > 0 && request.existingCode) {
        const bestPattern = similarPatterns[0];
        const result = await this.agentBooster.apply({
          code: request.existingCode,
          edit: bestPattern.pattern.template,
          language: request.language
        });

        generatedCode = result.output;
        confidence = result.confidence * bestPattern.similarity;
        strategy = `pattern-${bestPattern.pattern.name}`;
      } else {
        // Generate from scratch using prompt
        // For now, use a simple template-based approach
        generatedCode = this.generateFromPrompt(request.prompt, request.language);
        confidence = 0.7; // Base confidence for new patterns
        strategy = 'template-generation';
      }

      // Step 3: Analyze code quality
      const qualityMetrics = await this.qualityAnalyzer.analyzeCode(
        generatedCode,
        request.language
      );

      const latency = Date.now() - startTime;

      const result: CodeGenerationResult = {
        code: generatedCode,
        success: qualityMetrics.syntaxValid && confidence >= this.config.minConfidence,
        confidence,
        latency,
        strategy,
        metrics: {
          linesOfCode: generatedCode.split('\n').length,
          complexity: qualityMetrics.complexity,
          entities: this.countEntities(generatedCode, request.language),
          syntaxValid: qualityMetrics.syntaxValid,
          qualityScore: this.calculateQualityScore(qualityMetrics)
        },
        patternsApplied: similarPatterns.map(p => p.pattern.name)
      };

      // Step 4: Store trajectory for learning (if enabled)
      if (this.config.enableLearning) {
        await this.trajectoryManager.storeTrajectory({
          request,
          result,
          metrics: {
            latency,
            confidence,
            quality: qualityMetrics,
            compilationSuccess: qualityMetrics.syntaxValid
          }
        });
      }

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        code: '',
        success: false,
        confidence: 0,
        latency,
        strategy: 'error',
        metrics: {
          linesOfCode: 0,
          complexity: 0,
          entities: 0,
          syntaxValid: false,
          qualityScore: 0
        },
        patternsApplied: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Improve existing code with learned patterns
   */
  async improveCode(
    existingCode: string,
    feedback: string,
    language: string
  ): Promise<CodeGenerationResult> {
    return this.generateCode(
      {
        prompt: feedback,
        language,
        existingCode
      }
    );
  }

  /**
   * Learn from a trajectory (manual feedback)
   */
  async learnFromTrajectory(
    task: string,
    code: string,
    success: boolean,
    metrics: any
  ): Promise<void> {
    await this.trajectoryManager.recordManualFeedback({
      task,
      code,
      success,
      metrics
    });

    // Trigger pattern learning if we have enough trajectories
    const stats = await this.trajectoryManager.getStats();
    if (stats.totalTrajectories % 10 === 0) {
      await this.patternLearner.learnPatternsFromTrajectories(
        await this.trajectoryManager.getRecentTrajectories(100)
      );
    }
  }

  /**
   * Query best practices for a task type
   */
  async queryBestPractices(taskType: string, language: string): Promise<any[]> {
    return this.patternLearner.getBestPractices(taskType, language);
  }

  /**
   * Get learning statistics
   */
  async getStats(): Promise<LearningStats> {
    return this.trajectoryManager.getStats();
  }

  /**
   * Simple code generation from prompt (fallback)
   */
  private generateFromPrompt(prompt: string, language: string): string {
    // This is a simple template-based generation
    // In production, this would use more sophisticated techniques
    const templates: Record<string, (prompt: string) => string> = {
      typescript: (p) => `// Generated code for: ${p}\nexport function generated() {\n  // TODO: Implement\n}`,
      javascript: (p) => `// Generated code for: ${p}\nfunction generated() {\n  // TODO: Implement\n}\n\nmodule.exports = { generated };`,
      python: (p) => `# Generated code for: ${p}\ndef generated():\n    # TODO: Implement\n    pass`,
      rust: (p) => `// Generated code for: ${p}\npub fn generated() {\n    // TODO: Implement\n}`
    };

    const generator = templates[language.toLowerCase()] || templates.typescript;
    return generator(prompt);
  }

  /**
   * Count code entities (functions, classes, etc.)
   */
  private countEntities(code: string, language: string): number {
    const patterns = {
      typescript: /(?:function|class|interface|type|const\s+\w+\s*=\s*(?:async\s+)?\()/g,
      javascript: /(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?\()/g,
      python: /(?:def|class)\s+\w+/g,
      rust: /(?:fn|struct|enum|trait|impl)\s+\w+/g
    };

    const pattern = patterns[language.toLowerCase() as keyof typeof patterns];
    if (!pattern) return 1;

    const matches = code.match(pattern);
    return matches ? matches.length : 1;
  }

  /**
   * Calculate overall quality score from metrics
   */
  private calculateQualityScore(metrics: any): number {
    if (!metrics.syntaxValid) return 0;

    let score = 0.5; // Base score for valid syntax

    // Lower complexity is better
    if (metrics.complexity < 10) score += 0.2;
    else if (metrics.complexity < 20) score += 0.1;

    // Higher maintainability is better
    if (metrics.maintainability > 70) score += 0.2;
    else if (metrics.maintainability > 50) score += 0.1;

    // Security and best practices
    score += metrics.securityScore * 0.1;
    score += metrics.bestPractices * 0.1;

    return Math.min(score, 1.0);
  }
}
