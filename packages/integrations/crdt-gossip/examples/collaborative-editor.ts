/**
 * Collaborative Text Editor Example
 *
 * Demonstrates RGA (Replicated Growable Array) for real-time collaborative editing.
 * Multiple users can edit a document simultaneously, and changes propagate via gossip.
 */

import { createGossipSystem, RGA, GossipConfig } from '../src';

async function main() {
  console.log('📝 Collaborative Text Editor Example\n');

  // Create 2 collaborators
  const editors = ['alice', 'bob'];
  const systems: Array<ReturnType<typeof createGossipSystem>> = [];

  // Initialize gossip systems
  for (const editorId of editors) {
    const config: GossipConfig = {
      nodeId: editorId,
      fanout: 1,
      interval: 100,
      failureThreshold: 3,
      phi: 8,
    };

    const system = createGossipSystem(config);

    // Register a text document CRDT
    const document = new RGA<string>(editorId);
    system.mergeEngine.register('document', document);

    systems.push(system);
  }

  // Connect editors
  systems[0].peerManager.addPeer({
    id: 'bob',
    address: 'localhost',
    port: 9001,
  });
  systems[1].peerManager.addPeer({
    id: 'alice',
    address: 'localhost',
    port: 9000,
  });

  // Start gossip
  console.log('Starting collaborative session...\n');
  await Promise.all(systems.map((sys) => sys.gossip.start()));

  // Alice types "Hello"
  console.log('Alice types: "Hello"');
  const aliceDoc = systems[0].mergeEngine.get<RGA<string>>('document')!;
  'Hello'.split('').forEach((char, i) => {
    aliceDoc.insert(i, char);
  });
  systems[0].gossip.incrementClock();

  // Wait for sync
  await new Promise((resolve) => setTimeout(resolve, 200));

  console.log(`Bob sees: "${systems[1].mergeEngine.get<RGA<string>>('document')!.toString()}"`);

  // Bob adds " World"
  console.log('\nBob adds: " World"');
  const bobDoc = systems[1].mergeEngine.get<RGA<string>>('document')!;
  ' World'.split('').forEach((char) => {
    bobDoc.insert(bobDoc.length(), char);
  });
  systems[1].gossip.incrementClock();

  // Wait for sync
  await new Promise((resolve) => setTimeout(resolve, 200));

  console.log(`Alice sees: "${systems[0].mergeEngine.get<RGA<string>>('document')!.toString()}"`);

  // Concurrent edits
  console.log('\n🔀 Concurrent edits:');

  // Alice inserts "!" at the end
  console.log('Alice adds: "!"');
  aliceDoc.insert(aliceDoc.length(), '!');
  systems[0].gossip.incrementClock();

  // Bob inserts " from Bob" before Alice's change propagates
  console.log('Bob adds: " from Bob"');
  ' from Bob'.split('').forEach((char) => {
    bobDoc.insert(bobDoc.length(), char);
  });
  systems[1].gossip.incrementClock();

  // Wait for convergence
  console.log('\n⏳ Waiting for convergence...\n');
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Check final state
  const finalAlice = systems[0].mergeEngine.get<RGA<string>>('document')!.toString();
  const finalBob = systems[1].mergeEngine.get<RGA<string>>('document')!.toString();

  console.log('📄 Final Document State:');
  console.log(`  Alice: "${finalAlice}"`);
  console.log(`  Bob: "${finalBob}"`);
  console.log(`  Converged: ${finalAlice === finalBob ? '✅' : '❌'}`);

  // Stop gossip
  await Promise.all(systems.map((sys) => sys.gossip.stop()));

  console.log('\n✨ Example complete!');
}

main().catch(console.error);
