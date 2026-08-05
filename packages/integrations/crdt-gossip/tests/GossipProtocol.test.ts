import { GossipProtocol } from '../src/GossipProtocol';
import { PeerManager } from '../src/PeerManager';
import { MergeEngine } from '../src/MergeEngine';
import { MemoryTransport } from '../src/transports/MemoryTransport';
import { GCounter } from '../src/crdts/GCounter';
import { GossipConfig } from '../src/types';

describe('GossipProtocol', () => {
  beforeEach(() => {
    MemoryTransport.clearRegistry();
  });

  afterEach(() => {
    MemoryTransport.clearRegistry();
  });

  describe('Initialization', () => {
    it('should create gossip protocol instance', () => {
      const config: GossipConfig = {
        nodeId: 'node1',
        fanout: 3,
        interval: 100,
        failureThreshold: 3,
        phi: 8,
      };

      const peerManager = new PeerManager(config.nodeId);
      const mergeEngine = new MergeEngine();
      const transport = new MemoryTransport(config.nodeId);

      const gossip = new GossipProtocol(config, peerManager, mergeEngine, transport);

      expect(gossip).toBeDefined();
    });

    it('should start and stop gossip protocol', async () => {
      const config: GossipConfig = {
        nodeId: 'node1',
        fanout: 3,
        interval: 100,
        failureThreshold: 3,
        phi: 8,
      };

      const peerManager = new PeerManager(config.nodeId);
      const mergeEngine = new MergeEngine();
      const transport = new MemoryTransport(config.nodeId);

      const gossip = new GossipProtocol(config, peerManager, mergeEngine, transport);

      await gossip.start();
      await gossip.stop();
    });
  });

  describe('State Dissemination', () => {
    it('should disseminate state between two nodes', async () => {
      // Setup node1
      const config1: GossipConfig = {
        nodeId: 'node1',
        fanout: 1,
        interval: 50,
        failureThreshold: 3,
        phi: 8,
      };

      const peerManager1 = new PeerManager(config1.nodeId);
      const mergeEngine1 = new MergeEngine();
      const transport1 = new MemoryTransport(config1.nodeId);
      const gossip1 = new GossipProtocol(config1, peerManager1, mergeEngine1, transport1);

      // Setup node2
      const config2: GossipConfig = {
        nodeId: 'node2',
        fanout: 1,
        interval: 50,
        failureThreshold: 3,
        phi: 8,
      };

      const peerManager2 = new PeerManager(config2.nodeId);
      const mergeEngine2 = new MergeEngine();
      const transport2 = new MemoryTransport(config2.nodeId);
      const gossip2 = new GossipProtocol(config2, peerManager2, mergeEngine2, transport2);

      // Register CRDTs
      const counter1 = new GCounter('node1');
      counter1.increment(10);
      mergeEngine1.register('counter', counter1);

      const counter2 = new GCounter('node2');
      mergeEngine2.register('counter', counter2);

      // Connect peers
      peerManager1.addPeer({ id: 'node2', address: 'localhost', port: 8002 });
      peerManager2.addPeer({ id: 'node1', address: 'localhost', port: 8001 });

      // Start gossip
      await gossip1.start();
      await gossip2.start();

      // Wait for gossip rounds
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop gossip
      await gossip1.stop();
      await gossip2.stop();

      // Check convergence
      const finalCounter2 = mergeEngine2.get<GCounter>('counter');
      expect(finalCounter2?.value()).toBe(10);
    }, 10000);

    it('should converge with multiple nodes', async () => {
      const nodes = 5;
      const gossipSystems: Array<{
        gossip: GossipProtocol;
        peerManager: PeerManager;
        mergeEngine: MergeEngine;
      }> = [];

      // Create nodes
      for (let i = 0; i < nodes; i++) {
        const nodeId = `node${i}`;
        const config: GossipConfig = {
          nodeId,
          fanout: 2,
          interval: 50,
          failureThreshold: 3,
          phi: 8,
        };

        const peerManager = new PeerManager(config.nodeId);
        const mergeEngine = new MergeEngine();
        const transport = new MemoryTransport(config.nodeId);
        const gossip = new GossipProtocol(config, peerManager, mergeEngine, transport);

        // Create counter with unique value
        const counter = new GCounter(nodeId);
        counter.increment(i + 1);
        mergeEngine.register('counter', counter);

        gossipSystems.push({ gossip, peerManager, mergeEngine });
      }

      // Connect all nodes to each other (full mesh)
      for (let i = 0; i < nodes; i++) {
        for (let j = 0; j < nodes; j++) {
          if (i !== j) {
            gossipSystems[i].peerManager.addPeer({
              id: `node${j}`,
              address: 'localhost',
              port: 8000 + j,
            });
          }
        }
      }

      // Start all gossip protocols
      await Promise.all(gossipSystems.map((sys) => sys.gossip.start()));

      // Wait for convergence
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Stop all gossip protocols
      await Promise.all(gossipSystems.map((sys) => sys.gossip.stop()));

      // Check convergence: all nodes should have sum = 1+2+3+4+5 = 15
      for (const sys of gossipSystems) {
        const counter = sys.mergeEngine.get<GCounter>('counter');
        expect(counter?.value()).toBe(15);
      }
    }, 15000);
  });

  describe('Metrics', () => {
    it('should track gossip metrics', async () => {
      const config: GossipConfig = {
        nodeId: 'node1',
        fanout: 3,
        interval: 100,
        failureThreshold: 3,
        phi: 8,
      };

      const peerManager = new PeerManager(config.nodeId);
      const mergeEngine = new MergeEngine();
      const transport = new MemoryTransport(config.nodeId);

      const gossip = new GossipProtocol(config, peerManager, mergeEngine, transport);

      await gossip.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await gossip.stop();

      const metrics = gossip.getMetrics();

      expect(metrics).toHaveProperty('messagesSent');
      expect(metrics).toHaveProperty('messagesReceived');
      expect(metrics).toHaveProperty('mergeOperations');
      expect(metrics).toHaveProperty('convergenceTime');
    });
  });
});
