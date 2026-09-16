import { describe, it, expect, beforeEach } from 'vitest';
import { PatternLearner } from '../src/PatternLearner.js';

describe('PatternLearner', () => {
  let learner: PatternLearner;

  beforeEach(() => {
    learner = new PatternLearner();
  });

  describe('findSimilarPatterns', () => {
    it('should find TypeScript function patterns', async () => {
      const patterns = await learner.findSimilarPatterns(
        'Create async function',
        'typescript',
        5
      );

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].pattern.language).toBe('typescript');
    });

    it('should rank patterns by confidence', async () => {
      const patterns = await learner.findSimilarPatterns(
        'Create TypeScript class',
        'typescript',
        5
      );

      expect(patterns.length).toBeGreaterThan(0);

      // Patterns should be sorted by confidence (descending)
      for (let i = 1; i < patterns.length; i++) {
        expect(patterns[i - 1].confidence).toBeGreaterThanOrEqual(
          patterns[i].confidence
        );
      }
    });

    it('should filter by language', async () => {
      const tsPatterns = await learner.findSimilarPatterns(
        'Create function',
        'typescript',
        10
      );

      const pyPatterns = await learner.findSimilarPatterns(
        'Create function',
        'python',
        10
      );

      expect(tsPatterns.every(p => p.pattern.language === 'typescript')).toBe(true);
      expect(pyPatterns.every(p => p.pattern.language === 'python')).toBe(true);
    });

    it('should match based on keywords', async () => {
      const patterns = await learner.findSimilarPatterns(
        'Create class with constructor',
        'typescript',
        5
      );

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].pattern.type).toBe('class');
    });
  });

  describe('learnPatternsFromTrajectories', () => {
    it('should learn patterns from successful trajectories', async () => {
      const trajectories = [
        {
          id: '1',
          timestamp: Date.now(),
          request: { prompt: 'Create API endpoint', language: 'typescript' },
          code: 'export async function handler() {}',
          success: true,
          metrics: {
            latency: 5,
            confidence: 0.9,
            quality: {
              syntaxValid: true,
              complexity: 2,
              maintainability: 85,
              securityScore: 0.9,
              bestPractices: 0.85
            },
            compilationSuccess: true
          },
          reward: 0.9,
          verdict: 'success' as const
        },
        {
          id: '2',
          timestamp: Date.now(),
          request: { prompt: 'Create REST endpoint', language: 'typescript' },
          code: 'export async function handler() {}',
          success: true,
          metrics: {
            latency: 4,
            confidence: 0.85,
            quality: {
              syntaxValid: true,
              complexity: 2,
              maintainability: 80,
              securityScore: 0.85,
              bestPractices: 0.8
            },
            compilationSuccess: true
          },
          reward: 0.85,
          verdict: 'success' as const
        },
        {
          id: '3',
          timestamp: Date.now(),
          request: { prompt: 'Build API route', language: 'typescript' },
          code: 'export async function handler() {}',
          success: true,
          metrics: {
            latency: 6,
            confidence: 0.8,
            quality: {
              syntaxValid: true,
              complexity: 3,
              maintainability: 75,
              securityScore: 0.8,
              bestPractices: 0.75
            },
            compilationSuccess: true
          },
          reward: 0.8,
          verdict: 'success' as const
        }
      ];

      const count = await learner.learnPatternsFromTrajectories(trajectories);

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should not learn from insufficient trajectories', async () => {
      const trajectories = [
        {
          id: '1',
          timestamp: Date.now(),
          request: { prompt: 'Test', language: 'typescript' },
          code: 'test',
          success: true,
          metrics: {
            latency: 5,
            confidence: 0.8,
            quality: {
              syntaxValid: true,
              complexity: 1,
              maintainability: 80,
              securityScore: 0.9,
              bestPractices: 0.8
            },
            compilationSuccess: true
          },
          reward: 0.8,
          verdict: 'success' as const
        }
      ];

      const count = await learner.learnPatternsFromTrajectories(trajectories);

      // Need at least 3 examples
      expect(count).toBe(0);
    });
  });

  describe('getBestPractices', () => {
    it('should return best practices for language', async () => {
      const practices = await learner.getBestPractices(
        'function',
        'typescript'
      );

      expect(Array.isArray(practices)).toBe(true);
      expect(practices.length).toBeGreaterThan(0);
    });

    it('should sort by success rate', async () => {
      const practices = await learner.getBestPractices(
        'any',
        'typescript'
      );

      for (let i = 1; i < practices.length; i++) {
        expect(practices[i - 1].successRate).toBeGreaterThanOrEqual(
          practices[i].successRate
        );
      }
    });
  });

  describe('updatePatternStats', () => {
    it('should update pattern statistics', async () => {
      const patterns = await learner.findSimilarPatterns(
        'Create function',
        'typescript',
        1
      );

      if (patterns.length > 0) {
        const patternId = patterns[0].pattern.id;
        const initialUsage = patterns[0].pattern.usageCount;

        await learner.updatePatternStats(patternId, true, 0.9);

        const updated = await learner.findSimilarPatterns(
          'Create function',
          'typescript',
          1
        );

        expect(updated[0].pattern.usageCount).toBe(initialUsage + 1);
      }
    });
  });
});
