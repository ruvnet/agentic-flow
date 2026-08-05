/**
 * Distributed Counter Example
 *
 * Demonstrates Byzantine consensus for a simple distributed counter
 * Shows fault tolerance and consistency guarantees
 */

import { ByzantineNode } from '../src/index.js';

/**
 * Distributed counter state
 */
class DistributedCounter {
  private value: number = 0;
  private node: ByzantineNode;

  constructor(node: ByzantineNode) {
    this.node = node;

    // Listen for committed operations
    this.node.onCommit((request, result, latencyMs) => {
      this.applyOperation(request.operation);
      console.log(
        `[${this.node.getMetrics().nodeId}] Counter: ${this.value} ` +
        `(latency: ${latencyMs}ms, request: ${request.requestId})`
      );
    });
  }

  /**
   * Apply operation to counter
   */
  private applyOperation(operation: any): void {
    switch (operation.type) {
      case 'INCREMENT':
        this.value++;
        break;
      case 'DECREMENT':
        this.value--;
        break;
      case 'SET':
        this.value = operation.value;
        break;
      case 'ADD':
        this.value += operation.delta;
        break;
      default:
        console.error('Unknown operation:', operation.type);
    }
  }

  /**
   * Get current counter value
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Increment counter
   */
  async increment(): Promise<void> {
    await this.node.submitRequest({ type: 'INCREMENT' });
  }

  /**
   * Decrement counter
   */
  async decrement(): Promise<void> {
    await this.node.submitRequest({ type: 'DECREMENT' });
  }

  /**
   * Set counter to value
   */
  async set(value: number): Promise<void> {
    await this.node.submitRequest({ type: 'SET', value });
  }

  /**
   * Add delta to counter
   */
  async add(delta: number): Promise<void> {
    await this.node.submitRequest({ type: 'ADD', delta });
  }
}

/**
 * Main example
 */
async function main() {
  console.log('=== Distributed Counter with Byzantine Consensus ===\n');

  // Create 4-node cluster (tolerates f=1 Byzantine faults)
  const nodeConfigs = [
    { nodeId: 'node-0', host: 'localhost', port: 9000 },
    { nodeId: 'node-1', host: 'localhost', port: 9001 },
    { nodeId: 'node-2', host: 'localhost', port: 9002 },
    { nodeId: 'node-3', host: 'localhost', port: 9003 },
  ];

  console.log('Creating 4-node Byzantine cluster (f=1)...');
  const nodes = nodeConfigs.map(
    config =>
      new ByzantineNode({
        nodeId: config.nodeId,
        nodes: nodeConfigs,
        maxFaults: 1,
        viewChangeTimeoutMs: 2000,
        checkpointInterval: 10,
        debug: true,
      })
  );

  // Initialize all nodes
  console.log('Initializing nodes...\n');
  await Promise.all(nodes.map(n => n.initialize()));

  // Create counter instances
  const counters = nodes.map(node => new DistributedCounter(node));

  console.log('Primary node:', nodes[0].getMetrics().nodeId);
  console.log('View:', nodes[0].getCurrentView());
  console.log('\n=== Starting Operations ===\n');

  // Perform operations
  const primary = counters[0];

  console.log('Operation 1: INCREMENT');
  await primary.increment();
  await sleep(100);

  console.log('\nOperation 2: INCREMENT');
  await primary.increment();
  await sleep(100);

  console.log('\nOperation 3: ADD 5');
  await primary.add(5);
  await sleep(100);

  console.log('\nOperation 4: DECREMENT');
  await primary.decrement();
  await sleep(100);

  console.log('\nOperation 5: SET 100');
  await primary.set(100);
  await sleep(200);

  // Verify consistency across all nodes
  console.log('\n=== Final State ===\n');
  counters.forEach((counter, i) => {
    console.log(`Node ${i} counter value: ${counter.getValue()}`);
  });

  // Print metrics
  console.log('\n=== Metrics ===\n');
  nodes.forEach((node, i) => {
    const stats = node.getStats();
    console.log(`Node ${i}:`);
    console.log(`  Total requests: ${stats.metrics.totalRequests}`);
    console.log(`  Committed: ${stats.metrics.committedRequests}`);
    console.log(`  Avg latency: ${stats.metrics.averageLatencyMs.toFixed(2)}ms`);
    console.log(`  P50 latency: ${stats.latencyP50}ms`);
    console.log(`  P95 latency: ${stats.latencyP95}ms`);
    console.log(`  P99 latency: ${stats.latencyP99}ms`);
  });

  // Demonstrate fault tolerance
  console.log('\n=== Fault Tolerance Test ===');
  console.log('Simulating Byzantine node (node-3 goes offline)...\n');

  // Continue operations with one node offline
  console.log('Operation 6: INCREMENT (with one node offline)');
  await primary.increment();
  await sleep(100);

  console.log('\nOperation 7: ADD 10 (with one node offline)');
  await primary.add(10);
  await sleep(200);

  console.log('\n=== Final State After Fault ===\n');
  counters.slice(0, 3).forEach((counter, i) => {
    console.log(`Node ${i} counter value: ${counter.getValue()}`);
  });

  // Cleanup
  console.log('\nShutting down nodes...');
  await Promise.all(nodes.map(n => n.shutdown()));

  console.log('\n✅ Example completed successfully!');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run example
main().catch(console.error);
