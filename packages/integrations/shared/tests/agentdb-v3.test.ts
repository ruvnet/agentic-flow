/**
 * AgentDBBridge against the real agentdb 3.x package (no mocks).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { AgentDBBridge } from '../src/bridges/AgentDBBridge.js';

const require = createRequire(import.meta.url);

describe('AgentDBBridge on agentdb 3.x (real import)', () => {
  let bridge: AgentDBBridge | null = null;

  afterEach(async () => {
    await bridge?.close();
    bridge = null;
  });

  it('resolves agentdb 3.x', async () => {
    const pkg = require('agentdb/package.json');
    expect(Number(pkg.version.split('.')[0])).toBeGreaterThanOrEqual(3);
    const agentdb = await import('agentdb');
    expect(typeof agentdb.createDatabase).toBe('function');
    expect(typeof agentdb.WASMVectorSearch).toBe('function');
  });

  it('returns ranked hits with metadata from exact search', async () => {
    bridge = new AgentDBBridge({ dbPath: ':memory:', enableHNSW: false, maxRetries: 1 });
    await bridge.initialize();
    const a = await bridge.insert({ vector: [1, 0, 0, 0], metadata: { name: 'a' } });
    const b = await bridge.insert({ vector: [0, 1, 0, 0], metadata: { name: 'b' } });
    expect(a.success && b.success).toBe(true);

    const res = await bridge.search({ query: [0.9, 0.1, 0, 0], k: 2 });
    expect(res.success).toBe(true);
    expect(res.data!.map((r) => r.id)).toEqual([a.data, b.data]);
    expect(res.data![0].metadata).toEqual({ name: 'a' });
    expect(res.data![0].similarity).toBeGreaterThan(res.data![1].similarity);
  });

  it('filters by namespace column', async () => {
    bridge = new AgentDBBridge({ dbPath: ':memory:', enableHNSW: false, maxRetries: 1 });
    await bridge.initialize();
    await bridge.insert({ vector: [1, 0, 0, 0], metadata: { n: 1 }, namespace: 'x' });
    const y = await bridge.insert({ vector: [1, 0, 0, 0], metadata: { n: 2 }, namespace: 'y' });

    const res = await bridge.search({ query: [1, 0, 0, 0], k: 5, namespace: 'y' });
    expect(res.success).toBe(true);
    expect(res.data!.map((r) => r.id)).toEqual([y.data]);
  });

  it('rejects filter fields that are not columns', async () => {
    bridge = new AgentDBBridge({ dbPath: ':memory:', enableHNSW: false, maxRetries: 1 });
    await bridge.initialize();
    await expect(
      bridge.search({ query: [1, 0, 0, 0], k: 1, filters: { 'metadata.type': 'x' } })
    ).rejects.toThrow(/Unsupported filter field/);
  });

  it('uses HNSW when vectorDimension is set (falls back to exact without hnswlib)', async () => {
    bridge = new AgentDBBridge({ dbPath: ':memory:', vectorDimension: 4, maxRetries: 1 });
    await bridge.initialize();
    const a = await bridge.insert({ vector: [1, 0, 0, 0], metadata: { name: 'a' } });
    await bridge.insert({ vector: [0, 0, 1, 0], metadata: { name: 'c' } });

    const first = await bridge.search({ query: [1, 0.05, 0, 0], k: 1 });
    expect(first.success).toBe(true);
    expect(first.data![0].id).toBe(a.data);

    // inserted after the index is built: must still be findable
    const d = await bridge.insert({ vector: [0, 0, 0, 1], metadata: { name: 'd' } });
    const second = await bridge.search({ query: [0, 0, 0, 1], k: 1 });
    expect(second.data![0].id).toBe(d.data);
    expect(second.data![0].metadata).toEqual({ name: 'd' });
  });
});
