/**
 * Byzantine Node
 *
 * Main node implementation for Byzantine fault-tolerant consensus over QUIC
 * Coordinates ConsensusProtocol, ViewManager, CheckpointManager, and Transport
 */

import { ConsensusProtocol, ConsensusConfig } from './ConsensusProtocol.js';
import { ViewManager, ViewConfig } from './ViewManager.js';
import { CheckpointManager, CheckpointConfig } from './CheckpointManager.js';
import { QuicTransportLayer, TransportConfig } from './QuicTransportLayer.js';
import {
  MessageType,
  RequestMessage,
  PrePrepareMessage,
  PrepareMessage,
  CommitMessage,
  CheckpointMessage,
  MessageCrypto,
} from './MessageTypes.js';

export interface ByzantineNodeConfig {
  /** This node's unique ID */
  nodeId: string;
  /** List of all nodes in system */
  nodes: Array<{ nodeId: string; host: string; port: number }>;
  /** Maximum Byzantine faults to tolerate */
  maxFaults: number;
  /** View change timeout (ms) */
  viewChangeTimeoutMs?: number;
  /** Checkpoint interval (operations) */
  checkpointInterval?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface ByzantineNodeMetrics {
  nodeId: string;
  currentView: number;
  isPrimary: boolean;
  totalRequests: number;
  committedRequests: number;
  pendingRequests: number;
  averageLatencyMs: number;
  transportMetrics: {
    messagesSent: number;
    messagesReceived: number;
    broadcastLatencyMs: number;
  };
  checkpointStats: {
    lastStableSequence: number;
    pendingCheckpoints: number;
  };
}

/**
 * Byzantine fault-tolerant node
 * Implements PBFT consensus over QUIC transport
 */
export class ByzantineNode {
  private config: Required<ByzantineNodeConfig>;
  private crypto: MessageCrypto;
  private viewManager: ViewManager;
  private checkpointManager: CheckpointManager;
  private consensusProtocol: ConsensusProtocol;
  private transport: QuicTransportLayer;
  private initialized: boolean = false;

  // Request tracking
  private requestCount: number = 0;
  private committedCount: number = 0;
  private latencies: number[] = [];
  private requestStartTimes: Map<number, number> = new Map();

  // Callbacks
  private onRequestCommitted?: (request: RequestMessage, result: any, latencyMs: number) => void;

  constructor(config: ByzantineNodeConfig) {
    this.config = {
      ...config,
      viewChangeTimeoutMs: config.viewChangeTimeoutMs ?? 5000,
      checkpointInterval: config.checkpointInterval ?? 100,
      debug: config.debug ?? false,
    };

    this.validateConfig();

    // Initialize crypto
    this.crypto = new MessageCrypto();

    // Initialize managers
    this.viewManager = new ViewManager(
      config.nodes.map(n => n.nodeId),
      {
        totalNodes: config.nodes.length,
        maxFaults: config.maxFaults,
        viewChangeTimeoutMs: this.config.viewChangeTimeoutMs,
        debug: this.config.debug,
      }
    );

    this.checkpointManager = new CheckpointManager({
      checkpointInterval: this.config.checkpointInterval,
      stabilityThreshold: 2 * config.maxFaults + 1, // Need 2f+1 matching checkpoints
      debug: this.config.debug,
    });

    // Initialize consensus protocol
    this.consensusProtocol = new ConsensusProtocol(
      {
        nodeId: config.nodeId,
        totalNodes: config.nodes.length,
        maxFaults: config.maxFaults,
        debug: this.config.debug,
      },
      this.viewManager,
      this.checkpointManager
    );

    // Initialize transport
    const nodeConfig = config.nodes.find(n => n.nodeId === config.nodeId);
    if (!nodeConfig) {
      throw new Error(`Node ${config.nodeId} not found in nodes list`);
    }

    this.transport = new QuicTransportLayer({
      host: nodeConfig.host,
      port: nodeConfig.port,
      nodes: config.nodes,
      localNodeId: config.nodeId,
      debug: this.config.debug,
    });

    // Setup callbacks
    this.setupCallbacks();
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    const { nodes, maxFaults } = this.config;

    if (nodes.length < 3 * maxFaults + 1) {
      throw new Error(
        `Invalid configuration: Need at least 3f+1 nodes. ` +
        `Have ${nodes.length} nodes, but need ${3 * maxFaults + 1} for f=${maxFaults}`
      );
    }

    const uniqueIds = new Set(nodes.map(n => n.nodeId));
    if (uniqueIds.size !== nodes.length) {
      throw new Error('Duplicate node IDs found');
    }
  }

  /**
   * Setup internal callbacks
   */
  private setupCallbacks(): void {
    // Handle committed requests
    this.consensusProtocol.onCommit((request, result) => {
      this.committedCount++;

      // Track latency
      const startTime = this.requestStartTimes.get(request.requestId);
      if (startTime) {
        const latencyMs = Date.now() - startTime;
        this.latencies.push(latencyMs);
        this.requestStartTimes.delete(request.requestId);

        if (this.config.debug) {
          console.log(
            `[ByzantineNode] Request ${request.requestId} committed in ${latencyMs}ms`
          );
        }

        // Notify callback
        if (this.onRequestCommitted) {
          this.onRequestCommitted(request, result, latencyMs);
        }
      }
    });

    // Setup message handlers
    this.transport.onMessage(MessageType.PRE_PREPARE, async msg => {
      const prepare = await this.consensusProtocol.handlePrePrepare(
        msg as PrePrepareMessage
      );
      if (prepare) {
        await this.transport.broadcast(prepare);
      }
    });

    this.transport.onMessage(MessageType.PREPARE, async msg => {
      const commit = await this.consensusProtocol.handlePrepare(msg as PrepareMessage);
      if (commit) {
        await this.transport.broadcast(commit);
      }
    });

    this.transport.onMessage(MessageType.COMMIT, async msg => {
      await this.consensusProtocol.handleCommit(msg as CommitMessage);
    });

    this.transport.onMessage(MessageType.CHECKPOINT, msg => {
      this.checkpointManager.recordCheckpoint(msg as CheckpointMessage);
    });
  }

  /**
   * Initialize node and establish connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[ByzantineNode] Already initialized');
      return;
    }

    console.log(`[ByzantineNode] Initializing node ${this.config.nodeId}...`);

    // Initialize transport
    await this.transport.initialize();

    // Exchange public keys with all nodes
    await this.exchangePublicKeys();

    this.initialized = true;
    console.log(`[ByzantineNode] Node ${this.config.nodeId} initialized`);
    console.log(`[ByzantineNode] View ${this.viewManager.getCurrentView()}`);
    console.log(
      `[ByzantineNode] Primary: ${this.viewManager.getPrimaryNodeId()}`
    );
  }

  /**
   * Exchange public keys with all nodes
   */
  private async exchangePublicKeys(): Promise<void> {
    // In production, this would involve actual key exchange protocol
    // For now, we simulate by registering our own key
    const publicKey = this.consensusProtocol.getPublicKey();
    this.consensusProtocol.registerPublicKey(this.config.nodeId, publicKey);

    if (this.config.debug) {
      console.log(`[ByzantineNode] Public key registered for ${this.config.nodeId}`);
    }
  }

  /**
   * Submit a request to the consensus protocol
   */
  async submitRequest(operation: any): Promise<number> {
    if (!this.initialized) {
      throw new Error('Node not initialized');
    }

    this.requestCount++;
    const requestId = this.requestCount;

    // Create request message
    const request = this.crypto.createRequest(
      this.config.nodeId,
      this.config.nodeId, // Client ID same as node ID for simplicity
      requestId,
      operation
    );

    // Track start time
    this.requestStartTimes.set(requestId, Date.now());

    // If we're primary, propose the request
    if (this.isPrimary()) {
      const prePrepare = await this.consensusProtocol.proposeRequest(request);
      await this.transport.broadcast(prePrepare);
    } else {
      // Forward to primary
      const primaryId = this.viewManager.getPrimaryNodeId();
      await this.transport.send(primaryId, request);
    }

    if (this.config.debug) {
      console.log(`[ByzantineNode] Submitted request ${requestId}`);
    }

    return requestId;
  }

  /**
   * Check if this node is current primary
   */
  isPrimary(): boolean {
    return this.viewManager.isPrimary(this.config.nodeId);
  }

  /**
   * Get current view number
   */
  getCurrentView(): number {
    return this.viewManager.getCurrentView();
  }

  /**
   * Get node metrics
   */
  getMetrics(): ByzantineNodeMetrics {
    const consensusMetrics = this.consensusProtocol.getMetrics();
    const transportMetrics = this.transport.getMetrics();
    const checkpointStats = this.checkpointManager.getStats();

    // Calculate average latency
    const avgLatency =
      this.latencies.length > 0
        ? this.latencies.reduce((sum, l) => sum + l, 0) / this.latencies.length
        : 0;

    return {
      nodeId: this.config.nodeId,
      currentView: this.viewManager.getCurrentView(),
      isPrimary: this.isPrimary(),
      totalRequests: this.requestCount,
      committedRequests: this.committedCount,
      pendingRequests: consensusMetrics.pendingRequests,
      averageLatencyMs: avgLatency,
      transportMetrics: {
        messagesSent: transportMetrics.messagesSent,
        messagesReceived: transportMetrics.messagesReceived,
        broadcastLatencyMs: transportMetrics.broadcastLatencyMs,
      },
      checkpointStats: {
        lastStableSequence: checkpointStats.lastStableSequence,
        pendingCheckpoints: checkpointStats.pendingCheckpoints,
      },
    };
  }

  /**
   * Get detailed statistics
   */
  getStats(): {
    metrics: ByzantineNodeMetrics;
    latencyP50: number;
    latencyP95: number;
    latencyP99: number;
  } {
    const metrics = this.getMetrics();

    // Calculate percentiles
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    return {
      metrics,
      latencyP50: p50,
      latencyP95: p95,
      latencyP99: p99,
    };
  }

  /**
   * Register callback for committed requests
   */
  onCommit(
    callback: (request: RequestMessage, result: any, latencyMs: number) => void
  ): void {
    this.onRequestCommitted = callback;
  }

  /**
   * Simulate receiving a message (for testing)
   */
  async receiveMessage(message: any): Promise<void> {
    await this.transport.receive(message);
  }

  /**
   * Shutdown node
   */
  async shutdown(): Promise<void> {
    console.log(`[ByzantineNode] Shutting down node ${this.config.nodeId}...`);

    await this.transport.close();
    this.viewManager.destroy();
    this.initialized = false;

    console.log(`[ByzantineNode] Node ${this.config.nodeId} shut down`);
  }
}
