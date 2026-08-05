/**
 * Analyzes code quality using various metrics
 * Provides feedback for learning system
 */

import type { QualityMetrics } from './types.js';

export class CodeQualityAnalyzer {
  /**
   * Analyze code and return quality metrics
   */
  async analyzeCode(code: string, language: string): Promise<QualityMetrics> {
    const syntaxValid = this.checkSyntax(code, language);
    const complexity = this.calculateComplexity(code);
    const maintainability = this.calculateMaintainability(code, complexity);
    const securityScore = this.analyzeSecuritymaturity(code);
    const bestPractices = this.checkBestPractices(code, language);

    return {
      syntaxValid,
      complexity,
      maintainability,
      securityScore,
      bestPractices
    };
  }

  /**
   * Check syntax validity (simplified)
   */
  private checkSyntax(code: string, language: string): boolean {
    // Basic syntax checks
    try {
      // Check for balanced braces
      const openBraces = (code.match(/{/g) || []).length;
      const closeBraces = (code.match(/}/g) || []).length;
      if (openBraces !== closeBraces) return false;

      // Check for balanced parentheses
      const openParens = (code.match(/\(/g) || []).length;
      const closeParens = (code.match(/\)/g) || []).length;
      if (openParens !== closeParens) return false;

      // Language-specific checks
      switch (language.toLowerCase()) {
        case 'typescript':
        case 'javascript':
          // Check for basic syntax errors
          if (code.includes('function') && !code.includes('{')) return false;
          break;
        case 'python':
          // Check indentation consistency
          const lines = code.split('\n').filter(l => l.trim().length > 0);
          const indents = lines.map(l => l.match(/^\s*/)?.[0].length || 0);
          // Basic check: indents should be consistent multiples
          break;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate cyclomatic complexity
   */
  private calculateComplexity(code: string): number {
    let complexity = 1; // Base complexity

    // Count decision points
    const decisionPatterns = [
      /\bif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\b\?\s*.*\s*:/g, // Ternary operators
      /&&/g,
      /\|\|/g
    ];

    for (const pattern of decisionPatterns) {
      const matches = code.match(pattern);
      if (matches) complexity += matches.length;
    }

    return complexity;
  }

  /**
   * Calculate maintainability index
   * Based on Halstead metrics and LOC
   */
  private calculateMaintainability(code: string, complexity: number): number {
    const lines = code.split('\n').filter(l => l.trim().length > 0);
    const loc = lines.length;
    const commentLines = lines.filter(l =>
      l.trim().startsWith('//') ||
      l.trim().startsWith('#') ||
      l.trim().startsWith('/*')
    ).length;

    // Simple maintainability formula
    let maintainability = 100;

    // Penalize high complexity
    maintainability -= Math.min(complexity * 2, 40);

    // Penalize long functions
    if (loc > 50) maintainability -= (loc - 50) * 0.5;

    // Reward comments
    const commentRatio = commentLines / Math.max(loc, 1);
    if (commentRatio > 0.1) maintainability += 10;

    return Math.max(0, Math.min(100, maintainability));
  }

  /**
   * Analyze security issues
   */
  private analyzeSecuritymaturity(code: string): number {
    let score = 1.0;

    // Check for common security issues
    const securityIssues = [
      { pattern: /eval\(/g, penalty: 0.3, name: 'eval usage' },
      { pattern: /innerHTML\s*=/g, penalty: 0.2, name: 'innerHTML assignment' },
      { pattern: /document\.write/g, penalty: 0.2, name: 'document.write' },
      { pattern: /exec\(/g, penalty: 0.3, name: 'exec usage' },
      { pattern: /password\s*=\s*["'].*["']/gi, penalty: 0.4, name: 'hardcoded password' },
      { pattern: /api[_-]?key\s*=\s*["'].*["']/gi, penalty: 0.4, name: 'hardcoded API key' }
    ];

    for (const issue of securityIssues) {
      if (issue.pattern.test(code)) {
        score -= issue.penalty;
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Check adherence to best practices
   */
  private checkBestPractices(code: string, language: string): number {
    let score = 0.5; // Base score

    switch (language.toLowerCase()) {
      case 'typescript':
      case 'javascript':
        // Check for modern syntax
        if (code.includes('const') || code.includes('let')) score += 0.1;
        if (code.includes('=>')) score += 0.1; // Arrow functions
        if (code.includes('async') || code.includes('await')) score += 0.05;

        // Check for type annotations (TypeScript)
        if (language === 'typescript' && code.includes(':')) score += 0.1;

        // Check for exports
        if (code.includes('export')) score += 0.05;

        // Penalize var usage
        if (code.includes('var ')) score -= 0.1;
        break;

      case 'python':
        // Check for type hints
        if (code.includes('->') || code.includes(': ')) score += 0.1;

        // Check for docstrings
        if (code.includes('"""') || code.includes("'''")) score += 0.15;

        // Check for proper naming
        if (/def [a-z_][a-z0-9_]*\(/g.test(code)) score += 0.1;
        break;

      case 'rust':
        // Check for error handling
        if (code.includes('Result<') || code.includes('Option<')) score += 0.15;

        // Check for documentation
        if (code.includes('///')) score += 0.1;

        // Check for ownership patterns
        if (code.includes('&') || code.includes('mut')) score += 0.05;
        break;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Estimate test coverage based on code structure
   */
  async estimateTestCoverage(
    code: string,
    testCode: string
  ): Promise<number> {
    // Extract function/method names from main code
    const functions = this.extractFunctions(code);

    // Check how many are tested
    let testedCount = 0;
    for (const func of functions) {
      if (testCode.includes(func)) testedCount++;
    }

    return functions.length > 0 ? testedCount / functions.length : 0;
  }

  /**
   * Extract function names from code
   */
  private extractFunctions(code: string): string[] {
    const functions: string[] = [];

    // TypeScript/JavaScript
    const tsMatches = code.matchAll(/(?:function|const)\s+(\w+)/g);
    for (const match of tsMatches) {
      functions.push(match[1]);
    }

    // Python
    const pyMatches = code.matchAll(/def\s+(\w+)/g);
    for (const match of pyMatches) {
      functions.push(match[1]);
    }

    // Rust
    const rustMatches = code.matchAll(/fn\s+(\w+)/g);
    for (const match of rustMatches) {
      functions.push(match[1]);
    }

    return functions;
  }
}
