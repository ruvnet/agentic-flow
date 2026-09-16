import { describe, it, expect, beforeEach } from 'vitest';
import { TrajectoryManager } from '../src/TrajectoryManager.js';

describe('TrajectoryManager', () => {
  let manager: TrajectoryManager;

  beforeEach(() => {
    manager = new TrajectoryManager();
  });

  describe('storeTrajectory', () => {
    it('should store a trajectory and return ID', async () => {
      const id = await manager.storeTrajectory({
        request: {
          prompt: 'Test prompt',
          language: 'typescript'
        },
        result: {
          code: 'function test() {}',
          success: true,
          confidence: 0.8
        },
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
        }
      });

      expect(id).toBeDefined();
      expect(id).toContain('traj_');
    });

    it('should calculate reward based on metrics', async () => {
      await manager.storeTrajectory({
        request: { prompt: 'Test', language: 'typescript' },
        result: { code: 'test', success: true, confidence: 0.9 },
        metrics: {
          latency: 2,
          confidence: 0.9,
          quality: {
            syntaxValid: true,
            complexity: 5,
            maintainability: 90,
            securityScore: 1.0,
            bestPractices: 0.9
          },
          compilationSuccess: true,
          testPassRate: 1.0
        }
      });

      const stats = await manager.getStats();
      expect(stats.totalTrajectories).toBe(1);
    });
  });

  describe('getRecentTrajectories', () => {
    it('should return recent trajectories', async () => {
      // Store multiple trajectories
      for (let i = 0; i < 5; i++) {
        await manager.storeTrajectory({
          request: { prompt: `Test ${i}`, language: 'typescript' },
          result: { code: `code ${i}`, success: true, confidence: 0.8 },
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
          }
        });
      }

      const recent = await manager.getRecentTrajectories(3);
      expect(recent.length).toBe(3);
    });

    it('should return trajectories in reverse chronological order', async () => {
      await manager.storeTrajectory({
        request: { prompt: 'First', language: 'typescript' },
        result: { code: 'code1', success: true, confidence: 0.8 },
        metrics: {
          latency: 5, confidence: 0.8,
          quality: { syntaxValid: true, complexity: 1, maintainability: 80, securityScore: 0.9, bestPractices: 0.8 },
          compilationSuccess: true
        }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.storeTrajectory({
        request: { prompt: 'Second', language: 'typescript' },
        result: { code: 'code2', success: true, confidence: 0.8 },
        metrics: {
          latency: 5, confidence: 0.8,
          quality: { syntaxValid: true, complexity: 1, maintainability: 80, securityScore: 0.9, bestPractices: 0.8 },
          compilationSuccess: true
        }
      });

      const recent = await manager.getRecentTrajectories(2);
      expect(recent[0].request.prompt).toBe('Second');
      expect(recent[1].request.prompt).toBe('First');
    });
  });

  describe('searchSimilar', () => {
    beforeEach(async () => {
      // Store some test trajectories
      await manager.storeTrajectory({
        request: { prompt: 'Create API endpoint', language: 'typescript' },
        result: { code: 'function api() {}', success: true, confidence: 0.8 },
        metrics: {
          latency: 5, confidence: 0.8,
          quality: { syntaxValid: true, complexity: 1, maintainability: 80, securityScore: 0.9, bestPractices: 0.8 },
          compilationSuccess: true
        }
      });

      await manager.storeTrajectory({
        request: { prompt: 'Build REST API', language: 'typescript' },
        result: { code: 'function rest() {}', success: true, confidence: 0.9 },
        metrics: {
          latency: 4, confidence: 0.9,
          quality: { syntaxValid: true, complexity: 2, maintainability: 85, securityScore: 0.95, bestPractices: 0.9 },
          compilationSuccess: true
        }
      });
    });

    it('should find similar trajectories', async () => {
      const similar = await manager.searchSimilar(
        'Create REST endpoint',
        'typescript',
        5
      );

      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].success).toBe(true);
    });

    it('should filter by language', async () => {
      await manager.storeTrajectory({
        request: { prompt: 'Create API endpoint', language: 'python' },
        result: { code: 'def api(): pass', success: true, confidence: 0.8 },
        metrics: {
          latency: 5, confidence: 0.8,
          quality: { syntaxValid: true, complexity: 1, maintainability: 80, securityScore: 0.9, bestPractices: 0.8 },
          compilationSuccess: true
        }
      });

      const tsResults = await manager.searchSimilar('API', 'typescript', 10);
      const pyResults = await manager.searchSimilar('API', 'python', 10);

      expect(tsResults.every(t => t.request.language === 'typescript')).toBe(true);
      expect(pyResults.every(t => t.request.language === 'python')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      const stats = await manager.getStats();

      expect(stats).toHaveProperty('totalTrajectories');
      expect(stats).toHaveProperty('successCount');
      expect(stats).toHaveProperty('failureCount');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('patternsLearned');
    });

    it('should calculate success rate correctly', async () => {
      // 3 successful, 2 failed
      for (let i = 0; i < 3; i++) {
        await manager.storeTrajectory({
          request: { prompt: 'Test', language: 'typescript' },
          result: { code: 'code', success: true, confidence: 0.8 },
          metrics: {
            latency: 5, confidence: 0.8,
            quality: { syntaxValid: true, complexity: 1, maintainability: 80, securityScore: 0.9, bestPractices: 0.8 },
            compilationSuccess: true
          }
        });
      }

      for (let i = 0; i < 2; i++) {
        await manager.storeTrajectory({
          request: { prompt: 'Test', language: 'typescript' },
          result: { code: '', success: false, confidence: 0.2 },
          metrics: {
            latency: 5, confidence: 0.2,
            quality: { syntaxValid: false, complexity: 0, maintainability: 0, securityScore: 0, bestPractices: 0 },
            compilationSuccess: false
          }
        });
      }

      const stats = await manager.getStats();
      expect(stats.totalTrajectories).toBe(5);
      expect(stats.successCount).toBe(3);
      expect(stats.failureCount).toBe(2);
      expect(stats.successRate).toBe(0.6);
    });
  });
});
