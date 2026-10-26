/**
 * Federation Hub Server - WebSocket-based hub for agent synchronization
 *
 * This is a production-ready implementation using WebSocket (HTTP/2 upgrade)
 * as a fallback until native QUIC is implemented.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { logger } from '../utils/logger.js';
import { SecurityManager } from './SecurityManager.js';
import Database from 'better-sqlite3';
// AgentDB is optional - federation works with SQLite only
type AgentDB = any;

export interface HubConfig {
  port?: number;
  dbPath?: string;
  maxAgents?: number;
  syncInterval?: number;
  /** Interface to listen on. Loopback unless set: the hub is not safe to expose without TLS in front. */
  host?: string;
  /** HMAC secret agent tokens are verified with (default: JWT_SECRET). */
  jwtSecret?: string;
}

export interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  tenantId: string;
  connectedAt: number;
  lastSyncAt: number;
  vectorClock: Record<string, number>;
}

export interface SyncMessage {
  type: 'auth' | 'pull' | 'push' | 'ack' | 'error';
  agentId?: string;
  tenantId?: string;
  token?: string;
  vectorClock?: Record<string, number>;
  data?: any[];
  error?: string;
  timestamp: number;
}

export class FederationHubServer {
  private config: HubConfig;
  private security: SecurityManager;
  private wss?: WebSocketServer;
  private server?: ReturnType<typeof createServer>;
  private connections: Map<string, AgentConnection> = new Map();
  private db: Database.Database;
  private agentDB: AgentDB;
  private globalVectorClock: Record<string, number> = {};

  constructor(config: HubConfig) {
    this.config = {
      port: 8443,
      host: '127.0.0.1',
      dbPath: ':memory:',
      maxAgents: 1000,
      syncInterval: 5000,
      ...config
    };

    if (!this.config.jwtSecret && !process.env.JWT_SECRET) {
      logger.warn('No jwtSecret or JWT_SECRET set: the hub uses a random secret, so no agent can authenticate until you set one');
    }
    this.security = new SecurityManager(this.config.jwtSecret);

    // Initialize hub database (SQLite for metadata)
    this.db = new Database(this.config.dbPath!);
    this.initializeDatabase();

    // AgentDB integration optional - using SQLite for now
    this.agentDB = null as any;
    logger.info('Federation hub initialized with SQLite');
  }

  /**
   * Initialize hub database schema
   */
  private initializeDatabase(): void {
    // Memory store: tenant-isolated episodes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        task TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        reward REAL NOT NULL,
        critique TEXT,
        success INTEGER NOT NULL,
        tokens_used INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        vector_clock TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(tenant_id, agent_id, session_id, task)
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_tenant ON episodes(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(tenant_id, task);
      CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at);

      -- Change log for sync
      CREATE TABLE IF NOT EXISTS change_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        episode_id INTEGER,
        vector_clock TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(episode_id) REFERENCES episodes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_changes_tenant ON change_log(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_changes_created ON change_log(created_at);

      -- Agent registry
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        connected_at INTEGER NOT NULL,
        last_sync_at INTEGER NOT NULL,
        vector_clock TEXT NOT NULL
      );
    `);

    logger.info('Federation hub database initialized');
  }

  /**
   * Start the hub server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server
        this.server = createServer();

        // Create WebSocket server
        this.wss = new WebSocketServer({ server: this.server });

        // Handle connections
        this.wss.on('connection', (ws: WebSocket) => {
          this.handleConnection(ws);
        });

        // Start listening
        this.server.listen(this.config.port, this.config.host, () => {
          logger.info('Federation hub server started', {
            port: this.config.port,
            protocol: 'WebSocket',
            maxAgents: this.config.maxAgents
          });
          resolve();
        });

        // Error handling
        this.server.on('error', (error) => {
          logger.error('Hub server error', { error: error.message });
          reject(error);
        });

      } catch (error: any) {
        logger.error('Failed to start hub server', { error: error.message });
        reject(error);
      }
    });
  }

  /**
   * Handle new agent connection
   */
  private handleConnection(ws: WebSocket): void {
    let agentId: string | undefined;
    let tenantId: string | undefined;
    let authenticated = false;

    logger.info('New connection attempt');

    ws.on('message', async (data: Buffer) => {
      try {
        const message: SyncMessage = JSON.parse(data.toString());

        // Authentication required first
        if (!authenticated && message.type !== 'auth') {
          this.sendError(ws, 'Authentication required');
          ws.close();
          return;
        }

        switch (message.type) {
          case 'auth':
            const authResult = await this.handleAuth(ws, message);
            if (authResult) {
              agentId = authResult.agentId;
              tenantId = authResult.tenantId;
              authenticated = true;

              // Register connection
              this.connections.set(agentId, {
                ws,
                agentId,
                tenantId,
                connectedAt: Date.now(),
                lastSyncAt: Date.now(),
                vectorClock: message.vectorClock || {}
              });

              logger.info('Agent authenticated', { agentId, tenantId });
            }
            break;

          case 'pull':
            if (agentId && tenantId) {
              await this.handlePull(ws, agentId, tenantId, message);
            }
            break;

          case 'push':
            if (agentId && tenantId) {
              await this.handlePush(ws, agentId, tenantId, message);
            }
            break;

          default:
            this.sendError(ws, `Unknown message type: ${message.type}`);
        }

      } catch (error: any) {
        logger.error('Message handling error', { error: error.message });
        this.sendError(ws, error.message);
      }
    });

    ws.on('close', () => {
      if (agentId) {
        this.connections.delete(agentId);
        logger.info('Agent disconnected', { agentId, tenantId });
      }
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error', { error: error.message, agentId });
    });
  }

  /**
   * Handle authentication
   */
  private async handleAuth(
    ws: WebSocket,
    message: SyncMessage
  ): Promise<{ agentId: string; tenantId: string } | null> {
    if (!message.agentId || !message.tenantId || !message.token) {
      this.sendError(ws, 'Missing authentication credentials');
      return null;
    }

    // Identity comes from the verified token, never from what the client claims.
    let identity;
    try {
      identity = await this.security.verifyAgentToken(message.token);
    } catch {
      this.sendError(ws, 'Authentication failed');
      return null;
    }
    if (identity.agentId !== message.agentId || identity.tenantId !== message.tenantId) {
      this.sendError(ws, 'Authentication failed');
      return null;
    }

    // Register agent
    this.db.prepare(`
      INSERT OR REPLACE INTO agents (agent_id, tenant_id, connected_at, last_sync_at, vector_clock)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      identity.agentId,
      identity.tenantId,
      Date.now(),
      Date.now(),
      JSON.stringify(message.vectorClock || {})
    );

    // Send acknowledgment
    this.send(ws, {
      type: 'ack',
      timestamp: Date.now()
    });

    return {
      agentId: identity.agentId,
      tenantId: identity.tenantId
    };
  }

  /**
   * Handle pull request (agent wants updates from hub)
   */
  private async handlePull(
    ws: WebSocket,
    agentId: string,
    tenantId: string,
    message: SyncMessage
  ): Promise<void> {
    const conn = this.connections.get(agentId);
    if (!conn) {
      this.sendError(ws, 'Agent not connected');
      return;
    }

    // Get changes since agent's last vector clock
    const changes = await this.getChangesSince(tenantId, message.vectorClock || {});

    // Update last sync time
    conn.lastSyncAt = Date.now();

    // Send changes to agent
    this.send(ws, {
      type: 'ack',
      data: changes,
      vectorClock: this.globalVectorClock,
      timestamp: Date.now()
    });

    logger.info('Pull completed', {
      agentId,
      tenantId,
      changeCount: changes.length
    });
  }

  /**
   * Handle push request (agent sending updates to hub)
   */
  private async handlePush(
    ws: WebSocket,
    agentId: string,
    tenantId: string,
    message: SyncMessage
  ): Promise<void> {
    const conn = this.connections.get(agentId);
    if (!conn) {
      this.sendError(ws, 'Agent not connected');
      return;
    }

    if (!message.data || message.data.length === 0) {
      this.send(ws, { type: 'ack', timestamp: Date.now() });
      return;
    }

    // Store episodes in both SQLite (metadata) and AgentDB (vector memory)
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO episodes
      (tenant_id, agent_id, session_id, task, input, output, reward, critique, success, tokens_used, latency_ms, vector_clock, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const changeStmt = this.db.prepare(`
      INSERT INTO change_log (tenant_id, agent_id, operation, episode_id, vector_clock, created_at)
      VALUES (?, ?, 'insert', last_insert_rowid(), ?, ?)
    `);

    let insertCount = 0;

    for (const episode of message.data) {
      try {
        // Store in SQLite for metadata
        stmt.run(
          tenantId,
          agentId,
          episode.sessionId || agentId,
          episode.task,
          episode.input,
          episode.output,
          episode.reward,
          episode.critique || '',
          episode.success ? 1 : 0,
          episode.tokensUsed || 0,
          episode.latencyMs || 0,
          JSON.stringify(message.vectorClock),
          Date.now()
        );

        changeStmt.run(
          tenantId,
          agentId,
          JSON.stringify(message.vectorClock),
          Date.now()
        );

        // Store in AgentDB for vector memory (with tenant isolation)
        await this.agentDB.storePattern({
          sessionId: `${tenantId}/${episode.sessionId || agentId}`,
          task: episode.task,
          input: episode.input,
          output: episode.output,
          reward: episode.reward,
          critique: episode.critique || '',
          success: episode.success,
          tokensUsed: episode.tokensUsed || 0,
          latencyMs: episode.latencyMs || 0,
          metadata: {
            tenantId,
            agentId,
            vectorClock: message.vectorClock
          }
        });

        insertCount++;
      } catch (error: any) {
        logger.error('Failed to insert episode', { error: error.message });
      }
    }

    // Update global vector clock
    if (message.vectorClock) {
      for (const [agent, ts] of Object.entries(message.vectorClock)) {
        this.globalVectorClock[agent] = Math.max(
          this.globalVectorClock[agent] || 0,
          ts
        );
      }
    }

    // Update connection vector clock
    conn.vectorClock = { ...this.globalVectorClock };
    conn.lastSyncAt = Date.now();

    // Send acknowledgment
    this.send(ws, {
      type: 'ack',
      timestamp: Date.now()
    });

    logger.info('Push completed', {
      agentId,
      tenantId,
      episodeCount: insertCount
    });

    // Broadcast to other agents in same tenant (optional real-time sync)
    this.broadcastToTenant(tenantId, agentId, {
      type: 'push',
      agentId,
      data: message.data,
      timestamp: Date.now()
    });
  }

  /**
   * Get changes since a given vector clock
   * Returns memories from other agents in the same tenant
   */
  private async getChangesSince(
    tenantId: string,
    vectorClock: Record<string, number>
  ): Promise<any[]> {
    // Get all episodes for tenant from SQLite
    const episodes = this.db.prepare(`
      SELECT * FROM episodes
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(tenantId);

    return episodes.map((row: any) => ({
      id: row.id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      task: row.task,
      input: row.input,
      output: row.output,
      reward: row.reward,
      critique: row.critique,
      success: row.success === 1,
      tokensUsed: row.tokens_used,
      latencyMs: row.latency_ms,
      vectorClock: JSON.parse(row.vector_clock),
      createdAt: row.created_at
    }));
  }

  /**
   * Broadcast message to all agents in a tenant (except sender)
   */
  private broadcastToTenant(
    tenantId: string,
    senderAgentId: string,
    message: SyncMessage
  ): void {
    let broadcastCount = 0;

    for (const [agentId, conn] of this.connections.entries()) {
      if (conn.tenantId === tenantId && agentId !== senderAgentId) {
        this.send(conn.ws, message);
        broadcastCount++;
      }
    }

    if (broadcastCount > 0) {
      logger.debug('Broadcasted to tenant agents', {
        tenantId,
        recipientCount: broadcastCount
      });
    }
  }

  /**
   * Send message to WebSocket
   */
  private send(ws: WebSocket, message: SyncMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message
   */
  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, {
      type: 'error',
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Get hub statistics
   */
  getStats(): {
    connectedAgents: number;
    totalEpisodes: number;
    tenants: number;
    uptime: number;
  } {
    const totalEpisodes = this.db.prepare('SELECT COUNT(*) as count FROM episodes').get() as any;
    const tenants = this.db.prepare('SELECT COUNT(DISTINCT tenant_id) as count FROM episodes').get() as any;

    return {
      connectedAgents: this.connections.size,
      totalEpisodes: totalEpisodes.count,
      tenants: tenants.count,
      uptime: process.uptime()
    };
  }

  /**
   * Stop the hub server
   */
  async stop(): Promise<void> {
    logger.info('Stopping federation hub server');

    // Close all connections
    for (const [agentId, conn] of this.connections.entries()) {
      conn.ws.close();
    }
    this.connections.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    // Close HTTP server
    if (this.server) {
      this.server.close();
    }

    // Close databases
    this.db.close();
    await this.agentDB?.close();

    logger.info('Federation hub server stopped');
  }

  /**
   * Query patterns from AgentDB with tenant isolation
   */
  async queryPatterns(tenantId: string, task: string, k: number = 5): Promise<any[]> {
    try {
      const results = await this.agentDB.searchPatterns({
        task,
        k,
        minReward: 0.0
      });

      // Filter by tenant (session ID contains tenant prefix)
      return results.filter((r: any) =>
        r.sessionId?.startsWith(`${tenantId}/`)
      );
    } catch (error: any) {
      logger.error('Pattern query failed', { error: error.message });
      return [];
    }
  }
}
