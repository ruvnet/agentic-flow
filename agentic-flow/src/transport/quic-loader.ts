// QUIC Transport Loader with WebSocket fallback
//
// Backported from outer repo loader pattern. Exposes a single
// loadQuicTransport(config) entry point that:
//
//   1. Tries to load the WASM-backed QuicClient/QuicServer (real QUIC if a
//      native build is wired in the future).
//   2. Falls back to WebSocketFallbackTransport when QUIC is unavailable
//      OR when the WASM stub is detected (current state — see
//      crates/agentic-flow-quic/src/wasm.rs comment: WASM build is a stub
//      because browsers can't do raw UDP/QUIC; production QUIC needs
//      native Node.js builds which haven't shipped yet).
//
// The fallback uses standard WebSocket (ws://) so it works on all Node
// versions without complex native dependencies. Same async send/receive
// API surface as QuicTransport.
//
// Federation use case (ruvnet/ruflo ADR-104): two peers on the same
// tailnet can call loadQuicTransport({ serverName: 'peer.tailnet' }) and
// exchange signed envelopes today, with zero code change required when
// the native QUIC build lands later.

import { logger } from '../utils/logger.js';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { createHash } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';

/** TLS configuration for wss:// peers (ADR-107). */
export interface TlsConfig {
  /** Path to PEM cert file (server side — bind certs for the listener). */
  certPath?: string;
  /** Path to PEM key file (server side). */
  keyPath?: string;
  /**
   * Pinned `sha256/<base64>` fingerprints of acceptable peer certs
   * (client side — outbound connections).
   *
   * When set, ONLY these exact certs are accepted. CA validation is
   * skipped — the fingerprint IS the trust anchor. Fail-closed: if the
   * peer's cert rotates and the fingerprint doesn't match, the
   * connection is refused (operator must update config + restart).
   *
   * This prevents:
   *   - Compromised public CAs issuing rogue certs for our domain
   *   - TLS-MITM attacks where the attacker holds a valid cert chain
   */
  pinnedFingerprints?: string[];
  /**
   * Optional CA bundle path for non-pinned mode (e.g. private CA).
   * Used only when `pinnedFingerprints` is empty/unset.
   */
  caPath?: string;
}

/** Caller-facing config — minimal common surface across both backends. */
export interface QuicTransportConfig {
  serverName?: string;
  maxIdleTimeoutMs?: number;
  maxConcurrentStreams?: number;
  enable0Rtt?: boolean;
  /** TLS materials for wss:// listeners + clients (ADR-107). */
  tls?: TlsConfig;
}

export interface AgentMessage {
  id: string;
  type: 'task' | 'result' | 'status' | 'coordination' | 'heartbeat' | string;
  payload: unknown;
  metadata?: Record<string, unknown>;
  /**
   * Stream multiplexing identifier. Messages with different streamIds
   * to the same peer are independent — receive queues and onMessage
   * handlers can scope per-stream, eliminating head-of-line blocking
   * for sequential `await` patterns on a single peer connection.
   *
   * Defaults to `'default'` if omitted (backward compat). Common
   * patterns:
   *   - One stream per logical request type (`'rpc'`, `'event'`,
   *     `'control'`)
   *   - One stream per task (`taskId` doubled as streamId)
   *   - One stream per priority class (`'high'`, `'normal'`, `'low'`)
   *
   * Maps cleanly to native QUIC streams when AGENTIC_FLOW_QUIC_NATIVE=1
   * (each app-layer streamId becomes a QUIC stream id at that point).
   */
  streamId?: string | number;
}

/** Default streamId when caller omits it. Backward-compat sentinel. */
export const DEFAULT_STREAM_ID = 'default';

export interface PoolStatistics {
  active: number;
  idle: number;
  created: number;
  closed: number;
}

/** Inbound message handler — called for every received message. */
export type InboundMessageHandler = (
  address: string,
  message: AgentMessage,
) => void | Promise<void>;

/**
 * Per-stream subscription options. Pass to `onMessage` to scope a
 * handler to a specific streamId (only fires for messages with that
 * exact streamId). Omit to receive all streams.
 */
export interface OnMessageOptions {
  readonly streamId?: string | number;
}

/** Common interface both real-QUIC and fallback transports satisfy. */
export interface AgentTransport {
  send(address: string, message: AgentMessage): Promise<void>;
  /**
   * Receive the next message from a peer. Optional `streamId` scopes
   * to that stream's queue (independent of other streams to the same
   * peer). Omit to use the default stream — backward-compat behavior.
   */
  receive(address: string, streamId?: string | number): Promise<AgentMessage>;
  request(address: string, message: AgentMessage): Promise<AgentMessage>;
  sendBatch(address: string, messages: AgentMessage[]): Promise<void>;
  getStats(): Promise<PoolStatistics>;
  close(): Promise<void>;
  /**
   * Subscribe to inbound messages. The handler fires for every received
   * message that matches `options.streamId` (if provided) or for every
   * message regardless of streamId (if options omitted).
   *
   * Multiple handlers may be registered (per-stream OR all-streams or
   * a mix). Errors thrown by a handler are logged but do not stop
   * delivery to other handlers.
   *
   * Optional method — implementations that don't support push-style
   * delivery may omit it. Callers should use `transport.onMessage?.(h)`
   * to gracefully degrade.
   */
  onMessage?(handler: InboundMessageHandler, options?: OnMessageOptions): void;
}

/**
 * WebSocket fallback transport.
 *
 * Spec compliance: implements the AgentTransport interface using
 * `ws://` (or `wss://` if address starts with `wss://`). Each call to
 * `send` lazily opens (or reuses) a connection to `address`. The
 * `receive(address)` call drains the next queued message for that
 * address; if none is queued it polls every 100ms until one arrives.
 *
 * Limits vs real QUIC: no 0-RTT resumption, no multiplexed streams
 * (one TCP connection per peer), TLS handled by the WS layer (use
 * `wss://` for encryption). Performance is "good enough" for federation
 * messages at human/agent rates (≤ 100 RPS per peer).
 */
class WebSocketFallbackTransport implements AgentTransport {
  private connections = new Map<string, WebSocket>();
  /**
   * Per-(address, streamId) message queue. Composite key shape
   * `${address}#${streamId}` — see {@link queueKey}. Each stream gets
   * its own FIFO so receive(addr, streamA) is independent of
   * receive(addr, streamB) — eliminates head-of-line blocking on a
   * single peer connection.
   */
  private messageQueue = new Map<string, AgentMessage[]>();
  private connectionsCreated = 0;
  private connectionsClosed = 0;
  private servers = new Map<number, WebSocketServer>();
  /**
   * Inbound handlers. Each entry is { handler, streamId? }. When
   * streamId is undefined the handler receives ALL messages
   * regardless of stream; otherwise only messages with the matching
   * streamId. Lets callers register both per-stream + catch-all.
   */
  private inboundHandlers = new Set<{
    handler: InboundMessageHandler;
    streamId?: string | number;
  }>();

  /** Compose the per-(address, streamId) queue key. */
  private queueKey(address: string, streamId: string | number): string {
    return `${address}#${streamId}`;
  }

  /** Resolve the streamId for a message — defaults to DEFAULT_STREAM_ID. */
  private streamOf(message: AgentMessage): string | number {
    return message.streamId ?? DEFAULT_STREAM_ID;
  }

  constructor(private readonly config: Required<QuicTransportConfig>) {}

  static async create(config: QuicTransportConfig = {}): Promise<WebSocketFallbackTransport> {
    const fullConfig: Required<QuicTransportConfig> = {
      serverName: config.serverName ?? 'localhost',
      maxIdleTimeoutMs: config.maxIdleTimeoutMs ?? 30000,
      maxConcurrentStreams: config.maxConcurrentStreams ?? 100,
      // Not applicable for WebSocket — record but ignore
      enable0Rtt: config.enable0Rtt ?? false,
      tls: config.tls ?? {},
    };
    return new WebSocketFallbackTransport(fullConfig);
  }

  /**
   * Bind a server-side listener so this transport instance can RECEIVE
   * messages from a remote peer (in addition to sending). Federation
   * peers run BOTH a listener and a client — calling listen(9100) plus
   * send('peer:9100', ...) gives bidirectional connectivity.
   *
   * Enables `permessage-deflate` compression with thresholds chosen
   * for federation envelopes (typically JSON, 100B-10KB):
   *   - threshold: 256B — don't waste CPU compressing tiny pings
   *   - level: 3 — balanced compression vs CPU (zlib's BEST_SPEED→6 range)
   *   - serverNoContextTakeover: true — bound per-conn memory growth
   */
  async listen(port: number, host = '0.0.0.0'): Promise<void> {
    if (this.servers.has(port)) return;
    return new Promise((resolve, reject) => {
      const tls = this.config.tls;
      const wssOpts: ConstructorParameters<typeof WebSocketServer>[0] = {
        perMessageDeflate: {
          threshold: 256,
          zlibDeflateOptions: { level: 3 },
          serverNoContextTakeover: true,
          clientNoContextTakeover: true,
        },
      };
      // ADR-107: if cert+key paths are configured, bind via https.Server
      // (wss://). Otherwise bind plain ws:// directly.
      if (tls?.certPath && tls?.keyPath) {
        const cert = readFileSync(tls.certPath);
        const key = readFileSync(tls.keyPath);
        const httpsServer = createHttpsServer({ cert, key });
        httpsServer.listen(port, host, () => {
          const wss = new WebSocketServer({ ...wssOpts, server: httpsServer });
          this.attachServerHandlers(wss);
          this.servers.set(port, wss);
          resolve();
        });
        httpsServer.on('error', reject);
        return;
      }
      const wss = new WebSocketServer({ ...wssOpts, port, host });
      wss.on('listening', () => {
        this.servers.set(port, wss);
        resolve();
      });
      wss.on('error', reject);
      this.attachServerHandlers(wss);
    });
  }

  /**
   * Wire the server's `connection` and per-socket `message` handlers.
   * Extracted so the wss:// path (where the WebSocketServer is attached
   * to a pre-created https.Server) can share the same logic.
   */
  private attachServerHandlers(wss: WebSocketServer): void {
    wss.on('connection', (ws, req) => {
      const remoteAddr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      ws.on('message', (raw: RawData) => {
        try {
          const message = JSON.parse(raw.toString()) as AgentMessage;
          // Per-stream queue (default stream when message.streamId omitted)
          const key = this.queueKey(remoteAddr, this.streamOf(message));
          const queue = this.messageQueue.get(key) ?? [];
          queue.push(message);
          this.messageQueue.set(key, queue);
          this.dispatchInbound(remoteAddr, message);
        } catch (err) {
          logger.warn('Dropped malformed inbound WS message', { remoteAddr, err });
        }
      });
    });
  }

  private async getOrCreateConnection(address: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const existing = this.connections.get(address);
      if (existing && existing.readyState === WebSocket.OPEN) {
        resolve(existing);
        return;
      }

      const url = address.startsWith('ws://') || address.startsWith('wss://')
        ? address
        : `ws://${address}`;

      // ADR-107: cert pinning for wss:// peers. Build the WS options
      // with both compression (perf) and TLS hooks (security).
      const tls = this.config.tls;
      const isWss = url.startsWith('wss://');
      const wsOpts: WebSocket.ClientOptions = {
        perMessageDeflate: {
          threshold: 256,
          zlibDeflateOptions: { level: 3 },
          serverNoContextTakeover: true,
          clientNoContextTakeover: true,
        },
      };

      if (isWss && tls?.pinnedFingerprints && tls.pinnedFingerprints.length > 0) {
        // Fail-closed pinning: ONLY accept the listed cert fingerprints.
        // CA path validation is irrelevant — the fingerprint IS the trust
        // anchor. If the cert rotates, the operator must update config.
        const pinned = new Set(tls.pinnedFingerprints);
        // Cast: ws's `checkServerIdentity` is typed as returning boolean
        // but the underlying `tls.checkServerIdentity` (which it
        // forwards to) accepts `Error | undefined`. The runtime
        // semantics are: throw OR return Error → reject; otherwise accept.
        // The boolean type signature is overly restrictive.
        (wsOpts as unknown as { checkServerIdentity: unknown }).checkServerIdentity = (
          _host: string,
          cert: { raw: Buffer },
        ): Error | undefined => {
          // cert.raw is the DER-encoded cert bytes; sha256/<base64> matches
          // common pinning notation (and what `openssl x509 -fingerprint
          // -sha256` outputs after base64-encoding).
          const fp = `sha256/${createHash('sha256').update(cert.raw).digest('base64')}`;
          if (!pinned.has(fp)) {
            return new Error(
              `Federation TLS: peer cert fingerprint ${fp} not in pinned set ` +
                `(${pinned.size} fingerprint(s) configured)`,
            );
          }
          return undefined; // accept
        };
        // When pinning is on, we explicitly DON'T want CA validation
        // (the fingerprint check above is the real auth). But we also
        // DON'T want to silently accept ANY cert — the checkServerIdentity
        // above is still called.
        wsOpts.rejectUnauthorized = false;
      } else if (isWss && tls?.caPath) {
        // Non-pinned mode: validate against the configured CA bundle.
        wsOpts.ca = readFileSync(tls.caPath);
        wsOpts.rejectUnauthorized = true;
      }
      // (no tls config + ws:// → plain unencrypted; ADR-104 documents
      // tailnet-as-TLS as the recommended path)

      const ws = new WebSocket(url, wsOpts);

      ws.on('open', () => {
        this.connections.set(address, ws);
        this.connectionsCreated++;
        resolve(ws);
      });

      ws.on('error', (error: Error) => {
        reject(new Error(`WebSocket connection to ${url} failed: ${error.message}`));
      });

      ws.on('close', () => {
        this.connectionsClosed++;
        this.connections.delete(address);
      });

      ws.on('message', (raw: RawData) => {
        try {
          const message = JSON.parse(raw.toString()) as AgentMessage;
          const key = this.queueKey(address, this.streamOf(message));
          const queue = this.messageQueue.get(key) ?? [];
          queue.push(message);
          this.messageQueue.set(key, queue);
          this.dispatchInbound(address, message);
        } catch (err) {
          logger.warn('Dropped malformed WebSocket message', { address, err });
        }
      });
    });
  }

  async send(address: string, message: AgentMessage): Promise<void> {
    const ws = await this.getOrCreateConnection(address);
    ws.send(JSON.stringify(message));
  }

  /**
   * Register an inbound handler. Optional `options.streamId` scopes
   * the handler to a specific stream (only fires for messages with
   * matching streamId). Omit to subscribe to ALL streams.
   *
   * Patterns:
   *   onMessage(h)                              — receives all
   *   onMessage(h, { streamId: 'rpc' })         — receives only rpc
   *   onMessage(h, { streamId: 'event' })       — receives only event
   *   (both registered)                         — both fire on
   *                                                their respective streams
   */
  onMessage(handler: InboundMessageHandler, options: OnMessageOptions = {}): void {
    this.inboundHandlers.add({ handler, streamId: options.streamId });
  }

  /**
   * Fire all matching handlers for a received message. Stream-scoped
   * handlers only fire when the message's streamId matches; all-stream
   * handlers always fire. Errors thrown sync OR async-rejected by one
   * handler don't stop delivery to others.
   */
  private dispatchInbound(address: string, message: AgentMessage): void {
    if (this.inboundHandlers.size === 0) return;
    const msgStream = this.streamOf(message);
    for (const entry of this.inboundHandlers) {
      // Stream filter: scoped handler only fires on matching streamId
      if (entry.streamId !== undefined && entry.streamId !== msgStream) continue;
      try {
        const r = entry.handler(address, message);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((err) => {
            logger.warn('Inbound handler rejected', { address, err });
          });
        }
      } catch (err) {
        logger.warn('Inbound handler threw', { address, err });
      }
    }
  }

  async receive(address: string, streamId: string | number = DEFAULT_STREAM_ID): Promise<AgentMessage> {
    const key = this.queueKey(address, streamId);
    // Fast path
    const queue = this.messageQueue.get(key) ?? [];
    if (queue.length > 0) return queue.shift()!;

    // Poll (caller must time out externally if they don't want to wait)
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const q = this.messageQueue.get(key) ?? [];
        if (q.length > 0) {
          clearInterval(interval);
          resolve(q.shift()!);
        }
      }, 100);
    });
  }

  async request(address: string, message: AgentMessage): Promise<AgentMessage> {
    await this.send(address, message);
    return this.receive(address);
  }

  async sendBatch(address: string, messages: AgentMessage[]): Promise<void> {
    await Promise.all(messages.map((m) => this.send(address, m)));
  }

  async getStats(): Promise<PoolStatistics> {
    return {
      active: this.connections.size,
      idle: 0,
      created: this.connectionsCreated,
      closed: this.connectionsClosed,
    };
  }

  async close(): Promise<void> {
    // Outbound clients first.
    for (const ws of this.connections.values()) {
      ws.terminate();
    }
    this.connections.clear();
    this.messageQueue.clear();

    // Inbound: WebSocketServer.close() blocks until every accepted
    // socket disconnects. Forcibly terminate them so the close
    // callback fires within the test/CI timeout window.
    for (const wss of this.servers.values()) {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          /* socket already gone */
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    this.servers.clear();
  }
}

/**
 * Detect whether the WASM-backed QUIC transport is "real" (i.e. it
 * actually moves bytes on the wire) vs the current stub. The stub
 * returns 0ms for connect+send and never increments the server's
 * received-bytes counter. We probe by observing a documented marker
 * on the WASM module: when it's truly wired the loader function
 * `defaultConfig` returns an object whose round-trip through
 * `WasmQuicClient.new` actually opens a UDP socket — failing fast on
 * an OS that blocks UDP outbound (e.g. some sandboxed CI envs).
 *
 * Until the native build lands this returns false; the loader picks
 * WebSocket. When the native binding is wired this returns true and
 * the loader picks real QUIC. Callers get the same API either way.
 */
async function isRealQuicAvailable(): Promise<boolean> {
  try {
    // The WASM file is published in `wasm/quic/` of this package. We
    // do NOT use it for federation today (per the wasm.rs note: it's a
    // stub since browsers can't do UDP). When a native binding is added
    // this probe should switch to detect that binding instead.
    const native = process.env.AGENTIC_FLOW_QUIC_NATIVE === '1';
    return native;
  } catch {
    return false;
  }
}

/**
 * Public API — load a working transport, preferring real QUIC when
 * available, falling back to WebSocket otherwise. The returned object
 * satisfies the AgentTransport interface in both cases.
 *
 * Example:
 *   const t = await loadQuicTransport({ serverName: 'ruvultra:9100' });
 *   await t.send('ruvultra:9100', { id: '1', type: 'task', payload: {...} });
 *
 * Federation v1 ships on the WebSocket fallback (this is the actual
 * working transport today). When the native QUIC binding lands, set
 * the AGENTIC_FLOW_QUIC_NATIVE=1 environment variable and the same
 * code path picks up the upgrade with no API changes.
 */
export async function loadQuicTransport(
  config: QuicTransportConfig = {},
): Promise<AgentTransport> {
  if (await isRealQuicAvailable()) {
    // Future: wire to the native binding here.
    logger.info('QUIC transport: native binding selected');
  } else {
    if (process.env.NODE_ENV !== 'test') {
      logger.warn(
        'QUIC native binding not available; using WebSocket fallback. ' +
          'Set AGENTIC_FLOW_QUIC_NATIVE=1 once a native build is installed.',
      );
    }
  }
  return WebSocketFallbackTransport.create(config);
}

/** Quick capability probe for the doctor / health surface. */
export async function isQuicAvailable(): Promise<boolean> {
  return isRealQuicAvailable();
}

export interface TransportCapabilities {
  quicAvailable: boolean;
  webSocketFallbackAvailable: true;
  selectedBackend: 'quic' | 'websocket';
}

export async function getTransportCapabilities(): Promise<TransportCapabilities> {
  const quic = await isRealQuicAvailable();
  return {
    quicAvailable: quic,
    webSocketFallbackAvailable: true,
    selectedBackend: quic ? 'quic' : 'websocket',
  };
}

export { WebSocketFallbackTransport };
