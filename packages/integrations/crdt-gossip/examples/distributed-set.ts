/**
 * Distributed Set Example
 *
 * Demonstrates OR-Set (Observed-Remove Set) for managing a distributed set of items.
 * Shows add-wins semantics and concurrent operations.
 */

import { createGossipSystem, ORSet, GossipConfig } from '../src';

async function main() {
  console.log('🎯 Distributed Set Example (Shopping Cart)\n');

  // Create 3 nodes simulating a distributed shopping cart
  const nodes = ['web', 'mobile', 'desktop'];
  const systems: Array<ReturnType<typeof createGossipSystem>> = [];

  // Initialize gossip systems
  for (const nodeId of nodes) {
    const config: GossipConfig = {
      nodeId,
      fanout: 2,
      interval: 100,
      failureThreshold: 3,
      phi: 8,
    };

    const system = createGossipSystem(config);

    // Register a shopping cart CRDT
    const cart = new ORSet<string>(nodeId);
    system.mergeEngine.register('cart', cart);

    systems.push(system);
  }

  // Connect nodes
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

  // Start gossip
  console.log('Starting distributed shopping cart...\n');
  await Promise.all(systems.map((sys) => sys.gossip.start()));

  // Web: Add items
  console.log('🌐 Web: Add "Laptop", "Mouse"');
  const webCart = systems[0].mergeEngine.get<ORSet<string>>('cart')!;
  webCart.add('Laptop');
  webCart.add('Mouse');
  systems[0].gossip.incrementClock();

  await new Promise((resolve) => setTimeout(resolve, 150));

  // Mobile: Add and remove items
  console.log('📱 Mobile: Add "Keyboard", Remove "Mouse"');
  const mobileCart = systems[1].mergeEngine.get<ORSet<string>>('cart')!;
  mobileCart.add('Keyboard');
  mobileCart.remove('Mouse');
  systems[1].gossip.incrementClock();

  await new Promise((resolve) => setTimeout(resolve, 150));

  // Desktop: Add item
  console.log('🖥️  Desktop: Add "Monitor"');
  const desktopCart = systems[2].mergeEngine.get<ORSet<string>>('cart')!;
  desktopCart.add('Monitor');
  systems[2].gossip.incrementClock();

  // Wait for convergence
  console.log('\n⏳ Waiting for convergence...\n');
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Show final cart state
  console.log('🛒 Final Cart State:');
  for (let i = 0; i < systems.length; i++) {
    const cart = systems[i].mergeEngine.get<ORSet<string>>('cart')!;
    const items = Array.from(cart.value()).sort();
    console.log(`  ${nodes[i]}: [${items.join(', ')}]`);
  }

  // Test add-wins semantics with concurrent operations
  console.log('\n🔀 Testing Add-Wins Semantics:');

  // Web removes "Laptop"
  console.log('  Web: Remove "Laptop"');
  webCart.remove('Laptop');
  systems[0].gossip.incrementClock();

  // Mobile adds "Laptop" concurrently (before seeing remove)
  console.log('  Mobile: Add "Laptop" (concurrent)');
  mobileCart.add('Laptop');
  systems[1].gossip.incrementClock();

  // Wait for convergence
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('\n  Result: Add wins! "Laptop" is still in cart\n');

  // Final state
  console.log('🛒 Final Cart (after concurrent ops):');
  const finalCart = systems[0].mergeEngine.get<ORSet<string>>('cart')!;
  const finalItems = Array.from(finalCart.value()).sort();
  console.log(`  Items: [${finalItems.join(', ')}]`);
  console.log(`  Contains "Laptop": ${finalCart.has('Laptop') ? '✅' : '❌'}`);

  // Stop gossip
  await Promise.all(systems.map((sys) => sys.gossip.stop()));

  console.log('\n✨ Example complete!');
}

main().catch(console.error);
