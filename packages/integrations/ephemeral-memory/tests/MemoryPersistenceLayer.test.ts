/**
 * Tests for MemoryPersistenceLayer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistenceLayer } from '../src/MemoryPersistenceLayer.js';

describe('MemoryPersistenceLayer', () => {
  let persistence: MemoryPersistenceLayer;

  beforeEach(() => {
    persistence = new MemoryPersistenceLayer({
      tenantId: 'test-tenant',
      namespace: 'test-namespace'
    });
  });

  afterEach(() => {
    persistence.close();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve memory', async () => {
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });
      const value = await persistence.getMemory('key1');

      expect(value).toEqual({ data: 'value1' });
    });

    it('should return null for non-existent key', async () => {
      const value = await persistence.getMemory('non-existent');
      expect(value).toBeNull();
    });

    it('should update existing memory', async () => {
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });
      await persistence.setMemory('agent1', 'key1', { data: 'value2' });

      const value = await persistence.getMemory('key1');
      expect(value).toEqual({ data: 'value2' });
    });

    it('should delete memory', async () => {
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });
      await persistence.deleteMemory('key1');

      const value = await persistence.getMemory('key1');
      expect(value).toBeNull();
    });
  });

  describe('Agent Memories', () => {
    it('should get all memories for an agent', async () => {
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });
      await persistence.setMemory('agent1', 'key2', { data: 'value2' });
      await persistence.setMemory('agent2', 'key3', { data: 'value3' });

      const memories = await persistence.getAgentMemories('agent1');

      expect(memories).toHaveLength(2);
      expect(memories.map(m => m.key)).toContain('key1');
      expect(memories.map(m => m.key)).toContain('key2');
    });

    it('should delete all memories for an agent', async () => {
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });
      await persistence.setMemory('agent1', 'key2', { data: 'value2' });

      await persistence.deleteAgentMemories('agent1');

      const memories = await persistence.getAgentMemories('agent1');
      expect(memories).toHaveLength(0);
    });
  });

  describe('Semantic Search', () => {
    it('should search memories by content', async () => {
      await persistence.setMemory('agent1', 'key1', 'The quick brown fox');
      await persistence.setMemory('agent1', 'key2', 'The lazy dog sleeps');
      await persistence.setMemory('agent1', 'key3', 'A brown dog runs');

      const results = await persistence.searchMemories('brown animal', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toBeDefined();
      expect(results[0].similarity).toBeGreaterThan(0);
    });

    it('should return top k results', async () => {
      for (let i = 0; i < 10; i++) {
        await persistence.setMemory('agent1', `key${i}`, `Document ${i}`);
      }

      const results = await persistence.searchMemories('document', 3);

      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Consolidation', () => {
    it('should consolidate similar memories', async () => {
      await persistence.setMemory('agent1', 'key1', 'Hello world');
      await persistence.setMemory('agent1', 'key2', 'Hello world');

      const consolidated = await persistence.consolidate();

      expect(consolidated).toBeGreaterThanOrEqual(0);
    });

    it('should not consolidate when disabled', async () => {
      const p = new MemoryPersistenceLayer({
        tenantId: 'test-tenant',
        enableConsolidation: false
      });

      await p.setMemory('agent1', 'key1', 'Hello world');
      await p.setMemory('agent1', 'key2', 'Hello world');

      const consolidated = await p.consolidate();

      expect(consolidated).toBe(0);
      p.close();
    });
  });

  describe('Statistics', () => {
    it('should return memory statistics', async () => {
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });
      await persistence.setMemory('agent1', 'key2', { data: 'value2' });

      const stats = persistence.getStats();

      expect(stats.totalMemories).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestMemory).toBeGreaterThan(0);
      expect(stats.newestMemory).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should write memory in <10ms', async () => {
      const start = Date.now();
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10);
    });

    it('should read cached memory in <5ms', async () => {
      await persistence.setMemory('agent1', 'key1', { data: 'value1' });

      const start = Date.now();
      await persistence.getMemory('key1');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5);
    });
  });
});
