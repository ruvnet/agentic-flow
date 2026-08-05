// Core exports
export { VectorClock } from './VectorClock';
export { GossipProtocol } from './GossipProtocol';
export { PeerManager } from './PeerManager';
export { MergeEngine } from './MergeEngine';

// CRDT exports
export { GCounter } from './crdts/GCounter';
export { PNCounter } from './crdts/PNCounter';
export { LWWSet } from './crdts/LWWSet';
export { ORSet } from './crdts/ORSet';
export { RGA } from './crdts/RGA';

// Transport exports
export { MemoryTransport } from './transports';

// Type exports
export type {
  CRDT,
  StateCRDT,
  OperationCRDT,
  Operation,
  PeerInfo,
  GossipMessage,
  GossipConfig,
  GossipMetrics,
  TransportAdapter,
  StateDigest,
} from './types';
export { GossipMessageType } from './types';

// Convenience factory
import { GossipProtocol } from './GossipProtocol';
import { PeerManager } from './PeerManager';
import { MergeEngine } from './MergeEngine';
import { MemoryTransport } from './transports';
import { GossipConfig, TransportAdapter } from './types';

/**
 * Factory function to create a complete gossip system
 */
export function createGossipSystem(
  config: GossipConfig,
  transport?: TransportAdapter
): {
  gossip: GossipProtocol;
  peerManager: PeerManager;
  mergeEngine: MergeEngine;
  transport: TransportAdapter;
} {
  const peerManager = new PeerManager(config.nodeId, config.phi);
  const mergeEngine = new MergeEngine();
  const transportAdapter = transport || new MemoryTransport(config.nodeId);
  const gossip = new GossipProtocol(config, peerManager, mergeEngine, transportAdapter);

  return {
    gossip,
    peerManager,
    mergeEngine,
    transport: transportAdapter,
  };
}
