/**
 * Distributed Counter Example
 *
 * Demonstrates a grow-only counter (G-Counter) replicated across multiple nodes.
 * Each node can increment independently, and changes propagate via gossip.
 */

import { createGossipSystem, GCounter, GossipConfig } from '../src';

async function main() {
  console.log('🔢 Distributed Counter Example\n');

  // Create 3 nodes
  const nodes = ['alice', 'bob', 'charlie'];
  const systems: Array<ReturnType<typeof createGossipSystem>> = [];

  // Initialize gossip systems for each node
  for (const nodeId of nodes) {
    const config: GossipConfig = {
      nodeId,
      fanout: 2,
      interval: 100,
      failureThreshold: 3,
      phi: 8,
    };

    const system = createGossipSystem(config);

    // Register a counter CRDT
    const counter = new GCounter(nodeId);
    system.mergeEngine.register('likes', counter);

    systems.push(system);
  }

  // Connect nodes in a mesh topology
  for (let i = 0; i < systems.length; i++) {
    for (let j = 0; j < systems.length; j++) {
      if (i !== j) {
        systems[i].peerManager.addPeer({
          id: nodes[j],
          address: 'localhost',
          port: 9000 + j,
        });
      }
    }
  }

  // Start gossip protocols
  console.log('Starting gossip protocols...');
  await Promise.all(systems.map((sys) => sys.gossip.start()));

  // Simulate user interactions
  console.log('\n📊 Simulating user likes...\n');

  // Alice likes 5 times
  console.log('Alice: +5 likes');
  const aliceCounter = systems[0].mergeEngine.get<GCounter>('likes')!;
  aliceCounter.increment(5);
  systems[0].gossip.incrementClock();

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Bob likes 3 times
  console.log('Bob: +3 likes');
  const bobCounter = systems[1].mergeEngine.get<GCounter>('likes')!;
  bobCounter.increment(3);
  systems[1].gossip.incrementClock();

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Charlie likes 7 times
  console.log('Charlie: +7 likes');
  const charlieCounter = systems[2].mergeEngine.get<GCounter>('likes')!;
  charlieCounter.increment(7);
  systems[2].gossip.incrementClock();

  // Wait for convergence (gossip rounds)
  console.log('\n⏳ Waiting for gossip convergence...\n');
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Check final values
  console.log('📈 Final Counter Values:');
  for (let i = 0; i < systems.length; i++) {
    const counter = systems[i].mergeEngine.get<GCounter>('likes')!;
    const metrics = systems[i].gossip.getMetrics();
    console.log(`  ${nodes[i]}: ${counter.value()} likes (sent: ${metrics.messagesSent}, received: ${metrics.messagesReceived})`);
  }

  console.log(`\n✅ All nodes converged to: ${aliceCounter.value()} likes (5+3+7=15)\n`);

  // Stop gossip protocols
  await Promise.all(systems.map((sys) => sys.gossip.stop()));

  console.log('✨ Example complete!');
}

main().catch(console.error);
