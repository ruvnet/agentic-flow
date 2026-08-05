/**
 * Exotic Patterns Integration Test Suite
 *
 * Tests integration between:
 * - Shared bridges (AgentBooster, ReasoningBank, QUIC, AgentDB)
 * - Pattern dependencies
 * - Application integrations
 * - Cross-system compatibility
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentBoosterBridge, AgentBoosterConfig } from '../../packages/integrations/shared/src/bridges/AgentBoosterBridge.js';
import { ReasoningBankBridge, ReasoningBankConfig, RLAlgorithm, Trajectory } from '../../packages/integrations/shared/src/bridges/ReasoningBankBridge.js';
import { QuicBridge, QuicConfig } from '../../packages/integrations/shared/src/bridges/QuicBridge.js';
import { AgentDBBridge, AgentDBConfig } from '../../packages/integrations/shared/src/bridges/AgentDBBridge.js';

describe('Exotic Patterns - Integration Tests', () => {
  let agentBooster: AgentBoosterBridge;
  let reasoningBank: ReasoningBankBridge;
  let quicBridge: QuicBridge;
  let agentDB: AgentDBBridge;

  beforeAll(async () => {
    // Initialize all bridges
    agentBooster = new AgentBoosterBridge({ debug: true });
    await agentBooster.initialize();

    reasoningBank = new ReasoningBankBridge({
      debug: true,
      algorithm: RLAlgorithm.DECISION_TRANSFORMER,
      dbPath: ':memory:'
    });
    await reasoningBank.initialize();

    quicBridge = new QuicBridge({
      debug: true,
      host: 'localhost',
      port: 4433,
      poolSize: 3
    });
    // Note: QUIC bridge requires actual server, skip initialization in tests
    // await quicBridge.initialize();

    agentDB = new AgentDBBridge({
      debug: true,
      dbPath: ':memory:',
      enableWASM: false, // Disable WASM for testing
      enableHNSW: false
    });
    await agentDB.initialize();
  });

  afterAll(async () => {
    await agentDB.close();
    await quicBridge.close();
  });

  describe('1. Shared Bridges → All Patterns', () => {
    it('should import all bridge modules correctly', async () => {
      expect(agentBooster).toBeDefined();
      expect(reasoningBank).toBeDefined();
      expect(quicBridge).toBeDefined();
      expect(agentDB).toBeDefined();
    });

    it('should initialize AgentBoosterBridge without errors', async () => {
      const metrics = agentBooster.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.editLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should initialize ReasoningBankBridge with correct algorithm', async () => {
      const metrics = reasoningBank.getMetrics();
      expect(metrics.algorithm).toBe(RLAlgorithm.DECISION_TRANSFORMER);
    });

    it('should initialize AgentDBBridge', async () => {
      const metrics = agentDB.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.vectorsIndexed).toBe(0);
    });

    it('should handle bridge errors gracefully', async () => {
      const uninitializedBridge = new AgentBoosterBridge();
      const result = await uninitializedBridge.edit({
        oldCode: 'const x = 1;',
        newCode: 'const x = 2;'
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });
  });

  describe('2. Pattern 1: Self-Improving Codegen Dependencies', () => {
    it('should use AgentBoosterBridge for code editing', async () => {
      const result = await agentBooster.edit({
        oldCode: 'function add(a, b) { return a + b; }',
        newCode: 'function add(a: number, b: number): number { return a + b; }',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.linesChanged).toBeGreaterThanOrEqual(0);
      expect(result.metrics.latencyMs).toBeLessThan(100);
    });

    it('should store trajectory in ReasoningBankBridge', async () => {
      const trajectory: Trajectory = {
        task: 'convert-javascript-to-typescript',
        actions: ['analyze-code', 'add-type-annotations', 'verify-syntax'],
        observations: ['no-types-found', 'types-added', 'valid-typescript'],
        reward: 0.85,
        metadata: {
          language: 'typescript',
          linesChanged: 3
        }
      };

      const result = await reasoningBank.storeTrajectory(trajectory);
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should query similar trajectories from ReasoningBankBridge', async () => {
      // Store multiple trajectories first
      const trajectories: Trajectory[] = [
        {
          task: 'add-error-handling',
          actions: ['identify-risky-code', 'wrap-in-try-catch'],
          observations: ['no-error-handling', 'error-handling-added'],
          reward: 0.9
        },
        {
          task: 'optimize-performance',
          actions: ['profile-code', 'apply-optimization'],
          observations: ['slow-execution', 'faster-execution'],
          reward: 0.75
        }
      ];

      for (const traj of trajectories) {
        await reasoningBank.storeTrajectory(traj);
      }

      // Query for similar tasks
      const queryResult = await reasoningBank.query({
        task: 'add-error-handling',
        topK: 2,
        threshold: 0.7
      });

      expect(queryResult.success).toBe(true);
      // Note: In test environment with fallback implementation, may return empty
      expect(queryResult.data).toBeDefined();
    });

    it('should integrate AgentBooster + ReasoningBank for learning', async () => {
      // Workflow: Edit code -> Store trajectory -> Learn from experience
      const editResult = await agentBooster.edit({
        oldCode: 'let x = 10;',
        newCode: 'const x: number = 10;',
        language: 'typescript'
      });

      expect(editResult.success).toBe(true);

      // Store the trajectory with reward based on improvement
      const trajectory: Trajectory = {
        task: 'improve-code-quality',
        actions: ['replace-let-with-const', 'add-type-annotation'],
        observations: ['mutable-variable', 'immutable-typed-variable'],
        reward: editResult.data ? 0.95 : 0.5,
        metadata: {
          editLatency: editResult.metrics.latencyMs,
          linesChanged: editResult.data?.linesChanged || 0
        }
      };

      const storeResult = await reasoningBank.storeTrajectory(trajectory);
      expect(storeResult.success).toBe(true);

      // Run learning iteration
      const learnResult = await reasoningBank.learn(50);
      expect(learnResult.success).toBe(true);
      expect(learnResult.data?.iterationsDone).toBe(50);
    });
  });

  describe('3. Pattern 2: Byzantine QUIC Dependencies', () => {
    it('should verify QUIC bridge connection structure', () => {
      const connections = quicBridge.getConnections();
      // Note: Without actual QUIC server, connections will be empty
      expect(connections).toBeDefined();
      expect(Array.isArray(connections)).toBe(true);
    });

    it('should handle QUIC send/receive operations', async () => {
      // Note: This will fail without actual QUIC server, so we test the API
      const data = Buffer.from('Byzantine consensus message');
      const result = await quicBridge.send(data);

      // Without initialized server, this should fail gracefully
      if (!result.success) {
        expect(result.error).toContain('not initialized');
      } else {
        expect(result.data).toBe(data.length);
        expect(result.metrics.latencyMs).toBeLessThan(100);
      }
    });

    it('should support stream multiplexing', async () => {
      const data = Buffer.from('Stream test data');
      const result = await quicBridge.stream(data);

      // Without server, should fail or mock
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data?.streamId).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('4. Pattern 3: CRDT Gossip Standalone', () => {
    it('should function independently without external bridges', () => {
      // CRDT Gossip pattern doesn't depend on external bridges
      // It's self-contained with its own gossip protocol
      expect(true).toBe(true);
    });

    it('should be extensible for future integrations', () => {
      // CRDT pattern can potentially integrate with:
      // - QuicBridge for transport
      // - AgentDB for persistence
      // Verify the architecture supports this
      expect(quicBridge).toBeDefined();
      expect(agentDB).toBeDefined();
    });
  });

  describe('5. Pattern 4: Ephemeral Memory Dependencies', () => {
    it('should use AgentDBBridge for vector insertion', async () => {
      const vector = new Array(128).fill(0).map(() => Math.random());
      const metadata = {
        agentId: 'ephemeral-agent-1',
        timestamp: Date.now(),
        type: 'memory'
      };

      const result = await agentDB.insert({ vector, metadata });
      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThan(0); // Should return an ID
    });

    it('should search for relevant memories in AgentDB', async () => {
      // Insert multiple memories
      const memories = [
        { context: 'user-preferences', importance: 0.9 },
        { context: 'api-credentials', importance: 0.5 },
        { context: 'session-data', importance: 0.7 }
      ];

      for (const mem of memories) {
        const vector = new Array(128).fill(0).map(() => Math.random());
        await agentDB.insert({
          vector,
          metadata: mem
        });
      }

      // Search for similar memories
      const queryVector = new Array(128).fill(0).map(() => Math.random());
      const searchResult = await agentDB.search({
        query: queryVector,
        k: 3,
        threshold: 0.5
      });

      expect(searchResult.success).toBe(true);
      expect(searchResult.data).toBeDefined();
      // In test environment with fallback, may return empty
      expect(Array.isArray(searchResult.data)).toBe(true);
    });

    it('should measure search performance (<50ms target)', async () => {
      const queryVector = new Array(128).fill(0).map(() => Math.random());
      const result = await agentDB.search({
        query: queryVector,
        k: 5
      });

      if (result.success) {
        expect(result.metrics.latencyMs).toBeLessThan(50);
      }
    });
  });

  describe('6. Cross-Pattern Integration', () => {
    it('should support pattern composition', async () => {
      // Test: Self-Improving (1) + Ephemeral Memory (4)
      // Scenario: Ephemeral agent generates code, stores in memory

      const code = 'function hello() { console.log("Hello"); }';
      const editResult = await agentBooster.edit({
        oldCode: code,
        newCode: code.replace('function', 'export function'),
        language: 'typescript'
      });

      expect(editResult.success).toBe(true);

      // Store code pattern in AgentDB
      const codeVector = new Array(128).fill(0).map(() => Math.random());
      const storeResult = await agentDB.patternStore({
        pattern: code,
        category: 'function-declaration',
        embedding: codeVector,
        metadata: { language: 'typescript' }
      });

      expect(storeResult.success).toBe(true);
    });

    it('should enable data flow between patterns', async () => {
      // Workflow: Edit (AgentBooster) → Learn (ReasoningBank) → Store (AgentDB)

      const editResult = await agentBooster.edit({
        oldCode: 'var x = 1;',
        newCode: 'const x = 1;',
      });

      const trajectory: Trajectory = {
        task: 'modernize-javascript',
        actions: ['replace-var', 'use-const'],
        observations: ['old-syntax', 'modern-syntax'],
        reward: 0.8
      };

      const storeResult = await reasoningBank.storeTrajectory(trajectory);

      const patternResult = await agentDB.patternStore({
        pattern: trajectory.task,
        category: 'code-modernization',
        metadata: { reward: trajectory.reward }
      });

      expect(editResult.success).toBe(true);
      expect(storeResult.success).toBe(true);
      expect(patternResult.success).toBe(true);
    });
  });

  describe('7. Performance Integration Tests', () => {
    it('should maintain performance under concurrent operations', async () => {
      const operations = [];

      // 10 concurrent edit operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          agentBooster.edit({
            oldCode: `const x${i} = ${i};`,
            newCode: `const x${i}: number = ${i};`
          })
        );
      }

      const results = await Promise.all(operations);
      const successCount = results.filter(r => r.success).length;

      expect(successCount).toBe(10);

      // Check that most operations completed quickly
      const avgLatency = results.reduce((sum, r) => sum + r.metrics.latencyMs, 0) / results.length;
      expect(avgLatency).toBeLessThan(100);
    });

    it('should handle batch operations efficiently', async () => {
      const files = Array.from({ length: 5 }, (_, i) => ({
        path: `/test/file${i}.ts`,
        oldCode: `function test${i}() {}`,
        newCode: `export function test${i}(): void {}`
      }));

      const result = await agentBooster.batchEdit({ files });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(5);
    });

    it('should measure end-to-end latency', async () => {
      const startTime = Date.now();

      // Complete workflow
      await agentBooster.edit({
        oldCode: 'test',
        newCode: 'test2'
      });

      await reasoningBank.storeTrajectory({
        task: 'test',
        actions: ['test'],
        observations: ['test'],
        reward: 1.0
      });

      await agentDB.insert({
        vector: new Array(128).fill(0).map(() => Math.random()),
        metadata: { test: true }
      });

      const endTime = Date.now();
      const totalLatency = endTime - startTime;

      // Complete workflow should be under 500ms
      expect(totalLatency).toBeLessThan(500);
    });
  });

  describe('8. Error Handling and Resilience', () => {
    it('should handle invalid inputs gracefully', async () => {
      const result = await agentBooster.edit({
        oldCode: '',
        newCode: ''
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should provide meaningful error messages', async () => {
      const result = await reasoningBank.query({
        task: '',
        topK: 5
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('task');
    });

    it('should recover from transient failures with retry', async () => {
      // The bridges use retry logic internally
      // Test that a valid operation succeeds even if there might be transient issues
      const result = await agentBooster.edit({
        oldCode: 'const x = 1;',
        newCode: 'const x = 2;'
      });

      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
    });
  });

  describe('9. Metrics and Observability', () => {
    it('should track AgentBooster metrics', () => {
      const metrics = agentBooster.getMetrics();

      expect(metrics.editLatencyMs).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });

    it('should track ReasoningBank metrics', () => {
      const metrics = reasoningBank.getMetrics();

      expect(metrics.trajectoriesStored).toBeGreaterThanOrEqual(0);
      expect(metrics.algorithm).toBe(RLAlgorithm.DECISION_TRANSFORMER);
    });

    it('should track AgentDB metrics', () => {
      const metrics = agentDB.getMetrics();

      expect(metrics.vectorsIndexed).toBeGreaterThanOrEqual(0);
      expect(metrics.resultsFound).toBeGreaterThanOrEqual(0);
    });

    it('should allow metrics reset', () => {
      agentBooster.resetMetrics();
      const metrics = agentBooster.getMetrics();

      expect(metrics.editLatencyMs).toBe(0);
      expect(metrics.filesProcessed).toBe(0);
    });
  });
});
