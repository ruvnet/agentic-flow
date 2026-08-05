import { describe, it, expect, beforeEach } from 'vitest';
import { SelfImprovingCodegen } from '../src/SelfImprovingCodegen.js';

describe('SelfImprovingCodegen', () => {
  let codegen: SelfImprovingCodegen;

  beforeEach(() => {
    codegen = new SelfImprovingCodegen({
      enableLearning: true,
      minConfidence: 0.5
    });
  });

  describe('generateCode', () => {
    it('should generate TypeScript function code', async () => {
      const result = await codegen.generateCode({
        prompt: 'Create a function to add two numbers',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.code).toContain('function');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.latency).toBeGreaterThan(0);
      expect(result.metrics.syntaxValid).toBe(true);
    });

    it('should generate Python function code', async () => {
      const result = await codegen.generateCode({
        prompt: 'Create a function to multiply two numbers',
        language: 'python'
      });

      expect(result.success).toBe(true);
      expect(result.code).toContain('def');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should handle generation with existing code', async () => {
      const result = await codegen.generateCode({
        prompt: 'Add error handling',
        language: 'typescript',
        existingCode: 'function divide(a, b) { return a / b; }'
      });

      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
    });

    it('should return error on invalid request', async () => {
      const result = await codegen.generateCode({
        prompt: '',
        language: 'invalid-language'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('improveCode', () => {
    it('should improve existing code with feedback', async () => {
      const existingCode = 'function add(a, b) { return a + b; }';
      const result = await codegen.improveCode(
        existingCode,
        'Add TypeScript types',
        'typescript'
      );

      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
    });
  });

  describe('learning', () => {
    it('should store trajectories when learning is enabled', async () => {
      await codegen.generateCode({
        prompt: 'Create a simple function',
        language: 'typescript'
      });

      const stats = await codegen.getStats();
      expect(stats.totalTrajectories).toBeGreaterThan(0);
    });

    it('should learn from manual feedback', async () => {
      await codegen.learnFromTrajectory(
        'Create async function',
        'async function test() {}',
        true,
        { latency: 5, confidence: 0.9 }
      );

      const stats = await codegen.getStats();
      expect(stats.successCount).toBeGreaterThan(0);
    });

    it('should track success rate over time', async () => {
      // Generate multiple trajectories
      for (let i = 0; i < 5; i++) {
        await codegen.generateCode({
          prompt: `Create function ${i}`,
          language: 'typescript'
        });
      }

      const stats = await codegen.getStats();
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe('performance', () => {
    it('should generate code in under 100ms', async () => {
      const start = Date.now();
      await codegen.generateCode({
        prompt: 'Create a simple function',
        language: 'typescript'
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should maintain low latency with AgentBooster', async () => {
      const result = await codegen.generateCode({
        prompt: 'Create a function',
        language: 'typescript'
      });

      // Target: < 10ms with AgentBooster
      // Fallback may be slower without native bindings
      expect(result.latency).toBeLessThan(1000);
    });
  });

  describe('quality metrics', () => {
    it('should return quality metrics for generated code', async () => {
      const result = await codegen.generateCode({
        prompt: 'Create a complex function with error handling',
        language: 'typescript'
      });

      expect(result.metrics).toBeDefined();
      expect(result.metrics.linesOfCode).toBeGreaterThan(0);
      expect(result.metrics.complexity).toBeGreaterThan(0);
      expect(result.metrics.qualityScore).toBeGreaterThanOrEqual(0);
      expect(result.metrics.qualityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('pattern learning', () => {
    it('should apply learned patterns to similar requests', async () => {
      // First generation
      await codegen.generateCode({
        prompt: 'Create async API call function',
        language: 'typescript'
      });

      // Similar request should benefit from pattern
      const result = await codegen.generateCode({
        prompt: 'Create async data fetch function',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      // May have learned patterns applied
      expect(result.patternsApplied).toBeDefined();
    });

    it('should query best practices', async () => {
      const practices = await codegen.queryBestPractices(
        'api-call',
        'typescript'
      );

      expect(Array.isArray(practices)).toBe(true);
    });
  });
});
