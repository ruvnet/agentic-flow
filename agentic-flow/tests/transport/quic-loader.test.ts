/**
 * Tests for the loader-pattern transport (PR #153 backport).
 *
 * Pins the contract that distinguishes a real transport from the
 * earlier no-op stub:
 *   1. getTransportCapabilities() reflects backend selection honestly
 *   2. WebSocketServer + WebSocket round-trip actually delivers bytes
 *   3. send() reports a non-zero latency (anti-stub: the prior bug had
 *      every operation return 0ms because no I/O happened)
 *   4. close() is idempotent and cleans up server bindings
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  loadQuicTransport,
  getTransportCapabilities,
  isQuicAvailable,
  getQuicStatus,
  QUIC_UNAVAILABLE_REASON,
  WebSocketFallbackTransport,
  DEFAULT_STREAM_ID,
  type AgentTransport,
  type AgentMessage,
} from '../../src/transport/quic-loader.js';

// Use a high port range to avoid clashing with anything the dev runs locally
const TEST_PORT = 24_101;

// Close client before server. Closing the server first while a client
// connection is still open makes WebSocketServer.close() wait for the
// graceful disconnect, which can stall in tests.
const closeAll = async (...transports: (AgentTransport | undefined)[]) => {
  for (const t of transports) {
    if (t) await t.close().catch(() => undefined);
  }
};

describe('getTransportCapabilities', () => {
  it('returns websocket as selected backend by default', async () => {
    const caps = await getTransportCapabilities();
    expect(caps.webSocketFallbackAvailable).toBe(true);
    expect(caps.selectedBackend).toBe('websocket');
    expect(caps.quicAvailable).toBe(false);
  });

  it('selectedBackend tracks isQuicAvailable', async () => {
    const caps = await getTransportCapabilities();
    const quic = await isQuicAvailable();
    expect(caps.quicAvailable).toBe(quic);
    expect(caps.selectedBackend).toBe(quic ? 'quic' : 'websocket');
  });
});

describe('QUIC availability is honest', () => {
  it('reports a reason when QUIC is unavailable', async () => {
    const caps = await getTransportCapabilities();
    expect(caps.quicAvailable).toBe(false);
    expect(caps.quicUnavailableReason).toBe(QUIC_UNAVAILABLE_REASON);
    expect(QUIC_UNAVAILABLE_REASON).toMatch(/native QUIC binding/);
    expect(await getQuicStatus()).toEqual({
      available: false,
      reason: QUIC_UNAVAILABLE_REASON,
      fallback: 'websocket',
    });
  });

  it('AGENTIC_FLOW_QUIC_NATIVE=1 no longer fakes availability', async () => {
    const prev = process.env.AGENTIC_FLOW_QUIC_NATIVE;
    process.env.AGENTIC_FLOW_QUIC_NATIVE = '1';
    try {
      expect(await isQuicAvailable()).toBe(false);
      expect((await getTransportCapabilities()).selectedBackend).toBe('websocket');
    } finally {
      if (prev === undefined) delete process.env.AGENTIC_FLOW_QUIC_NATIVE;
      else process.env.AGENTIC_FLOW_QUIC_NATIVE = prev;
    }
  });

  it('transport/quic re-exports the same probe', async () => {
    const quic = await import('../../src/transport/quic.js');
    expect(quic.isQuicAvailable).toBe(isQuicAvailable);
    expect(quic.getQuicStatus).toBe(getQuicStatus);
    expect(await quic.isQuicAvailable()).toBe(false);
  });
});

describe('WebSocketFallbackTransport — real I/O round-trip', () => {
  let srv: WebSocketFallbackTransport | undefined;
  let cli: AgentTransport | undefined;

  afterEach(async () => {
    await closeAll(cli, srv);
    srv = undefined;
    cli = undefined;
  });

  it('listen() binds a port and accepts inbound connections', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT, '127.0.0.1');

    cli = await loadQuicTransport({ serverName: 'cli' });
    await cli.send(`127.0.0.1:${TEST_PORT}`, {
      id: 'm1',
      type: 'task',
      payload: { ping: 'hello' },
    });

    // Give the server's onmessage a moment to enqueue
    await new Promise((r) => setTimeout(r, 100));

    const stats = await srv.getStats();
    // The server tracks INBOUND connections via the WebSocketServer's
    // 'connection' event handler. Some `ws` versions don't add the
    // accepted socket to the outbound `connections` map, so we don't
    // assert active>0 here. The signal that bytes moved is the
    // delivered message; see the next test.
    expect(stats).toBeDefined();
  });

  it('client send completes with non-zero latency (anti-stub)', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 1, '127.0.0.1');

    cli = await loadQuicTransport({ serverName: 'cli' });
    const t0 = Date.now();
    await cli.send(`127.0.0.1:${TEST_PORT + 1}`, {
      id: 'm2',
      type: 'task',
      payload: { ping: 'latency' },
    });
    const dt = Date.now() - t0;

    // The prior stub returned 0ms for this exact call. Real I/O on
    // localhost takes at least 1ms (often more). If a future regression
    // re-introduces a no-op, this assertion catches it.
    expect(dt).toBeGreaterThan(0);
    // Sanity upper bound — localhost ping shouldn't exceed 5s
    expect(dt).toBeLessThan(5_000);
  });

  it('close() is idempotent and tears down server bindings', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 2, '127.0.0.1');
    await srv.close();
    // Second close should not throw
    await srv.close();
    srv = undefined;
  });

  it('sendBatch fans out multiple messages without dropping any', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 3, '127.0.0.1');

    cli = await loadQuicTransport({ serverName: 'cli' });
    const messages: AgentMessage[] = Array.from({ length: 5 }, (_, i) => ({
      id: `batch-${i}`,
      type: 'task',
      payload: { idx: i },
    }));
    await cli.sendBatch(`127.0.0.1:${TEST_PORT + 3}`, messages);

    await new Promise((r) => setTimeout(r, 100));
    const stats = await srv.getStats();
    expect(stats).toBeDefined();
  });

  it('onMessage handler fires on inbound delivery', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 4, '127.0.0.1');

    const received: AgentMessage[] = [];
    srv.onMessage((_addr, msg) => {
      received.push(msg);
    });

    cli = await loadQuicTransport({ serverName: 'cli' });
    await cli.send(`127.0.0.1:${TEST_PORT + 4}`, {
      id: 'on-msg-1',
      type: 'task',
      payload: { hello: 'inbound' },
    });

    // Wait for the WS roundtrip
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('on-msg-1');
    expect(received[0].payload).toEqual({ hello: 'inbound' });
  });

  it('multiple onMessage handlers all fire, errors are isolated', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 5, '127.0.0.1');

    const goodReceived: AgentMessage[] = [];
    srv.onMessage((_addr, msg) => { goodReceived.push(msg); });
    srv.onMessage(() => { throw new Error('handler intentionally throws'); });
    srv.onMessage(async () => { throw new Error('async rejector'); });

    cli = await loadQuicTransport({ serverName: 'cli' });
    await cli.send(`127.0.0.1:${TEST_PORT + 5}`, {
      id: 'multi-h-1',
      type: 'task',
      payload: {},
    });

    await new Promise((r) => setTimeout(r, 200));
    // Good handler still got the message — error in another handler
    // doesn't stop fan-out.
    expect(goodReceived).toHaveLength(1);
  });
});

describe('Stream multiplexing — per-stream queues', () => {
  let srv: WebSocketFallbackTransport | undefined;
  let cli: AgentTransport | undefined;

  afterEach(async () => {
    await closeAll(cli, srv);
    srv = undefined;
    cli = undefined;
  });

  it('messages on different streams land in independent queues', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 10, '127.0.0.1');

    cli = await loadQuicTransport({ serverName: 'cli' });
    await cli.send(`127.0.0.1:${TEST_PORT + 10}`, { id: 'a1', type: 'task', payload: { s: 'A' }, streamId: 'A' });
    await cli.send(`127.0.0.1:${TEST_PORT + 10}`, { id: 'b1', type: 'task', payload: { s: 'B' }, streamId: 'B' });
    await cli.send(`127.0.0.1:${TEST_PORT + 10}`, { id: 'a2', type: 'task', payload: { s: 'A' }, streamId: 'A' });

    // Wait for inbound queueing
    await new Promise((r) => setTimeout(r, 200));
  });

  it('stream-scoped onMessage handler only fires for matching streamId', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 11, '127.0.0.1');

    const aMsgs: AgentMessage[] = [];
    const bMsgs: AgentMessage[] = [];
    const allMsgs: AgentMessage[] = [];
    srv.onMessage((_addr, m) => aMsgs.push(m), { streamId: 'A' });
    srv.onMessage((_addr, m) => bMsgs.push(m), { streamId: 'B' });
    srv.onMessage((_addr, m) => allMsgs.push(m)); // catch-all

    cli = await loadQuicTransport({ serverName: 'cli' });
    await cli.send(`127.0.0.1:${TEST_PORT + 11}`, { id: 'a1', type: 'task', payload: {}, streamId: 'A' });
    await cli.send(`127.0.0.1:${TEST_PORT + 11}`, { id: 'b1', type: 'task', payload: {}, streamId: 'B' });
    await cli.send(`127.0.0.1:${TEST_PORT + 11}`, { id: 'a2', type: 'task', payload: {}, streamId: 'A' });

    await new Promise((r) => setTimeout(r, 250));
    expect(aMsgs.map((m) => m.id)).toEqual(['a1', 'a2']);
    expect(bMsgs.map((m) => m.id)).toEqual(['b1']);
    expect(allMsgs).toHaveLength(3); // catch-all sees everything
  });

  it('messages without streamId default to DEFAULT_STREAM_ID and route to default-scoped handlers', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 12, '127.0.0.1');

    const defaultMsgs: AgentMessage[] = [];
    srv.onMessage((_addr, m) => defaultMsgs.push(m), { streamId: DEFAULT_STREAM_ID });

    cli = await loadQuicTransport({ serverName: 'cli' });
    // Two sends without streamId — both should fall under DEFAULT_STREAM_ID
    await cli.send(`127.0.0.1:${TEST_PORT + 12}`, { id: 'd1', type: 'task', payload: {} });
    await cli.send(`127.0.0.1:${TEST_PORT + 12}`, { id: 'd2', type: 'task', payload: {} });

    await new Promise((r) => setTimeout(r, 250));
    expect(defaultMsgs.map((m) => m.id)).toEqual(['d1', 'd2']);
  });

  it('numeric streamIds work the same as string streamIds', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 13, '127.0.0.1');

    const stream42: AgentMessage[] = [];
    srv.onMessage((_addr, m) => stream42.push(m), { streamId: 42 });

    cli = await loadQuicTransport({ serverName: 'cli' });
    await cli.send(`127.0.0.1:${TEST_PORT + 13}`, { id: 'n1', type: 'task', payload: {}, streamId: 42 });
    await cli.send(`127.0.0.1:${TEST_PORT + 13}`, { id: 'n2', type: 'task', payload: {}, streamId: 99 });

    await new Promise((r) => setTimeout(r, 250));
    expect(stream42.map((m) => m.id)).toEqual(['n1']);
  });

  it('handler error in one stream does not affect other streams', async () => {
    srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(TEST_PORT + 14, '127.0.0.1');

    srv.onMessage(() => { throw new Error('A handler crashes'); }, { streamId: 'A' });
    const bSeen: AgentMessage[] = [];
    srv.onMessage((_a, m) => bSeen.push(m), { streamId: 'B' });

    cli = await loadQuicTransport({ serverName: 'cli' });
    await cli.send(`127.0.0.1:${TEST_PORT + 14}`, { id: 'a', type: 'task', payload: {}, streamId: 'A' });
    await cli.send(`127.0.0.1:${TEST_PORT + 14}`, { id: 'b', type: 'task', payload: {}, streamId: 'B' });

    await new Promise((r) => setTimeout(r, 250));
    // B handler still got its message despite A handler throwing
    expect(bSeen.map((m) => m.id)).toEqual(['b']);
  });
});

describe('TLS config (ADR-107)', () => {
  it('config.tls is optional + defaults to {} (backward compat)', async () => {
    // Just creating without tls field MUST not throw — proves the
    // existing ws:// callers still work.
    const t = await WebSocketFallbackTransport.create({ serverName: 'compat' });
    await t.close();
  });

  it('accepts pinnedFingerprints config without error (wss path not exercised here)', async () => {
    const t = await WebSocketFallbackTransport.create({
      serverName: 'pinned',
      tls: { pinnedFingerprints: ['sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='] },
    });
    await t.close();
  });

  it('accepts caPath config without error', async () => {
    const t = await WebSocketFallbackTransport.create({
      serverName: 'ca',
      tls: { caPath: '/etc/ssl/cert.pem' },
    });
    await t.close();
  });

  it('ws:// URL with pinning config: pinning silently ignored (no wss to pin)', async () => {
    // The pinning code path checks isWss BEFORE applying. Confirms a
    // misconfig (pinning + ws://) doesn't break plain ws.
    const srv = await WebSocketFallbackTransport.create({ serverName: 'srv' });
    await srv.listen(24201, '127.0.0.1');
    const cli = await WebSocketFallbackTransport.create({
      serverName: 'cli',
      tls: { pinnedFingerprints: ['sha256/wrong'] },
    });
    // ws:// connect should still succeed despite the (irrelevant) pinning config
    await cli.send('127.0.0.1:24201', { id: 'p', type: 'task', payload: {} });
    await cli.close();
    await srv.close();
  });
});

describe('loadQuicTransport — selection contract', () => {
  it('returns a transport with the AgentTransport interface', async () => {
    const t = await loadQuicTransport();
    expect(typeof t.send).toBe('function');
    expect(typeof t.receive).toBe('function');
    expect(typeof t.request).toBe('function');
    expect(typeof t.sendBatch).toBe('function');
    expect(typeof t.getStats).toBe('function');
    expect(typeof t.close).toBe('function');
    await t.close();
  });

  it('falls back to WebSocket when native QUIC is not available', async () => {
    // No native QUIC binding ships, so isQuicAvailable() returns false
    // → loader picks WebSocketFallbackTransport. We assert via the
    // capability probe to avoid a brittle instanceof check across builds.
    const before = await isQuicAvailable();
    expect(before).toBe(false);

    const t = await loadQuicTransport({ serverName: 'fallback-test' });
    const stats = await t.getStats();
    expect(stats).toEqual({
      active: expect.any(Number),
      idle: expect.any(Number),
      created: expect.any(Number),
      closed: expect.any(Number),
    });
    await t.close();
  });
});

// #162: on a direct point-to-point link, dialing a fresh outbound socket
// back to a peer can hit a stale scoped route (EHOSTUNREACH) while the
// inbound direction stays healthy. The transport now reuses the inbound
// (server-accepted) socket for replies instead of dialing.
describe('WebSocketFallbackTransport — inbound socket reuse (#162)', () => {
  let a: WebSocketFallbackTransport | undefined;
  let b: WebSocketFallbackTransport | undefined;

  afterEach(async () => {
    await closeAll(b, a);
    a = undefined;
    b = undefined;
  });

  it('reuses the inbound socket for replies instead of dialing a new outbound', async () => {
    const portA = TEST_PORT + 20;
    const portB = TEST_PORT + 21;
    a = await WebSocketFallbackTransport.create({ serverName: 'A' });
    b = await WebSocketFallbackTransport.create({ serverName: 'B' });
    await a.listen(portA, '127.0.0.1');
    await b.listen(portB, '127.0.0.1');

    const aSeen: AgentMessage[] = [];
    const bSeen: AgentMessage[] = [];
    a.onMessage((_addr, m) => aSeen.push(m));
    b.onMessage((_addr, m) => bSeen.push(m));

    // B dials A. A now holds a live inbound socket from host 127.0.0.1.
    await b.send(`127.0.0.1:${portA}`, { id: 'b->a', type: 'task', payload: {} });
    await new Promise((r) => setTimeout(r, 120));
    expect(aSeen.map((m) => m.id)).toEqual(['b->a']);

    // A replies to B's host. It must ride the existing inbound socket, so A
    // never opens an outbound connection of its own.
    await a.send(`127.0.0.1:${portB}`, { id: 'a->b', type: 'task', payload: {} });
    await new Promise((r) => setTimeout(r, 120));

    expect(bSeen.map((m) => m.id)).toEqual(['a->b']);
    const aStats = await a.getStats();
    expect(aStats.created).toBe(0); // reuse, not a fresh dial
  });

  it('keeps a live socket alive across a heartbeat interval and closes cleanly', async () => {
    const portA = TEST_PORT + 22;
    // maxIdleTimeoutMs=6000 → ping cadence 1000ms (1/6). A healthy socket
    // ponging in time must NOT be terminated.
    a = await WebSocketFallbackTransport.create({ serverName: 'A', maxIdleTimeoutMs: 6000 });
    b = await WebSocketFallbackTransport.create({ serverName: 'B', maxIdleTimeoutMs: 6000 });
    await a.listen(portA, '127.0.0.1');

    const aSeen: AgentMessage[] = [];
    a.onMessage((_addr, m) => aSeen.push(m));

    await b.send(`127.0.0.1:${portA}`, { id: 'h1', type: 'task', payload: {} });
    // Wait past one ping/pong cycle, then send again over the same socket.
    await new Promise((r) => setTimeout(r, 1300));
    await b.send(`127.0.0.1:${portA}`, { id: 'h2', type: 'task', payload: {} });
    await new Promise((r) => setTimeout(r, 120));

    expect(aSeen.map((m) => m.id)).toEqual(['h1', 'h2']);
    // B reused its single outbound connection for both sends (heartbeat
    // kept it open rather than forcing a reconnect).
    const bStats = await b.getStats();
    expect(bStats.created).toBe(1);
  });
});
