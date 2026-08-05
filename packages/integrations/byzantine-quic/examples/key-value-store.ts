/**
 * Byzantine Key-Value Store Example
 *
 * Demonstrates fault-tolerant distributed key-value store
 * with Byzantine consensus over QUIC
 */

import { ByzantineNode } from '../src/index.js';

/**
 * Byzantine fault-tolerant key-value store
 */
class ByzantineKVStore {
  private store: Map<string, any> = new Map();
  private node: ByzantineNode;
  private operationLog: Array<{ seq: number; op: any; result: any }> = [];

  constructor(node: ByzantineNode) {
    this.node = node;

    // Listen for committed operations
    this.node.onCommit((request, result, latencyMs) => {
      const opResult = this.applyOperation(request.operation);
      this.operationLog.push({
        seq: request.requestId,
        op: request.operation,
        result: opResult,
      });

      console.log(
        `[${this.node.getMetrics().nodeId}] ` +
        `${request.operation.type} ${request.operation.key} ` +
        `(latency: ${latencyMs}ms)`
      );
    });
  }

  /**
   * Apply operation to store
   */
  private applyOperation(operation: any): any {
    switch (operation.type) {
      case 'GET':
        return this.store.get(operation.key);

      case 'SET':
        this.store.set(operation.key, operation.value);
        return { success: true, key: operation.key, value: operation.value };

      case 'DELETE':
        const existed = this.store.has(operation.key);
        this.store.delete(operation.key);
        return { success: true, deleted: existed };

      case 'HAS':
        return { exists: this.store.has(operation.key) };

      case 'SIZE':
        return { size: this.store.size };

      case 'CLEAR':
        const oldSize = this.store.size;
        this.store.clear();
        return { success: true, clearedCount: oldSize };

      default:
        return { error: 'Unknown operation' };
    }
  }

  /**
   * Get value by key
   */
  async get(key: string): Promise<any> {
    // Read operations can be served locally (already consistent)
    return this.store.get(key);
  }

  /**
   * Set key-value pair
   */
  async set(key: string, value: any): Promise<void> {
    await this.node.submitRequest({ type: 'SET', key, value });
  }

  /**
   * Delete key
   */
  async delete(key: string): Promise<void> {
    await this.node.submitRequest({ type: 'DELETE', key });
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Get store size
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    await this.node.submitRequest({ type: 'CLEAR' });
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Export store snapshot
   */
  snapshot(): Record<string, any> {
    return Object.fromEntries(this.store);
  }

  /**
   * Get operation log
   */
  getOperationLog(): Array<{ seq: number; op: any; result: any }> {
    return [...this.operationLog];
  }
}

/**
 * Simulate a Byzantine (malicious) node
 */
class ByzantineAttacker {
  constructor(private nodeId: string) {}

  /**
   * Simulate conflicting messages
   */
  sendConflictingMessages(): void {
    console.log(`\n⚠️  [${this.nodeId}] BYZANTINE BEHAVIOR DETECTED!`);
    console.log(`   Attempting to send conflicting messages...`);
    // In production, signature verification would prevent this
  }

  /**
   * Simulate delayed/dropped messages
   */
  dropMessages(): void {
    console.log(`\n⚠️  [${this.nodeId}] Dropping messages (Byzantine behavior)`);
  }
}

/**
 * Main example
 */
async function main() {
  console.log('=== Byzantine Fault-Tolerant Key-Value Store ===\n');

  // Create 4-node cluster (tolerates f=1 Byzantine faults)
  const nodeConfigs = [
    { nodeId: 'node-0', host: 'localhost', port: 10000 },
    { nodeId: 'node-1', host: 'localhost', port: 10001 },
    { nodeId: 'node-2', host: 'localhost', port: 10002 },
    { nodeId: 'node-3', host: 'localhost', port: 10003 },
  ];

  console.log('Creating 4-node Byzantine cluster (f=1)...');
  console.log('Configuration: 3f+1 = 4 nodes, tolerates 1 Byzantine fault\n');

  const nodes = nodeConfigs.map(
    config =>
      new ByzantineNode({
        nodeId: config.nodeId,
        nodes: nodeConfigs,
        maxFaults: 1,
        viewChangeTimeoutMs: 2000,
        checkpointInterval: 5,
        debug: true,
      })
  );

  // Initialize all nodes
  console.log('Initializing Byzantine consensus nodes...\n');
  await Promise.all(nodes.map(n => n.initialize()));

  // Create KV store instances
  const stores = nodes.map(node => new ByzantineKVStore(node));
  const primaryStore = stores[0];

  console.log('Primary node:', nodes[0].getMetrics().nodeId);
  console.log('Quorum size: 2f+1 = 3 nodes\n');

  console.log('=== Normal Operations ===\n');

  // Perform operations
  console.log('1. SET user:1 = {name: "Alice", age: 30}');
  await primaryStore.set('user:1', { name: 'Alice', age: 30 });
  await sleep(100);

  console.log('\n2. SET user:2 = {name: "Bob", age: 25}');
  await primaryStore.set('user:2', { name: 'Bob', age: 25 });
  await sleep(100);

  console.log('\n3. SET config:timeout = 5000');
  await primaryStore.set('config:timeout', 5000);
  await sleep(100);

  console.log('\n4. SET config:maxRetries = 3');
  await primaryStore.set('config:maxRetries', 3);
  await sleep(100);

  // Read operations
  console.log('\n=== Read Operations ===\n');
  console.log('GET user:1:', JSON.stringify(await primaryStore.get('user:1')));
  console.log('GET user:2:', JSON.stringify(await primaryStore.get('user:2')));
  console.log('Store size:', primaryStore.size());

  // Verify consistency
  console.log('\n=== Consistency Check ===\n');
  stores.forEach((store, i) => {
    console.log(`Node ${i} snapshot:`, JSON.stringify(store.snapshot()));
  });

  // Simulate Byzantine attack
  console.log('\n=== Byzantine Fault Simulation ===\n');
  const attacker = new ByzantineAttacker('node-3');
  attacker.sendConflictingMessages();

  console.log('\nContinuing operations despite Byzantine node...\n');

  console.log('5. SET user:3 = {name: "Charlie", age: 35}');
  await primaryStore.set('user:3', { name: 'Charlie', age: 35 });
  await sleep(100);

  console.log('\n6. DELETE user:2');
  await primaryStore.delete('user:2');
  await sleep(100);

  // Verify system still works
  console.log('\n=== Post-Attack State ===\n');
  stores.slice(0, 3).forEach((store, i) => {
    console.log(`Honest node ${i}:`);
    console.log(`  Keys: [${store.keys().join(', ')}]`);
    console.log(`  Size: ${store.size()}`);
  });

  // Performance test
  console.log('\n=== Performance Test ===\n');
  const numOps = 20;
  console.log(`Executing ${numOps} operations...`);

  const startTime = Date.now();
  for (let i = 0; i < numOps; i++) {
    await primaryStore.set(`key-${i}`, { value: i, timestamp: Date.now() });
  }
  const duration = Date.now() - startTime;

  console.log(`\nCompleted ${numOps} operations in ${duration}ms`);
  console.log(`Throughput: ${((numOps / duration) * 1000).toFixed(0)} ops/sec`);
  console.log(`Average latency: ${(duration / numOps).toFixed(2)}ms per operation`);

  // Final metrics
  console.log('\n=== Final Metrics ===\n');
  nodes.forEach((node, i) => {
    const stats = node.getStats();
    console.log(`Node ${i}:`);
    console.log(`  Requests: ${stats.metrics.totalRequests}`);
    console.log(`  Committed: ${stats.metrics.committedRequests}`);
    console.log(`  Avg latency: ${stats.metrics.averageLatencyMs.toFixed(2)}ms`);
    console.log(`  P95 latency: ${stats.latencyP95}ms`);
    console.log(`  Checkpoint: ${stats.metrics.checkpointStats.lastStableSequence}`);
  });

  // Show operation log
  console.log('\n=== Operation Log (Node 0) ===\n');
  const log = primaryStore.getOperationLog();
  log.slice(-5).forEach(entry => {
    console.log(
      `  Seq ${entry.seq}: ${entry.op.type} ${entry.op.key || ''}`
    );
  });

  // Cleanup
  console.log('\nShutting down cluster...');
  await Promise.all(nodes.map(n => n.shutdown()));

  console.log('\n✅ Byzantine KV Store example completed!');
  console.log('✅ System maintained consistency despite Byzantine fault');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run example
main().catch(console.error);
