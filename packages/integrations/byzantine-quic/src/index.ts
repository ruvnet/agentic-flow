/**
 * Byzantine QUIC - Byzantine Fault-Tolerant Consensus over QUIC
 *
 * Implements PBFT (Practical Byzantine Fault Tolerance) protocol with QUIC transport
 * Performance target: <10ms consensus latency
 * Fault tolerance: Survives f malicious nodes in 3f+1 configuration
 */

export { ByzantineNode, type ByzantineNodeConfig, type ByzantineNodeMetrics } from './ByzantineNode.js';
export { ConsensusProtocol, type ConsensusConfig, type ConsensusState } from './ConsensusProtocol.js';
export { ViewManager, type ViewConfig, type ViewState } from './ViewManager.js';
export { CheckpointManager, type CheckpointConfig, type StableCheckpoint } from './CheckpointManager.js';
export { QuicTransportLayer, type TransportConfig, type TransportMetrics } from './QuicTransportLayer.js';
export {
  MessageType,
  MessageCrypto,
  type ConsensusMessage,
  type RequestMessage,
  type PrePrepareMessage,
  type PrepareMessage,
  type CommitMessage,
  type ReplyMessage,
  type ViewChangeMessage,
  type NewViewMessage,
  type CheckpointMessage,
  type PreparedCertificate,
} from './MessageTypes.js';
