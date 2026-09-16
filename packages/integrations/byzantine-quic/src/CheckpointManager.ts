/**
 * Checkpoint Manager
 *
 * Manages stable checkpoints and garbage collection in Byzantine consensus
 * Implements periodic checkpointing for state consistency and old message cleanup
 */

import { CheckpointMessage } from './MessageTypes.js';

export interface CheckpointConfig {
  /** Checkpoint every N operations */
  checkpointInterval: number;
  /** Minimum number of matching checkpoints for stability */
  stabilityThreshold: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface StableCheckpoint {
  sequence: number;
  stateDigest: string;
  proofs: CheckpointMessage[];
  timestamp: number;
}

/**
 * Manages checkpoints and garbage collection
 */
export class CheckpointManager {
  private config: Required<CheckpointConfig>;
  private lastCheckpointSequence: number = 0;
  private stableCheckpoint: StableCheckpoint | null = null;
  private pendingCheckpoints: Map<number, Map<string, CheckpointMessage>> = new Map();

  constructor(config: CheckpointConfig) {
    this.config = {
      ...config,
      debug: config.debug ?? false,
    };
  }

  /**
   * Check if checkpoint should be created for given sequence
   */
  shouldCreateCheckpoint(sequence: number): boolean {
    return (
      sequence > 0 &&
      sequence % this.config.checkpointInterval === 0 &&
      sequence > this.lastCheckpointSequence
    );
  }

  /**
   * Record checkpoint message from a node
   */
  recordCheckpoint(checkpoint: CheckpointMessage): void {
    const { sequence, nodeId, stateDigest } = checkpoint;

    // Get or create checkpoint entry
    if (!this.pendingCheckpoints.has(sequence)) {
      this.pendingCheckpoints.set(sequence, new Map());
    }

    const checkpointSet = this.pendingCheckpoints.get(sequence)!;
    checkpointSet.set(nodeId, checkpoint);

    if (this.config.debug) {
      console.log(
        `[CheckpointManager] Recorded checkpoint from ${nodeId} ` +
        `at sequence ${sequence}, digest: ${stateDigest.substring(0, 8)}...`
      );
      console.log(
        `[CheckpointManager] Have ${checkpointSet.size}/${this.config.stabilityThreshold} ` +
        `checkpoints for sequence ${sequence}`
      );
    }

    // Check if this checkpoint is now stable
    this.checkStability(sequence);
  }

  /**
   * Check if checkpoint has reached stability threshold
   */
  private checkStability(sequence: number): void {
    const checkpointSet = this.pendingCheckpoints.get(sequence);
    if (!checkpointSet || checkpointSet.size < this.config.stabilityThreshold) {
      return;
    }

    // Group by state digest
    const digestGroups = new Map<string, CheckpointMessage[]>();
    for (const checkpoint of checkpointSet.values()) {
      if (!digestGroups.has(checkpoint.stateDigest)) {
        digestGroups.set(checkpoint.stateDigest, []);
      }
      digestGroups.get(checkpoint.stateDigest)!.push(checkpoint);
    }

    // Find digest with most matching checkpoints
    let maxGroup: CheckpointMessage[] = [];
    for (const group of digestGroups.values()) {
      if (group.length > maxGroup.length) {
        maxGroup = group;
      }
    }

    // Check if we have enough matching checkpoints for stability
    if (maxGroup.length >= this.config.stabilityThreshold) {
      this.markStable(sequence, maxGroup);
    }
  }

  /**
   * Mark checkpoint as stable
   */
  private markStable(sequence: number, proofs: CheckpointMessage[]): void {
    const stateDigest = proofs[0].stateDigest;

    // Only update if this is a newer stable checkpoint
    if (!this.stableCheckpoint || sequence > this.stableCheckpoint.sequence) {
      this.stableCheckpoint = {
        sequence,
        stateDigest,
        proofs,
        timestamp: Date.now(),
      };

      this.lastCheckpointSequence = sequence;

      if (this.config.debug) {
        console.log(
          `[CheckpointManager] Checkpoint ${sequence} is now STABLE ` +
          `with ${proofs.length} matching proofs`
        );
        console.log(
          `[CheckpointManager] State digest: ${stateDigest.substring(0, 16)}...`
        );
      }

      // Garbage collect old checkpoints
      this.garbageCollect(sequence);
    }
  }

  /**
   * Get last stable checkpoint
   */
  getStableCheckpoint(): StableCheckpoint | null {
    return this.stableCheckpoint;
  }

  /**
   * Get last stable checkpoint sequence number
   */
  getLastStableSequence(): number {
    return this.stableCheckpoint?.sequence ?? 0;
  }

  /**
   * Check if sequence is before last stable checkpoint
   */
  isBeforeStableCheckpoint(sequence: number): boolean {
    return this.stableCheckpoint !== null && sequence < this.stableCheckpoint.sequence;
  }

  /**
   * Garbage collect checkpoints and messages before stable checkpoint
   */
  private garbageCollect(stableSequence: number): void {
    let deletedCount = 0;

    // Remove all pending checkpoints before stable one
    for (const sequence of this.pendingCheckpoints.keys()) {
      if (sequence < stableSequence) {
        this.pendingCheckpoints.delete(sequence);
        deletedCount++;
      }
    }

    if (this.config.debug && deletedCount > 0) {
      console.log(
        `[CheckpointManager] Garbage collected ${deletedCount} old checkpoint(s) ` +
        `before sequence ${stableSequence}`
      );
    }
  }

  /**
   * Get checkpoint statistics
   */
  getStats(): {
    lastStableSequence: number;
    pendingCheckpoints: number;
    oldestPending: number | null;
  } {
    const sequences = Array.from(this.pendingCheckpoints.keys());
    return {
      lastStableSequence: this.getLastStableSequence(),
      pendingCheckpoints: this.pendingCheckpoints.size,
      oldestPending: sequences.length > 0 ? Math.min(...sequences) : null,
    };
  }

  /**
   * Export stable checkpoint for state transfer
   */
  exportCheckpoint(): StableCheckpoint | null {
    return this.stableCheckpoint ? { ...this.stableCheckpoint } : null;
  }

  /**
   * Import checkpoint (for recovering nodes)
   */
  importCheckpoint(checkpoint: StableCheckpoint): void {
    if (!this.stableCheckpoint || checkpoint.sequence > this.stableCheckpoint.sequence) {
      this.stableCheckpoint = { ...checkpoint };
      this.lastCheckpointSequence = checkpoint.sequence;

      if (this.config.debug) {
        console.log(
          `[CheckpointManager] Imported stable checkpoint at sequence ${checkpoint.sequence}`
        );
      }

      // Clean up old state
      this.garbageCollect(checkpoint.sequence);
    }
  }

  /**
   * Reset checkpoint state
   */
  reset(): void {
    this.lastCheckpointSequence = 0;
    this.stableCheckpoint = null;
    this.pendingCheckpoints.clear();

    if (this.config.debug) {
      console.log('[CheckpointManager] Reset all checkpoint state');
    }
  }
}
