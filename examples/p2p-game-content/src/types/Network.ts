/**
 * Network and P2P type definitions
 */

export interface PeerConnection {
  id: string;
  peer: any; // SimplePeer instance
  connected: boolean;
  lastSeen: number;
  latency: number;
}

export interface P2PMessage {
  type: P2PMessageType;
  from: string;
  to?: string; // undefined for broadcast
  payload: any;
  timestamp: number;
  id: string;
}

export type P2PMessageType =
  | 'peer_join'
  | 'peer_leave'
  | 'content_share'
  | 'content_request'
  | 'content_validation'
  | 'content_rating'
  | 'state_sync'
  | 'gossip'
  | 'heartbeat';

export interface NetworkStats {
  peerId: string;
  connectedPeers: number;
  totalMessages: number;
  bytesReceived: number;
  bytesSent: number;
  avgLatency: number;
  uptime: number;
}

export interface GossipMessage {
  content: any;
  ttl: number;
  seen: Set<string>;
  originPeer: string;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'peer-discovery';
  from: string;
  to: string;
  data: any;
}
