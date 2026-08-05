/**
 * Message Types for Byzantine Consensus
 *
 * Implements PBFT (Practical Byzantine Fault Tolerance) message protocol
 * All messages include cryptographic signatures for authentication
 */

import { createHash, sign, verify, generateKeyPairSync, KeyObject } from 'crypto';

/**
 * Message types in PBFT protocol
 */
export enum MessageType {
  REQUEST = 'REQUEST',
  PRE_PREPARE = 'PRE_PREPARE',
  PREPARE = 'PREPARE',
  COMMIT = 'COMMIT',
  REPLY = 'REPLY',
  VIEW_CHANGE = 'VIEW_CHANGE',
  NEW_VIEW = 'NEW_VIEW',
  CHECKPOINT = 'CHECKPOINT',
}

/**
 * Base message structure
 */
export interface BaseMessage {
  type: MessageType;
  nodeId: string;
  timestamp: number;
  signature?: string;
}

/**
 * Client request to execute an operation
 */
export interface RequestMessage extends BaseMessage {
  type: MessageType.REQUEST;
  operation: any;
  clientId: string;
  requestId: number;
}

/**
 * Pre-prepare message from primary
 * Proposes order for client request
 */
export interface PrePrepareMessage extends BaseMessage {
  type: MessageType.PRE_PREPARE;
  view: number;
  sequence: number;
  digest: string;
  request: RequestMessage;
}

/**
 * Prepare message from replicas
 * Agrees with proposed order
 */
export interface PrepareMessage extends BaseMessage {
  type: MessageType.PREPARE;
  view: number;
  sequence: number;
  digest: string;
}

/**
 * Commit message from replicas
 * Ready to commit the operation
 */
export interface CommitMessage extends BaseMessage {
  type: MessageType.COMMIT;
  view: number;
  sequence: number;
  digest: string;
}

/**
 * Reply to client with operation result
 */
export interface ReplyMessage extends BaseMessage {
  type: MessageType.REPLY;
  view: number;
  requestId: number;
  result: any;
}

/**
 * View change message
 * Triggered when primary is suspected to be faulty
 */
export interface ViewChangeMessage extends BaseMessage {
  type: MessageType.VIEW_CHANGE;
  newView: number;
  lastStableCheckpoint: number;
  checkpointProof: CheckpointMessage[];
  preparedCertificates: PreparedCertificate[];
}

/**
 * New view message from new primary
 */
export interface NewViewMessage extends BaseMessage {
  type: MessageType.NEW_VIEW;
  newView: number;
  viewChangeProof: ViewChangeMessage[];
  prePrepareMessages: PrePrepareMessage[];
}

/**
 * Checkpoint message for garbage collection
 */
export interface CheckpointMessage extends BaseMessage {
  type: MessageType.CHECKPOINT;
  sequence: number;
  stateDigest: string;
}

/**
 * Prepared certificate for view change
 */
export interface PreparedCertificate {
  prePrepare: PrePrepareMessage;
  prepares: PrepareMessage[];
}

/**
 * Union type for all messages
 */
export type ConsensusMessage =
  | RequestMessage
  | PrePrepareMessage
  | PrepareMessage
  | CommitMessage
  | ReplyMessage
  | ViewChangeMessage
  | NewViewMessage
  | CheckpointMessage;

/**
 * Message crypto utilities
 */
export class MessageCrypto {
  private privateKey: KeyObject;
  private publicKey: KeyObject;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  /**
   * Get public key in PEM format
   */
  getPublicKey(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  /**
   * Compute digest of message payload
   */
  static computeDigest(data: any): string {
    const json = JSON.stringify(data);
    return createHash('sha256').update(json).digest('hex');
  }

  /**
   * Sign a message
   */
  signMessage(message: BaseMessage): string {
    const { signature, ...messageWithoutSig } = message;
    const data = Buffer.from(JSON.stringify(messageWithoutSig));
    return sign(null, data, this.privateKey).toString('base64');
  }

  /**
   * Verify message signature
   */
  static verifySignature(
    message: BaseMessage,
    signature: string,
    publicKeyPem: string
  ): boolean {
    try {
      const { signature: _, ...messageWithoutSig } = message;
      const data = Buffer.from(JSON.stringify(messageWithoutSig));
      const signatureBuffer = Buffer.from(signature, 'base64');

      // Import public key
      const publicKey = {
        key: publicKeyPem,
        format: 'pem' as const,
        type: 'spki' as const,
      };

      return verify(null, data, publicKey, signatureBuffer);
    } catch (error) {
      return false;
    }
  }

  /**
   * Create signed request message
   */
  createRequest(
    nodeId: string,
    clientId: string,
    requestId: number,
    operation: any
  ): RequestMessage {
    const message: RequestMessage = {
      type: MessageType.REQUEST,
      nodeId,
      timestamp: Date.now(),
      operation,
      clientId,
      requestId,
    };
    message.signature = this.signMessage(message);
    return message;
  }

  /**
   * Create signed pre-prepare message
   */
  createPrePrepare(
    nodeId: string,
    view: number,
    sequence: number,
    request: RequestMessage
  ): PrePrepareMessage {
    const digest = MessageCrypto.computeDigest(request);
    const message: PrePrepareMessage = {
      type: MessageType.PRE_PREPARE,
      nodeId,
      timestamp: Date.now(),
      view,
      sequence,
      digest,
      request,
    };
    message.signature = this.signMessage(message);
    return message;
  }

  /**
   * Create signed prepare message
   */
  createPrepare(
    nodeId: string,
    view: number,
    sequence: number,
    digest: string
  ): PrepareMessage {
    const message: PrepareMessage = {
      type: MessageType.PREPARE,
      nodeId,
      timestamp: Date.now(),
      view,
      sequence,
      digest,
    };
    message.signature = this.signMessage(message);
    return message;
  }

  /**
   * Create signed commit message
   */
  createCommit(
    nodeId: string,
    view: number,
    sequence: number,
    digest: string
  ): CommitMessage {
    const message: CommitMessage = {
      type: MessageType.COMMIT,
      nodeId,
      timestamp: Date.now(),
      view,
      sequence,
      digest,
    };
    message.signature = this.signMessage(message);
    return message;
  }

  /**
   * Create signed checkpoint message
   */
  createCheckpoint(
    nodeId: string,
    sequence: number,
    stateDigest: string
  ): CheckpointMessage {
    const message: CheckpointMessage = {
      type: MessageType.CHECKPOINT,
      nodeId,
      timestamp: Date.now(),
      sequence,
      stateDigest,
    };
    message.signature = this.signMessage(message);
    return message;
  }
}
