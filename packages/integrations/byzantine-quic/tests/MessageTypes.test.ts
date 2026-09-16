/**
 * Message Types Tests
 *
 * Tests cryptographic message signing and verification
 */

import { MessageCrypto, MessageType, MessageCrypto as MC } from '../src/MessageTypes.js';

describe('MessageTypes', () => {
  describe('MessageCrypto', () => {
    it('should generate key pair', () => {
      const crypto = new MessageCrypto();
      const publicKey = crypto.getPublicKey();

      expect(publicKey).toBeDefined();
      expect(publicKey.length).toBeGreaterThan(0);
      expect(publicKey).toContain('BEGIN PUBLIC KEY');
    });

    it('should compute consistent digest for same data', () => {
      const data = { foo: 'bar', num: 42 };

      const digest1 = MC.computeDigest(data);
      const digest2 = MC.computeDigest(data);

      expect(digest1).toBe(digest2);
      expect(digest1).toHaveLength(64); // SHA-256 hex string
    });

    it('should compute different digests for different data', () => {
      const data1 = { foo: 'bar' };
      const data2 = { foo: 'baz' };

      const digest1 = MC.computeDigest(data1);
      const digest2 = MC.computeDigest(data2);

      expect(digest1).not.toBe(digest2);
    });

    it('should sign and verify request message', () => {
      const crypto = new MessageCrypto();
      const publicKey = crypto.getPublicKey();

      const request = crypto.createRequest(
        'node-1',
        'client-1',
        1,
        { type: 'SET', key: 'x', value: 10 }
      );

      expect(request.type).toBe(MessageType.REQUEST);
      expect(request.signature).toBeDefined();
      expect(request.nodeId).toBe('node-1');
      expect(request.clientId).toBe('client-1');
      expect(request.requestId).toBe(1);

      // Verify signature
      const isValid = MC.verifySignature(request, request.signature!, publicKey);
      expect(isValid).toBe(true);
    });

    it('should sign and verify pre-prepare message', () => {
      const crypto = new MessageCrypto();
      const publicKey = crypto.getPublicKey();

      const request = crypto.createRequest('node-1', 'client-1', 1, { op: 'test' });
      const prePrepare = crypto.createPrePrepare('node-0', 0, 1, request);

      expect(prePrepare.type).toBe(MessageType.PRE_PREPARE);
      expect(prePrepare.signature).toBeDefined();
      expect(prePrepare.view).toBe(0);
      expect(prePrepare.sequence).toBe(1);
      expect(prePrepare.digest).toBe(MC.computeDigest(request));

      // Verify signature
      const isValid = MC.verifySignature(prePrepare, prePrepare.signature!, publicKey);
      expect(isValid).toBe(true);
    });

    it('should sign and verify prepare message', () => {
      const crypto = new MessageCrypto();
      const publicKey = crypto.getPublicKey();

      const digest = MC.computeDigest({ data: 'test' });
      const prepare = crypto.createPrepare('node-1', 0, 1, digest);

      expect(prepare.type).toBe(MessageType.PREPARE);
      expect(prepare.signature).toBeDefined();
      expect(prepare.view).toBe(0);
      expect(prepare.sequence).toBe(1);
      expect(prepare.digest).toBe(digest);

      // Verify signature
      const isValid = MC.verifySignature(prepare, prepare.signature!, publicKey);
      expect(isValid).toBe(true);
    });

    it('should sign and verify commit message', () => {
      const crypto = new MessageCrypto();
      const publicKey = crypto.getPublicKey();

      const digest = MC.computeDigest({ data: 'test' });
      const commit = crypto.createCommit('node-2', 0, 1, digest);

      expect(commit.type).toBe(MessageType.COMMIT);
      expect(commit.signature).toBeDefined();
      expect(commit.view).toBe(0);
      expect(commit.sequence).toBe(1);
      expect(commit.digest).toBe(digest);

      // Verify signature
      const isValid = MC.verifySignature(commit, commit.signature!, publicKey);
      expect(isValid).toBe(true);
    });

    it('should sign and verify checkpoint message', () => {
      const crypto = new MessageCrypto();
      const publicKey = crypto.getPublicKey();

      const stateDigest = MC.computeDigest({ state: 'checkpoint' });
      const checkpoint = crypto.createCheckpoint('node-3', 100, stateDigest);

      expect(checkpoint.type).toBe(MessageType.CHECKPOINT);
      expect(checkpoint.signature).toBeDefined();
      expect(checkpoint.sequence).toBe(100);
      expect(checkpoint.stateDigest).toBe(stateDigest);

      // Verify signature
      const isValid = MC.verifySignature(checkpoint, checkpoint.signature!, publicKey);
      expect(isValid).toBe(true);
    });

    it('should reject message with invalid signature', () => {
      const crypto = new MessageCrypto();
      const publicKey = crypto.getPublicKey();

      const request = crypto.createRequest('node-1', 'client-1', 1, { op: 'test' });

      // Tamper with signature
      const tamperedSignature = 'INVALID_SIGNATURE';

      const isValid = MC.verifySignature(request, tamperedSignature, publicKey);
      expect(isValid).toBe(false);
    });

    it('should reject message signed by different key', () => {
      const crypto1 = new MessageCrypto();
      const crypto2 = new MessageCrypto();

      const request = crypto1.createRequest('node-1', 'client-1', 1, { op: 'test' });
      const publicKey2 = crypto2.getPublicKey();

      // Verify with different public key should fail
      const isValid = MC.verifySignature(request, request.signature!, publicKey2);
      expect(isValid).toBe(false);
    });
  });
});
