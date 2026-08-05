import EventEmitter from 'eventemitter3';
import { TransportAdapter, GossipMessage, PeerInfo } from '../types';

/**
 * MemoryTransport - In-memory transport for testing and local simulation
 *
 * Simulates network transport using event emitters and shared registry.
 * Useful for testing gossip protocols without actual network I/O.
 */
export class MemoryTransport extends EventEmitter implements TransportAdapter {
  private static registry: Map<string, MemoryTransport> = new Map();
  private nodeId: string;
  private messageHandler?: (message: GossipMessage) => void;
  private started: boolean = false;
  private latency: number; // Simulated network latency in ms

  constructor(nodeId: string, latency: number = 0) {
    super();
    this.nodeId = nodeId;
    this.latency = latency;
  }

  /**
   * Register this transport in the global registry
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    MemoryTransport.registry.set(this.nodeId, this);
    this.started = true;
    this.emit('started');
  }

  /**
   * Unregister from global registry
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    MemoryTransport.registry.delete(this.nodeId);
    this.started = false;
    this.emit('stopped');
  }

  /**
   * Send message to a specific peer
   */
  async send(message: GossipMessage, peer: PeerInfo): Promise<void> {
    if (!this.started) {
      throw new Error('Transport not started');
    }

    const targetTransport = MemoryTransport.registry.get(peer.id);

    if (!targetTransport) {
      throw new Error(`Peer ${peer.id} not found in registry`);
    }

    // Simulate network latency
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }

    // Deliver message
    targetTransport.deliverMessage(message);

    this.emit('message-sent', { to: peer.id, message });
  }

  /**
   * Broadcast message to multiple peers
   */
  async broadcast(message: GossipMessage, peers: PeerInfo[]): Promise<void> {
    if (!this.started) {
      throw new Error('Transport not started');
    }

    const promises = peers.map((peer) => this.send(message, peer));
    await Promise.all(promises);

    this.emit('broadcast-sent', { peers: peers.map((p) => p.id), message });
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: GossipMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Internal method to deliver message to handler
   */
  private deliverMessage(message: GossipMessage): void {
    if (this.messageHandler) {
      // Use setImmediate to simulate async message delivery
      setImmediate(() => {
        this.messageHandler!(message);
        this.emit('message-received', message);
      });
    }
  }

  /**
   * Get all registered transports (for testing)
   */
  static getRegistry(): Map<string, MemoryTransport> {
    return new Map(MemoryTransport.registry);
  }

  /**
   * Clear registry (for testing)
   */
  static clearRegistry(): void {
    MemoryTransport.registry.clear();
  }

  /**
   * Get transport for a specific node (for testing)
   */
  static getTransport(nodeId: string): MemoryTransport | undefined {
    return MemoryTransport.registry.get(nodeId);
  }
}
