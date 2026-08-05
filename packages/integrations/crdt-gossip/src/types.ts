import { VectorClock } from './VectorClock';

/**
 * Base interface for all CRDTs
 * CRDTs must satisfy:
 * - Strong Eventual Consistency (SEC)
 * - Commutativity: merge(A, B) = merge(B, A)
 * - Idempotence: merge(A, A) = A
 * - Associativity: merge(merge(A, B), C) = merge(A, merge(B, C))
 */
export interface CRDT<T> {
  /**
   * Merge another CRDT state into this one
   * Must be commutative, idempotent, and associative
   */
  merge(other: T): void;

  /**
   * Get a snapshot of the current state
   */
  value(): unknown;

  /**
   * Serialize to JSON for transmission
   */
  toJSON(): unknown;

  /**
   * Clone this CRDT
   */
  clone(): T;
}

/**
 * Interface for state-based CRDTs (CvRDTs)
 * State is transmitted and merged
 */
export interface StateCRDT<T> extends CRDT<T> {
  /**
   * Get the full state for transmission
   */
  getState(): unknown;
}

/**
 * Interface for operation-based CRDTs (CmRDTs)
 * Operations are transmitted and applied
 */
export interface OperationCRDT<T> extends CRDT<T> {
  /**
   * Apply an operation received from another replica
   */
  applyOperation(operation: Operation): void;
}

/**
 * Generic operation type for CmRDTs
 */
export interface Operation {
  type: string;
  nodeId: string;
  timestamp: number;
  vectorClock?: VectorClock;
  payload: unknown;
}

/**
 * Peer information for gossip protocol
 */
export interface PeerInfo {
  id: string;
  address: string;
  port: number;
  lastSeen: number;
  failureCount: number;
  isAlive: boolean;
}

/**
 * Gossip message types
 */
export enum GossipMessageType {
  PUSH = 'PUSH',
  PULL = 'PULL',
  PULL_RESPONSE = 'PULL_RESPONSE',
  HEARTBEAT = 'HEARTBEAT',
}

/**
 * Gossip message structure
 */
export interface GossipMessage {
  type: GossipMessageType;
  from: string;
  to?: string;
  timestamp: number;
  digest?: StateDigest;
  state?: unknown;
  vectorClock?: VectorClock;
}

/**
 * State digest for efficient comparison
 */
export interface StateDigest {
  nodeId: string;
  vectorClock: VectorClock;
  checksum: string;
}

/**
 * Transport adapter interface
 */
export interface TransportAdapter {
  send(message: GossipMessage, peer: PeerInfo): Promise<void>;
  broadcast(message: GossipMessage, peers: PeerInfo[]): Promise<void>;
  onMessage(handler: (message: GossipMessage) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Configuration for gossip protocol
 */
export interface GossipConfig {
  nodeId: string;
  fanout: number; // Number of peers to gossip to per round
  interval: number; // Gossip interval in milliseconds
  failureThreshold: number; // Number of missed heartbeats before marking peer as failed
  phi: number; // Phi-accrual failure detector threshold (typically 8-10)
}

/**
 * Metrics for monitoring
 */
export interface GossipMetrics {
  messagesSent: number;
  messagesReceived: number;
  mergeOperations: number;
  convergenceTime: number;
  activePeers: number;
  failedPeers: number;
}
