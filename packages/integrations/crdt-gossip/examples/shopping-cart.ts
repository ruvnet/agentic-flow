/**
 * Shopping Cart Example
 *
 * Demonstrates using PN-Counter (for quantities) and LWW-Set (for items)
 * to build a distributed shopping cart with eventual consistency.
 */

import { createGossipSystem, PNCounter, LWWSet, GossipConfig } from '../src';

interface CartItem {
  id: string;
  name: string;
  price: number;
}

async function main() {
  console.log('🛍️  Shopping Cart with Quantities Example\n');

  // Create 2 devices
  const devices = ['phone', 'tablet'];
  const systems: Array<ReturnType<typeof createGossipSystem>> = [];

  // Initialize gossip systems
  for (const deviceId of devices) {
    const config: GossipConfig = {
      nodeId: deviceId,
      fanout: 1,
      interval: 100,
      failureThreshold: 3,
      phi: 8,
    };

    const system = createGossipSystem(config);

    // Register CRDTs for cart items and quantities
    const items = new LWWSet<string>(deviceId);
    const quantities = new Map<string, PNCounter>();

    system.mergeEngine.register('items', items);

    systems.push(system);
  }

  // Item catalog
  const catalog: Record<string, CartItem> = {
    laptop: { id: 'laptop', name: 'Laptop', price: 999 },
    mouse: { id: 'mouse', name: 'Mouse', price: 29 },
    keyboard: { id: 'keyboard', name: 'Keyboard', price: 79 },
  };

  // Connect devices
  systems[0].peerManager.addPeer({
    id: 'tablet',
    address: 'localhost',
    port: 9001,
  });
  systems[1].peerManager.addPeer({
    id: 'phone',
    address: 'localhost',
    port: 9000,
  });

  // Start gossip
  console.log('Starting shopping session...\n');
  await Promise.all(systems.map((sys) => sys.gossip.start()));

  // Helper functions
  const addItem = (
    system: ReturnType<typeof createGossipSystem>,
    itemId: string,
    quantity: number = 1
  ) => {
    const items = system.mergeEngine.get<LWWSet<string>>('items')!;

    // Add item to set
    items.add(itemId);

    // Create or update quantity counter
    let qtyCounter = system.mergeEngine.get<PNCounter>(`qty:${itemId}`);
    if (!qtyCounter) {
      qtyCounter = new PNCounter(system.gossip.getVectorClock().getNodeIds()[0] || 'node');
      system.mergeEngine.register(`qty:${itemId}`, qtyCounter);
    }
    qtyCounter.increment(quantity);

    system.gossip.incrementClock();
  };

  const removeItem = (system: ReturnType<typeof createGossipSystem>, itemId: string) => {
    const items = system.mergeEngine.get<LWWSet<string>>('items')!;
    items.remove(itemId);
    system.gossip.incrementClock();
  };

  const updateQuantity = (
    system: ReturnType<typeof createGossipSystem>,
    itemId: string,
    delta: number
  ) => {
    const qtyCounter = system.mergeEngine.get<PNCounter>(`qty:${itemId}`);
    if (qtyCounter) {
      if (delta > 0) {
        qtyCounter.increment(delta);
      } else {
        qtyCounter.decrement(Math.abs(delta));
      }
      system.gossip.incrementClock();
    }
  };

  // Phone: Add items
  console.log('📱 Phone: Add Laptop (qty: 1), Mouse (qty: 2)');
  addItem(systems[0], 'laptop', 1);
  addItem(systems[0], 'mouse', 2);

  await new Promise((resolve) => setTimeout(resolve, 150));

  // Tablet: Add keyboard
  console.log('📲 Tablet: Add Keyboard (qty: 1)');
  addItem(systems[1], 'keyboard', 1);

  await new Promise((resolve) => setTimeout(resolve, 150));

  // Phone: Update quantity
  console.log('📱 Phone: Increase Mouse quantity by 1');
  updateQuantity(systems[0], 'mouse', 1);

  // Wait for convergence
  console.log('\n⏳ Waiting for sync...\n');
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Display cart
  const displayCart = (
    system: ReturnType<typeof createGossipSystem>,
    deviceName: string
  ) => {
    const items = system.mergeEngine.get<LWWSet<string>>('items')!;
    const cartItems = Array.from(items.value());

    console.log(`🛒 Cart on ${deviceName}:`);

    let total = 0;
    cartItems.forEach((itemId) => {
      const qtyCounter = system.mergeEngine.get<PNCounter>(`qty:${itemId}`);
      const quantity = qtyCounter ? qtyCounter.value() : 0;
      const item = catalog[itemId];

      if (item && quantity > 0) {
        const subtotal = item.price * quantity;
        total += subtotal;
        console.log(`  - ${item.name} x${quantity} = $${subtotal}`);
      }
    });

    console.log(`  Total: $${total}\n`);
  };

  displayCart(systems[0], 'Phone');
  displayCart(systems[1], 'Tablet');

  // Concurrent operations
  console.log('🔀 Concurrent operations:');
  console.log('  Phone: Remove Mouse');
  removeItem(systems[0], 'mouse');

  console.log('  Tablet: Increase Mouse quantity by 2');
  updateQuantity(systems[1], 'mouse', 2);

  // Wait for convergence
  console.log('\n⏳ Waiting for convergence...\n');
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('Final state after concurrent operations:\n');
  displayCart(systems[0], 'Phone');
  displayCart(systems[1], 'Tablet');

  // Stop gossip
  await Promise.all(systems.map((sys) => sys.gossip.stop()));

  console.log('✨ Example complete!');
}

main().catch(console.error);
