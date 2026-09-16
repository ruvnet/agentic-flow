/**
 * Tests for AgentLifecycleManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentLifecycleManager } from '../src/AgentLifecycleManager.js';

describe('AgentLifecycleManager', () => {
  let lifecycle: AgentLifecycleManager;

  beforeEach(() => {
    lifecycle = new AgentLifecycleManager({
      defaultTTL: 1000, // 1 second for testing
      checkInterval: 100,
      enableAutoCleanup: true
    });
  });

  afterEach(async () => {
    await lifecycle.shutdown();
  });

  describe('Agent Registration', () => {
    it('should register a new agent', () => {
      const agent = lifecycle.registerAgent('agent1', 'test-type', 'tenant1');

      expect(agent.id).toBe('agent1');
      expect(agent.type).toBe('test-type');
      expect(agent.tenantId).toBe('tenant1');
      expect(agent.status).toBe('spawning');
    });

    it('should set correct expiration time', () => {
      const before = Date.now();
      const agent = lifecycle.registerAgent('agent1', 'test-type', 'tenant1', { ttl: 5000 });
      const after = Date.now();

      expect(agent.expiresAt).toBeGreaterThanOrEqual(before + 5000);
      expect(agent.expiresAt).toBeLessThanOrEqual(after + 5000);
    });

    it('should emit spawned event', (done) => {
      lifecycle.on('spawned', (event) => {
        expect(event.agentId).toBe('agent1');
        done();
      });

      lifecycle.registerAgent('agent1', 'test-type', 'tenant1');
    });
  });

  describe('Agent Activation', () => {
    it('should activate a spawning agent', () => {
      lifecycle.registerAgent('agent1', 'test-type', 'tenant1');
      lifecycle.activateAgent('agent1');

      const agent = lifecycle.getAgent('agent1');
      expect(agent?.status).toBe('active');
    });

    it('should throw error for non-existent agent', () => {
      expect(() => lifecycle.activateAgent('non-existent')).toThrow();
    });
  });

  describe('Agent Queries', () => {
    beforeEach(() => {
      lifecycle.registerAgent('agent1', 'type1', 'tenant1');
      lifecycle.registerAgent('agent2', 'type1', 'tenant1');
      lifecycle.registerAgent('agent3', 'type2', 'tenant2');
      lifecycle.activateAgent('agent1');
      lifecycle.activateAgent('agent2');
      lifecycle.activateAgent('agent3');
    });

    it('should get agent by ID', () => {
      const agent = lifecycle.getAgent('agent1');
      expect(agent?.id).toBe('agent1');
    });

    it('should check if agent is alive', () => {
      expect(lifecycle.isAlive('agent1')).toBe(true);
      expect(lifecycle.isAlive('non-existent')).toBe(false);
    });

    it('should get active agents', () => {
      const active = lifecycle.getActiveAgents();
      expect(active).toHaveLength(3);
    });

    it('should get agents by type', () => {
      const byType = lifecycle.getAgentsByType('type1');
      expect(byType).toHaveLength(2);
    });

    it('should get agents by tenant', () => {
      const byTenant = lifecycle.getAgentsByTenant('tenant1');
      expect(byTenant).toHaveLength(2);
    });
  });

  describe('Lifetime Management', () => {
    it('should get remaining lifetime', () => {
      const agent = lifecycle.registerAgent('agent1', 'test-type', 'tenant1', { ttl: 5000 });

      const remaining = lifecycle.getRemainingLifetime('agent1');
      expect(remaining).toBeGreaterThan(4000);
      expect(remaining).toBeLessThanOrEqual(5000);
    });

    it('should extend agent lifetime', () => {
      lifecycle.registerAgent('agent1', 'test-type', 'tenant1', { ttl: 1000 });

      const before = lifecycle.getRemainingLifetime('agent1');
      lifecycle.extendLifetime('agent1', 5000);
      const after = lifecycle.getRemainingLifetime('agent1');

      expect(after).toBeGreaterThan(before);
      expect(after - before).toBeCloseTo(5000, -2); // Within 100ms
    });
  });

  describe('Agent Termination', () => {
    it('should terminate agent manually', async () => {
      lifecycle.registerAgent('agent1', 'test-type', 'tenant1');
      lifecycle.activateAgent('agent1');

      await lifecycle.terminateAgent('agent1', 'manual');

      const agent = lifecycle.getAgent('agent1');
      expect(agent).toBeUndefined();
    });

    it('should emit terminating and terminated events', async () => {
      const events: string[] = [];

      lifecycle.on('terminating', () => events.push('terminating'));
      lifecycle.on('terminated', () => events.push('terminated'));

      lifecycle.registerAgent('agent1', 'test-type', 'tenant1');
      lifecycle.activateAgent('agent1');

      await lifecycle.terminateAgent('agent1');

      expect(events).toEqual(['terminating', 'terminated']);
    });

    it('should auto-terminate expired agents', async () => {
      lifecycle.registerAgent('agent1', 'test-type', 'tenant1', { ttl: 100 });
      lifecycle.activateAgent('agent1');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 200));

      const agent = lifecycle.getAgent('agent1');
      expect(agent).toBeUndefined();
    });
  });

  describe('Resource Tracking', () => {
    it('should update resource usage', () => {
      lifecycle.registerAgent('agent1', 'test-type', 'tenant1');
      lifecycle.activateAgent('agent1');

      lifecycle.updateResourceUsage('agent1', {
        cpuPercent: 50,
        memoryMB: 100,
        uptime: 1000,
        taskCount: 5
      });

      const agent = lifecycle.getAgent('agent1');
      expect(agent?.resourceUsage.cpuPercent).toBe(50);
      expect(agent?.resourceUsage.memoryMB).toBe(100);
      expect(agent?.resourceUsage.taskCount).toBe(5);
    });
  });

  describe('Statistics', () => {
    it('should return lifecycle statistics', () => {
      lifecycle.registerAgent('agent1', 'type1', 'tenant1');
      lifecycle.registerAgent('agent2', 'type1', 'tenant1');
      lifecycle.activateAgent('agent1');
      lifecycle.activateAgent('agent2');

      const stats = lifecycle.getStats();

      expect(stats.totalAgents).toBe(2);
      expect(stats.activeAgents).toBe(2);
      expect(stats.spawningAgents).toBe(0);
    });
  });
});
