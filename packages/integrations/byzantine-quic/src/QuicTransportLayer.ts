/**
 * QUIC Transport Layer
 *
 * Integrates QuicBridge for low-latency message transport in Byzantine consensus
 * Provides broadcast, reliable delivery, and connection management
 */

import { QuicBridge } from '@agentic-flow/shared/bridges/QuicBridge.js';
import { ConsensusMessage, MessageType } from './MessageTypes.js';

export interface TransportConfig {
  /** Server host */
  host: string;
  /** Server port */
  port: number;
  /** List of all node addresses */
  nodes: Array<{ nodeId: string; host: string; port: number }>;
  /** This node's ID */
  localNodeId: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Connection timeout */
  timeoutMs?: number;
  /** Max retries */
  maxRetries?: number;
}

export interface TransportMetrics {
  messagesSent: number;
  messagesReceived: number;
  broadcastLatencyMs: number;
  deliverySuccessRate: number;
}

/**
 * QUIC-based transport layer for Byzantine consensus
 * Target: <10ms broadcast latency
 */
export class QuicTransportLayer {
  private bridges: Map<string, QuicBridge> = new Map();
  private config: TransportConfig;
  private messageHandlers: Map<MessageType, (msg: ConsensusMessage) => void> = new Map();
  private metrics: TransportMetrics = {
    messagesSent: 0,
    messagesReceived: 0,
    broadcastLatencyMs: 0,
    deliverySuccessRate: 1.0,
  };

  constructor(config: TransportConfig) {
    this.config = config;
  }

  /**
   * Initialize connections to all nodes
   */
  async initialize(): Promise<void> {
    console.log(`[QuicTransport] Initializing connections to ${this.config.nodes.length} nodes...`);

    const initPromises = this.config.nodes
      .filter(node => node.nodeId !== this.config.localNodeId)
      .map(async node => {
        const bridge = new QuicBridge({
          host: node.host,
          port: node.port,
          debug: this.config.debug,
          poolSize: 3, // Small pool for low latency
        });

        try {
          await bridge.initialize();
          this.bridges.set(node.nodeId, bridge);
          console.log(`[QuicTransport] Connected to ${node.nodeId} at ${node.host}:${node.port}`);
        } catch (error) {
          console.error(`[QuicTransport] Failed to connect to ${node.nodeId}:`, error);
        }
      });

    await Promise.all(initPromises);
    console.log(`[QuicTransport] Initialized ${this.bridges.size} connections`);
  }

  /**
   * Broadcast message to all nodes
   * Target: <10ms latency
   */
  async broadcast(message: ConsensusMessage): Promise<void> {
    const startTime = Date.now();
    const serialized = Buffer.from(JSON.stringify(message));

    const sendPromises = Array.from(this.bridges.entries()).map(
      async ([nodeId, bridge]) => {
        try {
          const result = await bridge.send(serialized);
          if (!result.success) {
            console.error(`[QuicTransport] Failed to send to ${nodeId}:`, result.error);
            return false;
          }
          return true;
        } catch (error) {
          console.error(`[QuicTransport] Error sending to ${nodeId}:`, error);
          return false;
        }
      }
    );

    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r).length;
    const totalNodes = this.bridges.size;

    this.metrics.messagesSent++;
    this.metrics.broadcastLatencyMs = Date.now() - startTime;
    this.metrics.deliverySuccessRate = totalNodes > 0 ? successCount / totalNodes : 1.0;

    if (this.config.debug) {
      console.log(
        `[QuicTransport] Broadcast ${message.type} to ${successCount}/${totalNodes} nodes ` +
        `in ${this.metrics.broadcastLatencyMs}ms`
      );
    }
  }

  /**
   * Send message to specific node
   */
  async send(nodeId: string, message: ConsensusMessage): Promise<boolean> {
    const bridge = this.bridges.get(nodeId);
    if (!bridge) {
      console.error(`[QuicTransport] No connection to node ${nodeId}`);
      return false;
    }

    try {
      const serialized = Buffer.from(JSON.stringify(message));
      const result = await bridge.send(serialized);

      if (result.success) {
        this.metrics.messagesSent++;
        return true;
      } else {
        console.error(`[QuicTransport] Failed to send to ${nodeId}:`, result.error);
        return false;
      }
    } catch (error) {
      console.error(`[QuicTransport] Error sending to ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * Register handler for message type
   */
  onMessage(type: MessageType, handler: (msg: ConsensusMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Simulate receiving a message (in production, this would be driven by QUIC server)
   */
  async receive(message: ConsensusMessage): Promise<void> {
    this.metrics.messagesReceived++;

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        handler(message);
      } catch (error) {
        console.error(`[QuicTransport] Error handling ${message.type}:`, error);
      }
    } else if (this.config.debug) {
      console.log(`[QuicTransport] No handler for message type ${message.type}`);
    }
  }

  /**
   * Get transport metrics
   */
  getMetrics(): TransportMetrics {
    return { ...this.metrics };
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): Array<{ nodeId: string; connected: boolean }> {
    return this.config.nodes
      .filter(node => node.nodeId !== this.config.localNodeId)
      .map(node => ({
        nodeId: node.nodeId,
        connected: this.bridges.has(node.nodeId),
      }));
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    console.log('[QuicTransport] Closing all connections...');

    const closePromises = Array.from(this.bridges.values()).map(bridge =>
      bridge.close().catch(err => {
        console.error('[QuicTransport] Error closing connection:', err);
      })
    );

    await Promise.all(closePromises);
    this.bridges.clear();
    console.log('[QuicTransport] All connections closed');
  }
}
