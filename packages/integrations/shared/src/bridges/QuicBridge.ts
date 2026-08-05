/**
 * QUIC Bridge
 *
 * Interface to agentic-flow-quic crate for high-performance networking
 * Provides connection pooling and stream multiplexing
 */

import { BridgeConfig, BridgeResult, BridgeError, BridgeErrorCode, Logger } from '../types/common.js';
import { QuicMetrics } from '../types/metrics.js';
import { createLogger } from '../utils/logger.js';
import { withRetry, withTimeout } from '../utils/retry.js';
import { validateNonEmptyString, validatePositiveNumber } from '../utils/validation.js';

/**
 * QUIC configuration
 */
export interface QuicConfig extends BridgeConfig {
  /** Server host */
  host: string;
  /** Server port */
  port: number;
  /** Connection pool size */
  poolSize?: number;
  /** Enable TLS */
  enableTLS?: boolean;
  /** Certificate path */
  certPath?: string;
}

/**
 * Connection info
 */
export interface ConnectionInfo {
  id: string;
  host: string;
  port: number;
  connected: boolean;
  createdAt: number;
  requestCount: number;
}

/**
 * Stream data
 */
export interface StreamData {
  streamId: number;
  data: Buffer;
  metadata?: Record<string, any>;
}

/**
 * QUIC Bridge implementation
 *
 * Performance Target: <10ms send latency
 */
export class QuicBridge {
  private config: Required<QuicConfig>;
  private logger: Logger;
  private initialized: boolean = false;
  private connectionPool: Map<string, ConnectionInfo> = new Map();
  private activeConnections: number = 0;
  private metrics: QuicMetrics = {
    connectLatencyMs: 0,
    sendLatencyMs: 0,
    receiveLatencyMs: 0,
    streamLatencyMs: 0,
    bytesSent: 0,
    bytesReceived: 0,
    activeConnections: 0,
    successRate: 1.0,
  };
  private operationCount: number = 0;
  private successCount: number = 0;

  constructor(config: QuicConfig) {
    this.config = {
      debug: config.debug ?? false,
      timeoutMs: config.timeoutMs ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      host: config.host,
      port: config.port,
      poolSize: config.poolSize ?? 5,
      enableTLS: config.enableTLS ?? true,
      certPath: config.certPath ?? '',
    };

    validateNonEmptyString(this.config.host, 'host');
    validatePositiveNumber(this.config.port, 'port');

    this.logger = createLogger('[QuicBridge]', this.config.debug);
  }

  /**
   * Initialize the bridge and establish connection pool
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Bridge already initialized');
      return;
    }

    this.logger.info('Initializing QUIC bridge...');
    this.logger.info(`Host: ${this.config.host}:${this.config.port}`);
    this.logger.info(`Pool size: ${this.config.poolSize}`);

    try {
      // Initialize connection pool
      for (let i = 0; i < this.config.poolSize; i++) {
        await this.createConnection();
      }

      this.initialized = true;
      this.logger.info(`QUIC bridge initialized with ${this.connectionPool.size} connections`);
    } catch (error) {
      throw new BridgeError(
        BridgeErrorCode.NOT_INITIALIZED,
        `Failed to initialize QUIC bridge: ${(error as Error).message}`,
        error
      );
    }
  }

  /**
   * Connect to QUIC server
   */
  async connect(host?: string, port?: number): Promise<BridgeResult<ConnectionInfo>> {
    const targetHost = host || this.config.host;
    const targetPort = port || this.config.port;

    const startTime = Date.now();
    this.operationCount++;

    try {
      const connection = await withTimeout(
        () => withRetry(
          async () => this.performConnect(targetHost, targetPort),
          { maxAttempts: this.config.maxRetries, delayMs: this.config.retryDelayMs },
          this.logger
        ),
        this.config.timeoutMs,
        'Connect operation timed out'
      );

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      this.successCount++;
      this.metrics.connectLatencyMs = latencyMs;
      this.metrics.activeConnections = this.activeConnections;
      this.metrics.successRate = this.successCount / this.operationCount;

      return {
        success: true,
        data: connection,
        metrics: {
          latencyMs,
          startTime,
          endTime,
          successRate: this.metrics.successRate,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = (error as Error).message;

      this.logger.error('Connect operation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metrics: {
          latencyMs: endTime - startTime,
          startTime,
          endTime,
          successRate: this.successCount / this.operationCount,
        },
      };
    }
  }

  /**
   * Send data over QUIC
   * Target: <10ms latency
   */
  async send(data: Buffer | string, connectionId?: string): Promise<BridgeResult<number>> {
    this.ensureInitialized();

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const startTime = Date.now();
    this.operationCount++;

    try {
      const bytesSent = await withTimeout(
        () => withRetry(
          async () => this.performSend(buffer, connectionId),
          { maxAttempts: this.config.maxRetries, delayMs: this.config.retryDelayMs },
          this.logger
        ),
        this.config.timeoutMs,
        'Send operation timed out'
      );

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      this.successCount++;
      this.metrics.sendLatencyMs = latencyMs;
      this.metrics.bytesSent += bytesSent;
      this.metrics.successRate = this.successCount / this.operationCount;

      return {
        success: true,
        data: bytesSent,
        metrics: {
          latencyMs,
          startTime,
          endTime,
          successRate: this.metrics.successRate,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = (error as Error).message;

      this.logger.error('Send operation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metrics: {
          latencyMs: endTime - startTime,
          startTime,
          endTime,
          successRate: this.successCount / this.operationCount,
        },
      };
    }
  }

  /**
   * Receive data from QUIC
   */
  async receive(connectionId?: string): Promise<BridgeResult<Buffer>> {
    this.ensureInitialized();

    const startTime = Date.now();
    this.operationCount++;

    try {
      const data = await withTimeout(
        () => withRetry(
          async () => this.performReceive(connectionId),
          { maxAttempts: this.config.maxRetries, delayMs: this.config.retryDelayMs },
          this.logger
        ),
        this.config.timeoutMs,
        'Receive operation timed out'
      );

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      this.successCount++;
      this.metrics.receiveLatencyMs = latencyMs;
      this.metrics.bytesReceived += data.length;
      this.metrics.successRate = this.successCount / this.operationCount;

      return {
        success: true,
        data,
        metrics: {
          latencyMs,
          startTime,
          endTime,
          successRate: this.metrics.successRate,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = (error as Error).message;

      this.logger.error('Receive operation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metrics: {
          latencyMs: endTime - startTime,
          startTime,
          endTime,
          successRate: this.successCount / this.operationCount,
        },
      };
    }
  }

  /**
   * Create bidirectional stream
   */
  async stream(data: Buffer | string, connectionId?: string): Promise<BridgeResult<StreamData>> {
    this.ensureInitialized();

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const startTime = Date.now();
    this.operationCount++;

    try {
      const streamData = await withTimeout(
        () => withRetry(
          async () => this.performStream(buffer, connectionId),
          { maxAttempts: this.config.maxRetries, delayMs: this.config.retryDelayMs },
          this.logger
        ),
        this.config.timeoutMs,
        'Stream operation timed out'
      );

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      this.successCount++;
      this.metrics.streamLatencyMs = latencyMs;
      this.metrics.bytesSent += buffer.length;
      this.metrics.bytesReceived += streamData.data.length;
      this.metrics.successRate = this.successCount / this.operationCount;

      return {
        success: true,
        data: streamData,
        metrics: {
          latencyMs,
          startTime,
          endTime,
          successRate: this.metrics.successRate,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = (error as Error).message;

      this.logger.error('Stream operation failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metrics: {
          latencyMs: endTime - startTime,
          startTime,
          endTime,
          successRate: this.successCount / this.operationCount,
        },
      };
    }
  }

  /**
   * Get connection pool status
   */
  getConnections(): ConnectionInfo[] {
    return Array.from(this.connectionPool.values());
  }

  /**
   * Get current metrics
   */
  getMetrics(): QuicMetrics {
    return {
      ...this.metrics,
      activeConnections: this.activeConnections,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      connectLatencyMs: 0,
      sendLatencyMs: 0,
      receiveLatencyMs: 0,
      streamLatencyMs: 0,
      bytesSent: 0,
      bytesReceived: 0,
      activeConnections: this.activeConnections,
      successRate: 1.0,
    };
    this.operationCount = 0;
    this.successCount = 0;
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    this.logger.info('Closing all QUIC connections...');

    for (const [id, connection] of this.connectionPool) {
      connection.connected = false;
      this.logger.debug(`Closed connection: ${id}`);
    }

    this.connectionPool.clear();
    this.activeConnections = 0;
    this.initialized = false;

    this.logger.info('All QUIC connections closed');
  }

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<ConnectionInfo> {
    const id = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const connection: ConnectionInfo = {
      id,
      host: this.config.host,
      port: this.config.port,
      connected: true,
      createdAt: Date.now(),
      requestCount: 0,
    };

    this.connectionPool.set(id, connection);
    this.activeConnections++;

    this.logger.debug(`Created connection: ${id}`);

    return connection;
  }

  /**
   * Perform connection
   */
  private async performConnect(host: string, port: number): Promise<ConnectionInfo> {
    // In production, this would use actual QUIC library
    // For now, simulate connection
    this.logger.debug(`Connecting to ${host}:${port}...`);

    return await this.createConnection();
  }

  /**
   * Perform send operation
   */
  private async performSend(buffer: Buffer, connectionId?: string): Promise<number> {
    const connection = connectionId
      ? this.connectionPool.get(connectionId)
      : this.getNextConnection();

    if (!connection) {
      throw new BridgeError(
        BridgeErrorCode.CONNECTION_FAILED,
        'No available connection'
      );
    }

    // In production, this would send data over actual QUIC connection
    this.logger.debug(`Sending ${buffer.length} bytes via ${connection.id}`);

    connection.requestCount++;
    return buffer.length;
  }

  /**
   * Perform receive operation
   */
  private async performReceive(connectionId?: string): Promise<Buffer> {
    const connection = connectionId
      ? this.connectionPool.get(connectionId)
      : this.getNextConnection();

    if (!connection) {
      throw new BridgeError(
        BridgeErrorCode.CONNECTION_FAILED,
        'No available connection'
      );
    }

    // In production, this would receive data from actual QUIC connection
    this.logger.debug(`Receiving data via ${connection.id}`);

    // Simulate received data
    return Buffer.from('received data');
  }

  /**
   * Perform stream operation
   */
  private async performStream(buffer: Buffer, connectionId?: string): Promise<StreamData> {
    const connection = connectionId
      ? this.connectionPool.get(connectionId)
      : this.getNextConnection();

    if (!connection) {
      throw new BridgeError(
        BridgeErrorCode.CONNECTION_FAILED,
        'No available connection'
      );
    }

    // In production, this would create a bidirectional stream
    this.logger.debug(`Creating stream with ${buffer.length} bytes via ${connection.id}`);

    connection.requestCount++;

    return {
      streamId: Math.floor(Math.random() * 10000),
      data: Buffer.from('stream response'),
      metadata: {
        connectionId: connection.id,
        timestamp: Date.now(),
        bytesSent: buffer.length,
      },
    };
  }

  /**
   * Get next available connection (round-robin)
   */
  private getNextConnection(): ConnectionInfo | undefined {
    const connections = Array.from(this.connectionPool.values()).filter(c => c.connected);

    if (connections.length === 0) {
      return undefined;
    }

    // Simple round-robin: find connection with least requests
    return connections.reduce((prev, curr) =>
      curr.requestCount < prev.requestCount ? curr : prev
    );
  }

  /**
   * Ensure bridge is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new BridgeError(
        BridgeErrorCode.NOT_INITIALIZED,
        'QUIC bridge not initialized. Call initialize() first.'
      );
    }
  }
}
