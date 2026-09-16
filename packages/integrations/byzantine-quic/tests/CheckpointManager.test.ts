/**
 * Checkpoint Manager Tests
 *
 * Tests stable checkpoints and garbage collection
 */

import { CheckpointManager } from '../src/CheckpointManager.js';
import { MessageCrypto, MessageType } from '../src/MessageTypes.js';

describe('CheckpointManager', () => {
  const createCheckpointManager = (interval: number = 10, threshold: number = 3) => {
    return new CheckpointManager({
      checkpointInterval: interval,
      stabilityThreshold: threshold,
      debug: false,
    });
  };

  describe('Checkpoint Creation', () => {
    it('should determine when to create checkpoint', () => {
      const cm = createCheckpointManager(10, 3);

      expect(cm.shouldCreateCheckpoint(0)).toBe(false);
      expect(cm.shouldCreateCheckpoint(5)).toBe(false);
      expect(cm.shouldCreateCheckpoint(10)).toBe(true);
      expect(cm.shouldCreateCheckpoint(20)).toBe(true);
      expect(cm.shouldCreateCheckpoint(15)).toBe(false); // Not divisible by interval
    });

    it('should not recreate checkpoint for same sequence', () => {
      const cm = createCheckpointManager(10, 3);

      const crypto = new MessageCrypto();
      const checkpoint1 = crypto.createCheckpoint('node-0', 10, 'digest-10');

      cm.recordCheckpoint(checkpoint1);

      expect(cm.shouldCreateCheckpoint(10)).toBe(false); // Already created
    });
  });

  describe('Stable Checkpoints', () => {
    it('should mark checkpoint as stable with threshold signatures', () => {
      const cm = createCheckpointManager(10, 3); // Need 3 matching checkpoints

      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();
      const crypto3 = new MessageCrypto();

      const stateDigest = 'digest-10';

      // Record 3 matching checkpoints from different nodes
      cm.recordCheckpoint(crypto1.createCheckpoint('node-0', 10, stateDigest));
      expect(cm.getStableCheckpoint()).toBeNull(); // Not yet stable

      cm.recordCheckpoint(crypto2.createCheckpoint('node-1', 10, stateDigest));
      expect(cm.getStableCheckpoint()).toBeNull(); // Still not stable

      cm.recordCheckpoint(crypto3.createCheckpoint('node-2', 10, stateDigest));

      // Now stable with 3 matching checkpoints
      const stable = cm.getStableCheckpoint();
      expect(stable).not.toBeNull();
      expect(stable!.sequence).toBe(10);
      expect(stable!.stateDigest).toBe(stateDigest);
      expect(stable!.proofs).toHaveLength(3);
    });

    it('should not mark checkpoint stable with mismatched digests', () => {
      const cm = createCheckpointManager(10, 3);

      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();
      const crypto3 = new MessageCrypto();

      // Record checkpoints with different digests (Byzantine behavior)
      cm.recordCheckpoint(crypto1.createCheckpoint('node-0', 10, 'digest-A'));
      cm.recordCheckpoint(crypto2.createCheckpoint('node-1', 10, 'digest-B'));
      cm.recordCheckpoint(crypto3.createCheckpoint('node-2', 10, 'digest-C'));

      // Should not be stable (no matching set)
      expect(cm.getStableCheckpoint()).toBeNull();
    });

    it('should choose digest with most votes', () => {
      const cm = createCheckpointManager(10, 3);

      const cryptos = Array.from({ length: 5 }, () => new MessageCrypto());

      // 3 nodes agree on digest-A, 2 on digest-B
      cm.recordCheckpoint(cryptos[0].createCheckpoint('node-0', 10, 'digest-A'));
      cm.recordCheckpoint(cryptos[1].createCheckpoint('node-1', 10, 'digest-A'));
      cm.recordCheckpoint(cryptos[2].createCheckpoint('node-2', 10, 'digest-A'));
      cm.recordCheckpoint(cryptos[3].createCheckpoint('node-3', 10, 'digest-B'));
      cm.recordCheckpoint(cryptos[4].createCheckpoint('node-4', 10, 'digest-B'));

      // Should be stable with digest-A (3 votes >= threshold of 3)
      const stable = cm.getStableCheckpoint();
      expect(stable).not.toBeNull();
      expect(stable!.stateDigest).toBe('digest-A');
      expect(stable!.proofs).toHaveLength(3);
    });
  });

  describe('Garbage Collection', () => {
    it('should garbage collect old checkpoints', () => {
      const cm = createCheckpointManager(10, 2);

      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();

      // Create stable checkpoint at sequence 10
      cm.recordCheckpoint(crypto1.createCheckpoint('node-0', 10, 'digest-10'));
      cm.recordCheckpoint(crypto2.createCheckpoint('node-1', 10, 'digest-10'));

      expect(cm.getLastStableSequence()).toBe(10);

      // Record checkpoints at sequence 20
      cm.recordCheckpoint(crypto1.createCheckpoint('node-0', 20, 'digest-20'));
      cm.recordCheckpoint(crypto2.createCheckpoint('node-1', 20, 'digest-20'));

      // Old checkpoint at 10 should be garbage collected
      expect(cm.getLastStableSequence()).toBe(20);

      const stats = cm.getStats();
      expect(stats.lastStableSequence).toBe(20);
      expect(stats.pendingCheckpoints).toBe(0); // Old ones removed
    });

    it('should identify sequences before stable checkpoint', () => {
      const cm = createCheckpointManager(10, 2);

      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();

      cm.recordCheckpoint(crypto1.createCheckpoint('node-0', 100, 'digest-100'));
      cm.recordCheckpoint(crypto2.createCheckpoint('node-1', 100, 'digest-100'));

      expect(cm.isBeforeStableCheckpoint(50)).toBe(true);
      expect(cm.isBeforeStableCheckpoint(99)).toBe(true);
      expect(cm.isBeforeStableCheckpoint(100)).toBe(false);
      expect(cm.isBeforeStableCheckpoint(101)).toBe(false);
    });
  });

  describe('Checkpoint Import/Export', () => {
    it('should export stable checkpoint', () => {
      const cm = createCheckpointManager(10, 2);

      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();

      cm.recordCheckpoint(crypto1.createCheckpoint('node-0', 50, 'digest-50'));
      cm.recordCheckpoint(crypto2.createCheckpoint('node-1', 50, 'digest-50'));

      const exported = cm.exportCheckpoint();
      expect(exported).not.toBeNull();
      expect(exported!.sequence).toBe(50);
      expect(exported!.stateDigest).toBe('digest-50');
      expect(exported!.proofs).toHaveLength(2);
    });

    it('should import checkpoint for state transfer', () => {
      const cm = createCheckpointManager(10, 2);

      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();

      const checkpoint1 = crypto1.createCheckpoint('node-0', 75, 'digest-75');
      const checkpoint2 = crypto2.createCheckpoint('node-1', 75, 'digest-75');

      const importData = {
        sequence: 75,
        stateDigest: 'digest-75',
        proofs: [checkpoint1, checkpoint2],
        timestamp: Date.now(),
      };

      cm.importCheckpoint(importData);

      expect(cm.getLastStableSequence()).toBe(75);
      expect(cm.getStableCheckpoint()!.stateDigest).toBe('digest-75');
    });
  });

  describe('Statistics', () => {
    it('should provide checkpoint statistics', () => {
      const cm = createCheckpointManager(10, 2);

      const stats = cm.getStats();
      expect(stats.lastStableSequence).toBe(0);
      expect(stats.pendingCheckpoints).toBe(0);
      expect(stats.oldestPending).toBeNull();

      const crypto = new MessageCrypto();
      cm.recordCheckpoint(crypto.createCheckpoint('node-0', 10, 'digest-10'));

      const stats2 = cm.getStats();
      expect(stats2.pendingCheckpoints).toBe(1);
      expect(stats2.oldestPending).toBe(10);
    });
  });

  describe('Reset', () => {
    it('should reset all state', () => {
      const cm = createCheckpointManager(10, 2);

      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();

      cm.recordCheckpoint(crypto1.createCheckpoint('node-0', 10, 'digest-10'));
      cm.recordCheckpoint(crypto2.createCheckpoint('node-1', 10, 'digest-10'));

      expect(cm.getLastStableSequence()).toBe(10);

      cm.reset();

      expect(cm.getLastStableSequence()).toBe(0);
      expect(cm.getStableCheckpoint()).toBeNull();
      expect(cm.getStats().pendingCheckpoints).toBe(0);
    });
  });
});
