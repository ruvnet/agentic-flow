/**
 * Learns patterns from successful code generations
 * Extracts reusable templates and best practices
 */

import type { CodePattern, PatternMatch, Trajectory } from './types.js';

export class PatternLearner {
  private patterns: Map<string, CodePattern> = new Map();
  private initialized = false;

  constructor() {
    // Initialize with some basic patterns
    this.initializeBasePatterns();
  }

  /**
   * Initialize with common patterns
   */
  private initializeBasePatterns(): void {
    const basePatterns: CodePattern[] = [
      {
        id: 'ts-function-basic',
        name: 'TypeScript Basic Function',
        language: 'typescript',
        type: 'function',
        template: 'export function ${name}(${params}): ${returnType} {\n  ${body}\n}',
        successRate: 0.8,
        usageCount: 0,
        avgQuality: 0.7,
        conditions: { hasExports: true }
      },
      {
        id: 'ts-async-function',
        name: 'TypeScript Async Function',
        language: 'typescript',
        type: 'function',
        template: 'export async function ${name}(${params}): Promise<${returnType}> {\n  ${body}\n}',
        successRate: 0.85,
        usageCount: 0,
        avgQuality: 0.75,
        conditions: { async: true }
      },
      {
        id: 'ts-class-basic',
        name: 'TypeScript Class',
        language: 'typescript',
        type: 'class',
        template: 'export class ${name} {\n  constructor(${params}) {\n    ${init}\n  }\n\n  ${methods}\n}',
        successRate: 0.75,
        usageCount: 0,
        avgQuality: 0.7,
        conditions: { hasClass: true }
      },
      {
        id: 'py-function-basic',
        name: 'Python Basic Function',
        language: 'python',
        type: 'function',
        template: 'def ${name}(${params}):\n    """${docstring}"""\n    ${body}',
        successRate: 0.8,
        usageCount: 0,
        avgQuality: 0.7,
        conditions: {}
      },
      {
        id: 'py-class-basic',
        name: 'Python Class',
        language: 'python',
        type: 'class',
        template: 'class ${name}:\n    """${docstring}"""\n    \n    def __init__(self, ${params}):\n        ${init}\n    \n    ${methods}',
        successRate: 0.75,
        usageCount: 0,
        avgQuality: 0.7,
        conditions: { hasClass: true }
      }
    ];

    basePatterns.forEach(pattern => {
      this.patterns.set(pattern.id, pattern);
    });
  }

  /**
   * Find patterns similar to a prompt
   */
  async findSimilarPatterns(
    prompt: string,
    language: string,
    limit: number = 5
  ): Promise<PatternMatch[]> {
    const promptLower = prompt.toLowerCase();
    const keywords = this.extractKeywords(promptLower);

    // Score each pattern
    const scored: PatternMatch[] = [];

    for (const pattern of this.patterns.values()) {
      if (pattern.language !== language) continue;

      const similarity = this.calculatePatternSimilarity(pattern, keywords, promptLower);

      if (similarity > 0.3) {
        scored.push({
          pattern,
          similarity,
          confidence: similarity * pattern.successRate
        });
      }
    }

    // Sort by confidence and return top matches
    return scored
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  /**
   * Learn patterns from successful trajectories
   */
  async learnPatternsFromTrajectories(trajectories: Trajectory[]): Promise<number> {
    let learnedCount = 0;

    // Group by language and type
    const groups = this.groupTrajectories(trajectories);

    for (const [key, trajs] of Object.entries(groups)) {
      if (trajs.length < 3) continue; // Need at least 3 examples

      const pattern = this.extractPattern(key, trajs);
      if (pattern) {
        this.patterns.set(pattern.id, pattern);
        learnedCount++;
      }
    }

    return learnedCount;
  }

  /**
   * Get best practices for a task type
   */
  async getBestPractices(taskType: string, language: string): Promise<CodePattern[]> {
    const practices: CodePattern[] = [];

    for (const pattern of this.patterns.values()) {
      if (pattern.language === language && pattern.successRate > 0.7) {
        practices.push(pattern);
      }
    }

    return practices.sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Update pattern statistics after use
   */
  async updatePatternStats(
    patternId: string,
    success: boolean,
    quality: number
  ): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.usageCount++;

    // Update success rate (exponential moving average)
    const alpha = 0.1;
    pattern.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * pattern.successRate;

    // Update average quality
    pattern.avgQuality = alpha * quality + (1 - alpha) * pattern.avgQuality;

    this.patterns.set(patternId, pattern);
  }

  /**
   * Extract keywords from prompt
   */
  private extractKeywords(prompt: string): Set<string> {
    const keywords = new Set<string>();

    // Technical keywords
    const technical = [
      'function', 'class', 'interface', 'type', 'async', 'await',
      'promise', 'callback', 'api', 'rest', 'graphql', 'database',
      'query', 'mutation', 'component', 'hook', 'service', 'controller',
      'model', 'view', 'handler', 'middleware', 'validator', 'parser',
      'generator', 'builder', 'factory', 'singleton', 'adapter'
    ];

    technical.forEach(term => {
      if (prompt.includes(term)) {
        keywords.add(term);
      }
    });

    return keywords;
  }

  /**
   * Calculate similarity between pattern and prompt
   */
  private calculatePatternSimilarity(
    pattern: CodePattern,
    keywords: Set<string>,
    prompt: string
  ): number {
    let score = 0;

    // Type matching
    if (keywords.has(pattern.type)) score += 0.4;

    // Name/description matching
    const patternWords = pattern.name.toLowerCase().split(/\s+/);
    const matchingWords = patternWords.filter(word => prompt.includes(word));
    score += (matchingWords.length / patternWords.length) * 0.3;

    // Keyword overlap
    const patternKeywords = this.extractKeywords(pattern.template.toLowerCase());
    const overlap = [...keywords].filter(k => patternKeywords.has(k)).length;
    score += (overlap / Math.max(keywords.size, 1)) * 0.3;

    return Math.min(score, 1.0);
  }

  /**
   * Group trajectories by language and pattern type
   */
  private groupTrajectories(
    trajectories: Trajectory[]
  ): Record<string, Trajectory[]> {
    const groups: Record<string, Trajectory[]> = {};

    for (const traj of trajectories) {
      if (!traj.success) continue;

      const type = this.detectCodeType(traj.code);
      const key = `${traj.request.language}:${type}`;

      if (!groups[key]) groups[key] = [];
      groups[key].push(traj);
    }

    return groups;
  }

  /**
   * Detect code type (function, class, etc.)
   */
  private detectCodeType(code: string): string {
    if (/class\s+\w+/.test(code)) return 'class';
    if (/interface\s+\w+/.test(code)) return 'interface';
    if (/type\s+\w+\s*=/.test(code)) return 'type';
    if (/(?:async\s+)?function\s+\w+/.test(code)) return 'function';
    if (/const\s+\w+\s*=\s*(?:async\s+)?\(/.test(code)) return 'function';
    return 'unknown';
  }

  /**
   * Extract pattern from similar trajectories
   */
  private extractPattern(key: string, trajectories: Trajectory[]): CodePattern | null {
    const [language, type] = key.split(':');

    // Calculate aggregate statistics
    const avgQuality = trajectories.reduce((sum, t) => sum + t.reward, 0) / trajectories.length;
    const successRate = trajectories.filter(t => t.verdict === 'success').length / trajectories.length;

    if (successRate < 0.5) return null; // Not successful enough

    // Extract common structure
    const template = this.extractCommonStructure(trajectories.map(t => t.code));

    return {
      id: `learned-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: `Learned ${type} pattern`,
      language,
      type,
      template,
      successRate,
      usageCount: trajectories.length,
      avgQuality,
      conditions: this.extractConditions(trajectories)
    };
  }

  /**
   * Extract common structure from code samples
   */
  private extractCommonStructure(codes: string[]): string {
    // Simplified: return the most common code pattern
    // In production, use AST-based analysis
    if (codes.length === 0) return '';

    // For now, return the shortest successful example as template
    return codes.reduce((shortest, code) =>
      code.length < shortest.length ? code : shortest
    );
  }

  /**
   * Extract conditions from trajectories
   */
  private extractConditions(trajectories: Trajectory[]): Record<string, any> {
    const conditions: Record<string, any> = {};

    // Analyze common attributes
    const hasAsync = trajectories.some(t => t.code.includes('async'));
    const hasExport = trajectories.some(t => t.code.includes('export'));
    const hasClass = trajectories.some(t => /class\s+\w+/.test(t.code));

    if (hasAsync) conditions.async = true;
    if (hasExport) conditions.hasExports = true;
    if (hasClass) conditions.hasClass = true;

    return conditions;
  }
}
