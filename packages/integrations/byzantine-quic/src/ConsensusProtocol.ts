/**
 * Consensus Protocol
 *
 * Implements PBFT (Practical Byzantine Fault Tolerance) three-phase commit protocol
 * Phases: Pre-Prepare -> Prepare -> Commit
 * Performance target: <10ms consensus latency
 */

import {
  MessageType,
  ConsensusMessage,
  RequestMessage,
  PrePrepareMessage,
  PrepareMessage,
  CommitMessage,
  MessageCrypto,
} from './MessageTypes.js';
import { ViewManager } from './ViewManager.js';
import { CheckpointManager } from './CheckpointManager.js';

export interface ConsensusConfig {
  /** This node's ID */
  nodeId: string;
  /** Total nodes in system */
  totalNodes: number;
  /** Maximum Byzantine faults to tolerate */
  maxFaults: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface ConsensusState {
  view: number;
  sequence: number;
  phase: 'idle' | 'pre-prepare' | 'prepare' | 'commit' | 'committed';
  request: RequestMessage | null;
}

/**
 * Request state tracking
 */
interface RequestState {
  request: RequestMessage;
  prePrepare: PrePrepareMessage | null;
  prepares: Map<string, PrepareMessage>;
  commits: Map<string, CommitMessage>;
  preparedCertificate: boolean;
  committedLocal: boolean;
  phase: 'pre-prepare' | 'prepare' | 'commit' | 'committed';
}

/**
 * Three-phase consensus protocol implementation
 */
export class ConsensusProtocol {
  private config: Required<ConsensusConfig>;
  private crypto: MessageCrypto;
  private viewManager: ViewManager;
  private checkpointManager: CheckpointManager;
  private sequenceNumber: number = 0;
  private publicKeys: Map<string, string> = new Map();

  // Request tracking
  private pendingRequests: Map<number, RequestState> = new Map();
  private executedRequests: Set<number> = new Set();

  // State machine for current operation
  private currentState: ConsensusState = {
    view: 0,
    sequence: 0,
    phase: 'idle',
    request: null,
  };

  // Callbacks
  private onCommitCallback?: (request: RequestMessage, result: any) => void;
  private onViewChangeCallback?: (newView: number) => void;

  constructor(
    config: ConsensusConfig,
    viewManager: ViewManager,
    checkpointManager: CheckpointManager
  ) {
    this.config = {
      ...config,
      debug: config.debug ?? false,
    };
    this.crypto = new MessageCrypto();
    this.viewManager = viewManager;
    this.checkpointManager = checkpointManager;
  }

  /**
   * Get node's public key
   */
  getPublicKey(): string {
    return this.crypto.getPublicKey();
  }

  /**
   * Register public key for a node
   */
  registerPublicKey(nodeId: string, publicKey: string): void {
    this.publicKeys.set(nodeId, publicKey);
    if (this.config.debug) {
      console.log(`[Consensus] Registered public key for ${nodeId}`);
    }
  }

  /**
   * Get current consensus state
   */
  getState(): ConsensusState {
    return { ...this.currentState };
  }

  /**
   * Start consensus for a new request (PRIMARY ONLY)
   */
  async proposeRequest(request: RequestMessage): Promise<PrePrepareMessage> {
    if (!this.viewManager.isPrimary(this.config.nodeId)) {
      throw new Error('Only primary can propose requests');
    }

    // Increment sequence number
    this.sequenceNumber++;
    const sequence = this.sequenceNumber;

    // Create pre-prepare message
    const prePrepare = this.crypto.createPrePrepare(
      this.config.nodeId,
      this.viewManager.getCurrentView(),
      sequence,
      request
    );

    // Initialize request state
    this.pendingRequests.set(sequence, {
      request,
      prePrepare,
      prepares: new Map(),
      commits: new Map(),
      preparedCertificate: false,
      committedLocal: false,
      phase: 'pre-prepare',
    });

    this.currentState = {
      view: this.viewManager.getCurrentView(),
      sequence,
      phase: 'pre-prepare',
      request,
    };

    if (this.config.debug) {
      console.log(
        `[Consensus] PRIMARY proposing request ${request.requestId} as sequence ${sequence}`
      );
    }

    return prePrepare;
  }

  /**
   * Handle received pre-prepare message (REPLICAS)
   */
  async handlePrePrepare(prePrepare: PrePrepareMessage): Promise<PrepareMessage | null> {
    const { view, sequence, digest, request } = prePrepare;

    // Verify pre-prepare
    if (!this.verifyPrePrepare(prePrepare)) {
      if (this.config.debug) {
        console.log(`[Consensus] Invalid pre-prepare for sequence ${sequence}`);
      }
      return null;
    }

    // Check if already processed
    if (this.pendingRequests.has(sequence)) {
      return null;
    }

    // Initialize request state
    this.pendingRequests.set(sequence, {
      request,
      prePrepare,
      prepares: new Map(),
      commits: new Map(),
      preparedCertificate: false,
      committedLocal: false,
      phase: 'prepare',
    });

    // Create prepare message
    const prepare = this.crypto.createPrepare(
      this.config.nodeId,
      view,
      sequence,
      digest
    );

    this.currentState = {
      view,
      sequence,
      phase: 'prepare',
      request,
    };

    if (this.config.debug) {
      console.log(`[Consensus] Sending PREPARE for sequence ${sequence}`);
    }

    return prepare;
  }

  /**
   * Handle received prepare message
   */
  async handlePrepare(prepare: PrepareMessage): Promise<CommitMessage | null> {
    const { view, sequence, digest, nodeId } = prepare;

    // Verify prepare message
    if (!this.verifyPrepare(prepare)) {
      if (this.config.debug) {
        console.log(`[Consensus] Invalid prepare from ${nodeId} for sequence ${sequence}`);
      }
      return null;
    }

    const state = this.pendingRequests.get(sequence);
    if (!state) {
      return null; // Haven't seen pre-prepare yet
    }

    // Record prepare
    state.prepares.set(nodeId, prepare);

    // Check if we have 2f+1 prepares (including our own)
    const quorum = this.viewManager.getQuorumSize();
    if (state.prepares.size >= quorum - 1 && !state.preparedCertificate) {
      state.preparedCertificate = true;
      state.phase = 'commit';

      // Create commit message
      const commit = this.crypto.createCommit(
        this.config.nodeId,
        view,
        sequence,
        digest
      );

      this.currentState.phase = 'commit';

      if (this.config.debug) {
        console.log(
          `[Consensus] PREPARED certificate obtained for sequence ${sequence} ` +
          `(${state.prepares.size + 1}/${quorum} prepares)`
        );
        console.log(`[Consensus] Sending COMMIT for sequence ${sequence}`);
      }

      return commit;
    }

    return null;
  }

  /**
   * Handle received commit message
   */
  async handleCommit(commit: CommitMessage): Promise<boolean> {
    const { view, sequence, digest, nodeId } = commit;

    // Verify commit message
    if (!this.verifyCommit(commit)) {
      if (this.config.debug) {
        console.log(`[Consensus] Invalid commit from ${nodeId} for sequence ${sequence}`);
      }
      return false;
    }

    const state = this.pendingRequests.get(sequence);
    if (!state || !state.preparedCertificate) {
      return false; // Need prepared certificate first
    }

    // Record commit
    state.commits.set(nodeId, commit);

    // Check if we have 2f+1 commits (including our own)
    const quorum = this.viewManager.getQuorumSize();
    if (state.commits.size >= quorum - 1 && !state.committedLocal) {
      state.committedLocal = true;
      state.phase = 'committed';

      // Execute the request
      await this.executeRequest(state.request);

      this.currentState.phase = 'committed';

      if (this.config.debug) {
        console.log(
          `[Consensus] COMMITTED sequence ${sequence} ` +
          `(${state.commits.size + 1}/${quorum} commits)`
        );
      }

      // Check if checkpoint needed
      if (this.checkpointManager.shouldCreateCheckpoint(sequence)) {
        const stateDigest = this.computeStateDigest();
        const checkpoint = this.crypto.createCheckpoint(
          this.config.nodeId,
          sequence,
          stateDigest
        );
        this.checkpointManager.recordCheckpoint(checkpoint);
      }

      // Clean up old request
      this.pendingRequests.delete(sequence);
      this.executedRequests.add(sequence);

      return true;
    }

    return false;
  }

  /**
   * Execute committed request
   */
  private async executeRequest(request: RequestMessage): Promise<void> {
    if (this.config.debug) {
      console.log(`[Consensus] EXECUTING request ${request.requestId}`);
    }

    // Execute the operation (application-specific)
    const result = await this.applyOperation(request.operation);

    // Notify callback
    if (this.onCommitCallback) {
      this.onCommitCallback(request, result);
    }

    // Record activity for view manager
    this.viewManager.recordActivity();
  }

  /**
   * Apply operation to state machine (application-specific)
   * Override this for your application
   */
  protected async applyOperation(operation: any): Promise<any> {
    // Default implementation - override in subclass
    return { success: true, operation };
  }

  /**
   * Compute digest of current state
   */
  private computeStateDigest(): string {
    // In production, this would hash the actual state
    const state = {
      sequence: this.sequenceNumber,
      executed: Array.from(this.executedRequests),
    };
    return MessageCrypto.computeDigest(state);
  }

  /**
   * Verify pre-prepare message
   */
  private verifyPrePrepare(prePrepare: PrePrepareMessage): boolean {
    const { view, sequence, digest, request, nodeId, signature } = prePrepare;

    // Check view matches
    if (view !== this.viewManager.getCurrentView()) {
      return false;
    }

    // Check from primary
    if (!this.viewManager.isPrimary(nodeId)) {
      return false;
    }

    // Verify digest
    const computedDigest = MessageCrypto.computeDigest(request);
    if (digest !== computedDigest) {
      return false;
    }

    // Verify signature - SECURITY: Must reject if public key or signature missing
    const publicKey = this.publicKeys.get(nodeId);
    if (!publicKey || !signature) {
      console.warn(`[ConsensusProtocol] Missing public key or signature for node ${nodeId}`);
      return false;
    }

    return MessageCrypto.verifySignature(prePrepare, signature, publicKey);
  }

  /**
   * Verify prepare message
   */
  private verifyPrepare(prepare: PrepareMessage): boolean {
    const { view, nodeId, signature } = prepare;

    // Check view matches
    if (view !== this.viewManager.getCurrentView()) {
      return false;
    }

    // Verify signature - SECURITY: Must reject if public key or signature missing
    const publicKey = this.publicKeys.get(nodeId);
    if (!publicKey || !signature) {
      console.warn(`[ConsensusProtocol] Missing public key or signature for node ${nodeId}`);
      return false;
    }

    return MessageCrypto.verifySignature(prepare, signature, publicKey);
  }

  /**
   * Verify commit message
   */
  private verifyCommit(commit: CommitMessage): boolean {
    const { view, nodeId, signature } = commit;

    // Check view matches
    if (view !== this.viewManager.getCurrentView()) {
      return false;
    }

    // Verify signature - SECURITY: Must reject if public key or signature missing
    const publicKey = this.publicKeys.get(nodeId);
    if (!publicKey || !signature) {
      console.warn(`[ConsensusProtocol] Missing public key or signature for node ${nodeId}`);
      return false;
    }

    return MessageCrypto.verifySignature(commit, signature, publicKey);
  }

  /**
   * Register callback for committed requests
   */
  onCommit(callback: (request: RequestMessage, result: any) => void): void {
    this.onCommitCallback = callback;
  }

  /**
   * Register callback for view changes
   */
  onViewChange(callback: (newView: number) => void): void {
    this.onViewChangeCallback = callback;
  }

  /**
   * Get consensus metrics
   */
  getMetrics(): {
    currentSequence: number;
    pendingRequests: number;
    executedRequests: number;
    currentView: number;
  } {
    return {
      currentSequence: this.sequenceNumber,
      pendingRequests: this.pendingRequests.size,
      executedRequests: this.executedRequests.size,
      currentView: this.viewManager.getCurrentView(),
    };
  }
}
