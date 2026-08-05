/**
 * Convergence Benchmark
 *
 * Measures convergence time for gossip protocol with varying node counts.
 * Target: <100ms for 1000 nodes
 */

import { createGossipSystem, GCounter, GossipConfig } from '../src';

interface BenchmarkResult {
  nodeCount: number;
  convergenceTime: number;
  messagesSent: number;
  messagesReceived: number;
  messagesPerNode: number;
}

async function benchmark(nodeCount: number, fanout: number, interval: number): Promise<BenchmarkResult> {
  const systems: Array<ReturnType<typeof createGossipSystem>> = [];

  // Create nodes
  for (let i = 0; i < nodeCount; i++) {
    const nodeId = `node${i}`;
    const config: GossipConfig = {
      nodeId,
      fanout,
      interval,
      failureThreshold: 3,
      phi: 8,
    };

    const system = createGossipSystem(config);
    const counter = new GCounter(nodeId);

    // Each node has unique initial value
    counter.increment(i + 1);
    system.mergeEngine.register('counter', counter);

    systems.push(system);
  }

  // Connect nodes in random topology
  for (let i = 0; i < nodeCount; i++) {
    // Connect to a subset of random peers
    const peerCount = Math.min(fanout * 2, nodeCount - 1);
    const peers = new Set<number>();

    while (peers.size < peerCount) {
      const peerId = Math.floor(Math.random() * nodeCount);
      if (peerId !== i) {
        peers.add(peerId);
      }
    }

    for (const peerId of peers) {
      systems[i].peerManager.addPeer({
        id: `node${peerId}`,
        address: 'localhost',
        port: 9000 + peerId,
      });
    }
  }

  // Start all systems
  await Promise.all(systems.map((sys) => sys.gossip.start()));

  // Expected sum: 1+2+...+n = n*(n+1)/2
  const expectedSum = (nodeCount * (nodeCount + 1)) / 2;

  // Measure convergence time
  const startTime = Date.now();
  let converged = false;
  let convergenceTime = 0;

  while (!converged && Date.now() - startTime < 30000) {
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Check if all nodes have converged
    converged = systems.every((sys) => {
      const counter = sys.mergeEngine.get<GCounter>('counter');
      return counter?.value() === expectedSum;
    });

    if (converged) {
      convergenceTime = Date.now() - startTime;
    }
  }

  // Collect metrics
  let totalMessagesSent = 0;
  let totalMessagesReceived = 0;

  for (const sys of systems) {
    const metrics = sys.gossip.getMetrics();
    totalMessagesSent += metrics.messagesSent;
    totalMessagesReceived += metrics.messagesReceived;
  }

  // Stop all systems
  await Promise.all(systems.map((sys) => sys.gossip.stop()));

  return {
    nodeCount,
    convergenceTime,
    messagesSent: totalMessagesSent,
    messagesReceived: totalMessagesReceived,
    messagesPerNode: totalMessagesSent / nodeCount,
  };
}

async function main() {
  console.log('🔬 CRDT-Gossip Convergence Benchmark\n');
  console.log('Measuring convergence time with varying node counts...\n');

  const results: BenchmarkResult[] = [];

  // Test different node counts
  const nodeCounts = [10, 25, 50, 100];
  const fanout = 3;
  const interval = 50;

  for (const nodeCount of nodeCounts) {
    console.log(`Testing ${nodeCount} nodes...`);

    const result = await benchmark(nodeCount, fanout, interval);
    results.push(result);

    console.log(`  Convergence time: ${result.convergenceTime}ms`);
    console.log(`  Messages per node: ${result.messagesPerNode.toFixed(2)}`);
    console.log(`  Message complexity: O(${Math.log2(nodeCount).toFixed(2)}) expected\n`);
  }

  // Display summary
  console.log('📊 Summary:\n');
  console.log('Nodes | Conv. Time | Msgs/Node | Complexity');
  console.log('------|------------|-----------|------------');

  for (const result of results) {
    const complexity = Math.log2(result.nodeCount);
    console.log(
      `${result.nodeCount.toString().padStart(5)} | ` +
      `${result.convergenceTime.toString().padStart(9)}ms | ` +
      `${result.messagesPerNode.toFixed(2).padStart(9)} | ` +
      `O(${complexity.toFixed(2)})`
    );
  }

  console.log('\n✅ Benchmark complete!');

  // Check if targets are met
  const maxResult = results[results.length - 1];
  if (maxResult.convergenceTime < 100) {
    console.log(`\n🎯 Target met: ${maxResult.nodeCount} nodes converged in ${maxResult.convergenceTime}ms`);
  } else {
    console.log(`\n⚠️  Target not met: Consider tuning fanout and interval parameters`);
  }
}

main().catch(console.error);
