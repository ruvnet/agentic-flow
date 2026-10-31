// QUIC Transport Layer for Agentic Flow
// WebAssembly-based QUIC client/server with connection pooling and stream multiplexing

import { logger } from '../utils/logger.js';

export interface QuicConfig {
  // Server configuration
  host?: string;
  port?: number;
  certPath?: string;
  keyPath?: string;

  // Client configuration
  serverHost?: string;
  serverPort?: number;
  verifyPeer?: boolean;

  // Connection pool
  maxConnections?: number;
  connectionTimeout?: number;
  idleTimeout?: number;

  // Stream configuration
  maxConcurrentStreams?: number;
  streamTimeout?: number;

  // Performance tuning
  initialCongestionWindow?: number;
  maxDatagramSize?: number;
  enableEarlyData?: boolean;
}

export interface QuicConnection {
  id: string;
  remoteAddr: string;
  streamCount: number;
  createdAt: Date;
  lastActivity: Date;
}

export interface QuicStream {
  id: number;
  connectionId: string;
  send(data: Uint8Array): Promise<void>;
  receive(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface QuicStats {
  totalConnections: number;
  activeConnections: number;
  totalStreams: number;
  activeStreams: number;
  bytesReceived: number;
  bytesSent: number;
  packetsLost: number;
  rttMs: number;
}

/**
 * QUIC Client - Manages outbound QUIC connections and stream multiplexing
 */
export class QuicClient {
  private config: Required<QuicConfig>;
  private connections: Map<string, QuicConnection>;
  private wasmModule: any; // WASM module reference
  private initialized: boolean;

  constructor(config: QuicConfig = {}) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: config.port || 4433,
      certPath: config.certPath || './certs/cert.pem',
      keyPath: config.keyPath || './certs/key.pem',
      serverHost: config.serverHost || 'localhost',
      serverPort: config.serverPort || 4433,
      verifyPeer: config.verifyPeer ?? true,
      maxConnections: config.maxConnections || 100,
      connectionTimeout: config.connectionTimeout || 30000,
      idleTimeout: config.idleTimeout || 60000,
      maxConcurrentStreams: config.maxConcurrentStreams || 100,
      streamTimeout: config.streamTimeout || 30000,
      initialCongestionWindow: config.initialCongestionWindow || 10,
      maxDatagramSize: config.maxDatagramSize || 1200,
      enableEarlyData: config.enableEarlyData ?? true
    };
    this.connections = new Map();
    this.initialized = false;
  }

  /**
   * Initialize QUIC client with WASM module
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('QUIC client already initialized');
      return;
    }

    try {
      logger.info('Initializing QUIC client...', {
        serverHost: this.config.serverHost,
        serverPort: this.config.serverPort,
        verifyPeer: this.config.verifyPeer
      });

      // Load WASM module (implementation depends on WASM binding)
      // For now, this is a placeholder for the actual WASM loading
      this.wasmModule = await this.loadWasmModule();

      this.initialized = true;
      logger.info('QUIC client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize QUIC client', { error });
      throw error;
    }
  }

  /**
   * Connect to QUIC server
   */
  async connect(host?: string, port?: number): Promise<QuicConnection> {
    if (!this.initialized) {
      throw new Error('QUIC client not initialized. Call initialize() first.');
    }

    const targetHost = host || this.config.serverHost;
    const targetPort = port || this.config.serverPort;
    const connectionId = `${targetHost}:${targetPort}`;

    // Check if connection already exists
    if (this.connections.has(connectionId)) {
      const conn = this.connections.get(connectionId)!;
      conn.lastActivity = new Date();
      logger.debug('Reusing existing QUIC connection', { connectionId });
      return conn;
    }

    // Check connection pool limit
    if (this.connections.size >= this.config.maxConnections) {
      throw new Error(`Maximum connections (${this.config.maxConnections}) reached`);
    }

    try {
      logger.info('Establishing QUIC connection', { host: targetHost, port: targetPort });

      // Establish QUIC connection via WASM
      // This is a placeholder - actual implementation will use WASM bindings
      const connection: QuicConnection = {
        id: connectionId,
        remoteAddr: `${targetHost}:${targetPort}`,
        streamCount: 0,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      this.connections.set(connectionId, connection);
      logger.info('QUIC connection established', { connectionId });

      return connection;
    } catch (error) {
      logger.error('Failed to establish QUIC connection', { error, host: targetHost, port: targetPort });
      throw error;
    }
  }

  /**
   * Create bidirectional stream on connection
   */
  async createStream(connectionId: string): Promise<QuicStream> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    if (connection.streamCount >= this.config.maxConcurrentStreams) {
      throw new Error(`Maximum concurrent streams (${this.config.maxConcurrentStreams}) reached`);
    }

    const streamId = connection.streamCount++;
    connection.lastActivity = new Date();

    logger.debug('Creating QUIC stream', { connectionId, streamId });

    // Create stream via WASM
    const stream: QuicStream = {
      id: streamId,
      connectionId,
      send: async (data: Uint8Array) => {
        logger.debug('Sending data on stream', { connectionId, streamId, bytes: data.length });
        // WASM call to send data
        connection.lastActivity = new Date();
      },
      receive: async (): Promise<Uint8Array> => {
        logger.debug('Receiving data on stream', { connectionId, streamId });
        // WASM call to receive data
        connection.lastActivity = new Date();
        return new Uint8Array(); // Placeholder
      },
      close: async () => {
        logger.debug('Closing stream', { connectionId, streamId });
        connection.streamCount--;
        connection.lastActivity = new Date();
      }
    };

    return stream;
  }

  /**
   * Send HTTP/3 request over QUIC
   */
  async sendRequest(
    connectionId: string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: Uint8Array
  ): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> {
    const stream = await this.createStream(connectionId);

    try {
      // Encode HTTP/3 request
      const request = this.encodeHttp3Request(method, path, headers, body);
      await stream.send(request);

      // Receive HTTP/3 response
      const responseData = await stream.receive();
      const response = this.decodeHttp3Response(responseData);

      return response;
    } finally {
      await stream.close();
    }
  }

  /**
   * Close connection
   */
  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.warn('Connection not found', { connectionId });
      return;
    }

    logger.info('Closing QUIC connection', { connectionId });
    // WASM call to close connection
    this.connections.delete(connectionId);
  }

  /**
   * Close all connections and cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down QUIC client', { activeConnections: this.connections.size });

    for (const connectionId of this.connections.keys()) {
      await this.closeConnection(connectionId);
    }

    this.initialized = false;
  }

  /**
   * Get connection statistics
   */
  getStats(): QuicStats {
    return {
      totalConnections: this.connections.size,
      activeConnections: this.connections.size,
      totalStreams: Array.from(this.connections.values()).reduce((sum, c) => sum + c.streamCount, 0),
      activeStreams: Array.from(this.connections.values()).reduce((sum, c) => sum + c.streamCount, 0),
      bytesReceived: 0, // From WASM
      bytesSent: 0, // From WASM
      packetsLost: 0, // From WASM
      rttMs: 0 // From WASM
    };
  }

  /**
   * Load WASM module (placeholder)
   */
  private async loadWasmModule(): Promise<any> {
    // This will be implemented to load the actual WASM module
    // For now, return a mock object
    logger.debug('Loading QUIC WASM module...');
    return {};
  }

  /**
   * Encode HTTP/3 request (placeholder)
   */
  private encodeHttp3Request(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: Uint8Array
  ): Uint8Array {
    // HTTP/3 QPACK encoding will be implemented
    logger.debug('Encoding HTTP/3 request', { method, path, headers });
    return new Uint8Array();
  }

  /**
   * Decode HTTP/3 response (placeholder)
   */
  private decodeHttp3Response(data: Uint8Array): {
    status: number;
    headers: Record<string, string>;
    body: Uint8Array;
  } {
    // HTTP/3 QPACK decoding will be implemented
    logger.debug('Decoding HTTP/3 response', { bytes: data.length });
    return {
      status: 200,
      headers: {},
      body: new Uint8Array()
    };
  }
}

/**
 * QUIC Server - Listens for inbound QUIC connections
 */
export class QuicServer {
  private config: Required<QuicConfig>;
  private connections: Map<string, QuicConnection>;
  private wasmModule: any;
  private initialized: boolean;
  private listening: boolean;

  constructor(config: QuicConfig = {}) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: config.port || 4433,
      certPath: config.certPath || './certs/cert.pem',
      keyPath: config.keyPath || './certs/key.pem',
      serverHost: config.serverHost || 'localhost',
      serverPort: config.serverPort || 4433,
      verifyPeer: config.verifyPeer ?? false,
      maxConnections: config.maxConnections || 1000,
      connectionTimeout: config.connectionTimeout || 30000,
      idleTimeout: config.idleTimeout || 120000,
      maxConcurrentStreams: config.maxConcurrentStreams || 100,
      streamTimeout: config.streamTimeout || 30000,
      initialCongestionWindow: config.initialCongestionWindow || 10,
      maxDatagramSize: config.maxDatagramSize || 1200,
      enableEarlyData: config.enableEarlyData ?? false
    };
    this.connections = new Map();
    this.initialized = false;
    this.listening = false;
  }

  /**
   * Initialize QUIC server
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('QUIC server already initialized');
      return;
    }

    try {
      logger.info('Initializing QUIC server...', {
        host: this.config.host,
        port: this.config.port,
        certPath: this.config.certPath
      });

      // Load WASM module
      this.wasmModule = await this.loadWasmModule();

      this.initialized = true;
      logger.info('QUIC server initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize QUIC server', { error });
      throw error;
    }
  }

  /**
   * Start listening for connections
   */
  async listen(): Promise<void> {
    if (!this.initialized) {
      throw new Error('QUIC server not initialized. Call initialize() first.');
    }

    if (this.listening) {
      logger.warn('QUIC server already listening');
      return;
    }

    try {
      logger.info('Starting QUIC server', { host: this.config.host, port: this.config.port });

      // Start QUIC server via WASM
      // This will be implemented with actual WASM bindings

      this.listening = true;
      logger.info(`QUIC server listening on ${this.config.host}:${this.config.port}`);
    } catch (error) {
      logger.error('Failed to start QUIC server', { error });
      throw error;
    }
  }

  /**
   * Stop server and close all connections
   */
  async stop(): Promise<void> {
    if (!this.listening) {
      logger.warn('QUIC server not listening');
      return;
    }

    logger.info('Stopping QUIC server', { activeConnections: this.connections.size });

    // Close all connections
    for (const connectionId of this.connections.keys()) {
      await this.closeConnection(connectionId);
    }

    // Stop listening via WASM
    this.listening = false;
    logger.info('QUIC server stopped');
  }

  /**
   * Close connection
   */
  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.warn('Connection not found', { connectionId });
      return;
    }

    logger.info('Closing connection', { connectionId });
    this.connections.delete(connectionId);
  }

  /**
   * Get server statistics
   */
  getStats(): QuicStats {
    return {
      totalConnections: this.connections.size,
      activeConnections: this.connections.size,
      totalStreams: Array.from(this.connections.values()).reduce((sum, c) => sum + c.streamCount, 0),
      activeStreams: Array.from(this.connections.values()).reduce((sum, c) => sum + c.streamCount, 0),
      bytesReceived: 0,
      bytesSent: 0,
      packetsLost: 0,
      rttMs: 0
    };
  }

  /**
   * Load WASM module (placeholder)
   */
  private async loadWasmModule(): Promise<any> {
    logger.debug('Loading QUIC server WASM module...');
    return {};
  }
}

/**
 * Connection pool manager for QUIC connections
 */
export class QuicConnectionPool {
  private client: QuicClient;
  private connections: Map<string, QuicConnection>;
  private maxPoolSize: number;

  constructor(client: QuicClient, maxPoolSize: number = 10) {
    this.client = client;
    this.connections = new Map();
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Get or create connection from pool
   */
  async getConnection(host: string, port: number): Promise<QuicConnection> {
    const key = `${host}:${port}`;

    if (this.connections.has(key)) {
      const conn = this.connections.get(key)!;
      conn.lastActivity = new Date();
      return conn;
    }

    if (this.connections.size >= this.maxPoolSize) {
      // Remove oldest idle connection
      this.removeOldestConnection();
    }

    const connection = await this.client.connect(host, port);
    this.connections.set(key, connection);
    return connection;
  }

  /**
   * Remove oldest idle connection
   */
  private removeOldestConnection(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, conn] of this.connections.entries()) {
      const lastActivity = conn.lastActivity.getTime();
      if (lastActivity < oldestTime) {
        oldestTime = lastActivity;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.client.closeConnection(oldestKey);
      this.connections.delete(oldestKey);
      logger.debug('Removed idle connection from pool', { connectionId: oldestKey });
    }
  }

  /**
   * Clear all connections in pool
   */
  async clear(): Promise<void> {
    for (const connectionId of this.connections.keys()) {
      await this.client.closeConnection(connectionId);
    }
    this.connections.clear();
  }
}

/**
 * QuicTransport - High-level QUIC transport interface
 * Simplified API for common use cases (backwards compatible)
 */
export interface QuicTransportConfig {
  host?: string;
  port?: number;
  maxConcurrentStreams?: number;
  certPath?: string;
  keyPath?: string;
}

export class QuicTransport {
  private client: QuicClient;
  private config: QuicTransportConfig;

  constructor(config: QuicTransportConfig = {}) {
    this.config = config;
    this.client = new QuicClient({
      serverHost: config.host || 'localhost',
      serverPort: config.port || 4433,
      maxConcurrentStreams: config.maxConcurrentStreams || 100,
      certPath: config.certPath,
      keyPath: config.keyPath
    });
  }

  /**
   * Connect to QUIC server
   */
  async connect(): Promise<void> {
    await this.client.initialize();
    await this.client.connect();
  }

  /**
   * Send data over QUIC
   */
  async send(data: any): Promise<void> {
    // Convert data to bytes and send
    const jsonStr = JSON.stringify(data);
    const bytes = new TextEncoder().encode(jsonStr);
    // Implementation will use QUIC client to send
    logger.debug('Sending data via QUIC', { bytes: bytes.length });
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.client.shutdown();
  }

  /**
   * Get connection statistics
   */
  getStats(): QuicStats {
    return this.client.getStats();
  }
}
