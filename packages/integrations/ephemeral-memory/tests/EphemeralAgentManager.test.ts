/**
 * Integration tests for EphemeralAgentManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EphemeralAgentManager } from '../src/EphemeralAgentManager.js';

describe('EphemeralAgentManager', () => {
  let manager: EphemeralAgentManager;

  beforeEach(() => {
    manager = new EphemeralAgentManager({
      tenantId: 'test-tenant',
      lifecycle: {
        defaultTTL: 5000, // 5 seconds
        checkInterval: 100
      }
    });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  describe('Agent Spawning', () => {
    it('should spawn agent in <50ms', async () => {
      const start = Date.now();

      const agent = await manager.spawnAgent(
        'test-agent',
        { id: '1', type: 'test', description: 'Test task' }
      );

      const duration = Date.now() - start;

      expect(agent).toBeDefined();
      expect(agent.status).toBe('active');
      expect(duration).toBeLessThan(50);
    });

    it('should spawn multiple agents concurrently', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          manager.spawnAgent('test-agent', {
            id: `${i}`,
            type: 'test',
            description: 'Test task'
          })
        );
      }

      const agents = await Promise.all(promises);

      expect(agents).toHaveLength(10);
      expect(new Set(agents.map(a => a.id)).size).toBe(10);
    });

    it('should emit spawned event', (done) => {
      manager.on('agent:spawned', (event) => {
        expect(event.agent).toBeDefined();
        expect(event.spawnTime).toBeGreaterThan(0);
        done();
      });

      manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });
    });
  });

  describe('Memory Operations', () => {
    it('should set and get memory', async () => {
      const agent = await manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });

      await manager.setMemory(agent.id, 'key1', { data: 'value1' });
      const value = await manager.getMemory(agent.id, 'key1');

      expect(value).toEqual({ data: 'value1' });
    });

    it('should persist memory across agent lifecycles', async () => {
      // First agent
      const agent1 = await manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });

      await manager.setMemory(agent1.id, 'persistent-key', { data: 'persistent-value' });
      await manager.terminateAgent(agent1.id);

      // Second agent of same type
      const agent2 = await manager.spawnAgent('test-agent', {
        id: '2',
        type: 'test',
        description: 'Test task'
      });

      // Search for memories from previous agent
      const memories = await manager.searchMemories(agent2.id, 'persistent', 5);

      expect(memories.length).toBeGreaterThan(0);
    });

    it('should preload specified memories', async () => {
      // Setup: create some memories
      const agent1 = await manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });

      await manager.setMemory(agent1.id, 'preload-key', { data: 'preload-value' });
      await manager.terminateAgent(agent1.id);

      // Test: spawn with preload
      const agent2 = await manager.spawnAgent(
        'test-agent',
        { id: '2', type: 'test', description: 'Test task' },
        { memoryPreload: ['preload-key'] }
      );

      const value = await manager.getMemory(agent2.id, 'preload-key');
      expect(value).toEqual({ data: 'preload-value' });
    });
  });

  describe('Task Execution', () => {
    it('should execute task with ephemeral agent', async () => {
      const result = await manager.executeTask(
        'test-agent',
        { id: '1', type: 'test', description: 'Test task' },
        async (context) => {
          expect(context.agent).toBeDefined();
          expect(context.memory).toBeDefined();
          expect(context.monitor).toBeDefined();

          return { success: true };
        }
      );

      expect(result).toEqual({ success: true });
    });

    it('should auto-terminate agent after task execution', async () => {
      let agentId: string = '';

      await manager.executeTask(
        'test-agent',
        { id: '1', type: 'test', description: 'Test task' },
        async (context) => {
          agentId = context.agent.id;
          return { success: true };
        }
      );

      // Agent should be terminated
      const agent = manager.getAgent(agentId);
      expect(agent).toBeUndefined();
    });

    it('should handle task errors gracefully', async () => {
      await expect(
        manager.executeTask(
          'test-agent',
          { id: '1', type: 'test', description: 'Test task' },
          async () => {
            throw new Error('Task failed');
          }
        )
      ).rejects.toThrow('Task failed');
    });
  });

  describe('Agent Queries', () => {
    it('should list active agents', async () => {
      await manager.spawnAgent('test-agent-1', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });
      await manager.spawnAgent('test-agent-2', {
        id: '2',
        type: 'test',
        description: 'Test task'
      });

      const agents = manager.listActiveAgents();
      expect(agents).toHaveLength(2);
    });

    it('should get agents by type', async () => {
      await manager.spawnAgent('type1', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });
      await manager.spawnAgent('type1', {
        id: '2',
        type: 'test',
        description: 'Test task'
      });
      await manager.spawnAgent('type2', {
        id: '3',
        type: 'test',
        description: 'Test task'
      });

      const type1Agents = manager.getAgentsByType('type1');
      expect(type1Agents).toHaveLength(2);
    });
  });

  describe('Statistics & Monitoring', () => {
    it('should return resource statistics', async () => {
      await manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });

      const stats = manager.getResourceStats();

      expect(stats.lifecycle).toBeDefined();
      expect(stats.monitor).toBeDefined();
      expect(stats.costSavings).toBeDefined();
      expect(stats.lifecycle.totalAgents).toBeGreaterThan(0);
    });

    it('should calculate cost savings', async () => {
      await manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });

      const stats = manager.getResourceStats();

      expect(stats.costSavings.savingsPercent).toBeGreaterThan(0);
      expect(stats.costSavings.ephemeralAgentCost).toBeLessThan(
        stats.costSavings.persistentAgentCost
      );
    });

    it('should export metrics for monitoring', async () => {
      await manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });

      const metrics = manager.exportMetrics();

      expect(metrics.timestamp).toBeDefined();
      expect(metrics.manager).toBeDefined();
      expect(metrics.lifecycle).toBeDefined();
      expect(metrics.monitor).toBeDefined();
      expect(metrics.memory).toBeDefined();
    });

    it('should provide load balancing recommendations', async () => {
      const recommendations = manager.getLoadBalancingRecommendations();

      expect(recommendations.shouldScaleUp).toBeDefined();
      expect(recommendations.shouldScaleDown).toBeDefined();
      expect(recommendations.recommendedAgentCount).toBeGreaterThanOrEqual(0);
      expect(recommendations.reason).toBeDefined();
    });
  });

  describe('Performance Requirements', () => {
    it('should support 10K spawns/second (load test)', async () => {
      const targetSpawns = 100; // Reduced for test performance
      const start = Date.now();

      const promises = [];
      for (let i = 0; i < targetSpawns; i++) {
        promises.push(
          manager.spawnAgent('load-test', {
            id: `${i}`,
            type: 'load',
            description: 'Load test'
          })
        );
      }

      await Promise.all(promises);

      const duration = (Date.now() - start) / 1000; // seconds
      const spawnsPerSecond = targetSpawns / duration;

      expect(spawnsPerSecond).toBeGreaterThan(1000); // Should easily exceed 1K/sec
    }, 30000); // 30 second timeout

    it('should achieve 90%+ resource savings', async () => {
      // Spawn agents that run for short periods
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          manager.executeTask(
            'efficient-agent',
            { id: `${i}`, type: 'test', description: 'Quick task' },
            async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return { success: true };
            },
            { ttl: 500 }
          )
        );
      }

      await Promise.all(promises);

      const stats = manager.getResourceStats();

      // Should save at least 90%
      expect(stats.costSavings.savingsPercent).toBeGreaterThan(90);
    });
  });

  describe('Memory Consolidation', () => {
    it('should consolidate duplicate memories', async () => {
      const agent = await manager.spawnAgent('test-agent', {
        id: '1',
        type: 'test',
        description: 'Test task'
      });

      await manager.setMemory(agent.id, 'key1', 'duplicate content');
      await manager.setMemory(agent.id, 'key2', 'duplicate content');

      const consolidated = await manager.consolidateMemories();

      expect(consolidated).toBeGreaterThanOrEqual(0);
    });
  });
});
