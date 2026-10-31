/**
 * Regression tests for the WebSocket transport (quic-loader.ts) and QUIC
 * config defaults.
 *   - listen() and the QUIC configs defaulted to 0.0.0.0.
 *   - No maxPayload: ws's default accepts frames up to 100 MiB.
 *   - Every inbound message was pushed onto a per-stream queue even when an
 *     onMessage handler consumed it, and nothing drained those queues, so a
 *     handler-driven peer leaked memory without bound.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { WebSocketFallbackTransport, type AgentMessage } from '../../src/transport/quic-loader.js';
import { DEFAULT_QUIC_CONFIG } from '../../src/config/quic.js';
import { QuicClient, QuicServer } from '../../src/transport/quic.js';

const PORT = 24_301;
const open: WebSocketFallbackTransport[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close().catch(() => undefined);
});

async function transport(name: string) {
  const t = await WebSocketFallbackTransport.create({ serverName: name });
  open.push(t);
  return t;
}

/** Sum of queued messages, read from the private map so it works on any version. */
function queued(t: WebSocketFallbackTransport): number {
  let n = 0;
  for (const q of ((t as any).messageQueue as Map<string, unknown[]>).values()) n += q.length;
  return n;
}

async function waitFor(cond: () => boolean, ms = 10_000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const msg = (i: number): AgentMessage => ({ id: `m${i}`, type: 'task', payload: { i } });

describe('WebSocketFallbackTransport limits', () => {
  it('leaves the queue empty when a handler consumes 10k messages', async () => {
    const srv = await transport('srv');
    await srv.listen(PORT, '127.0.0.1');
    let seen = 0;
    srv.onMessage(() => { seen++; });

    const cli = await transport('cli');
    const addr = `127.0.0.1:${PORT}`;
    await cli.send(addr, msg(0)); // open the connection once
    for (let i = 1; i < 10_000; i++) await cli.send(addr, msg(i));
    await waitFor(() => seen === 10_000);

    expect(queued(srv)).toBe(0);
    expect(srv.queuedMessageCount()).toBe(0);
  }, 30_000);

  it('still queues for receive() when no handler matches, bounded per stream', async () => {
    const srv = await transport('srv');
    await srv.listen(PORT + 1, '127.0.0.1');
    // A handler for another stream must not swallow default-stream messages
    srv.onMessage(() => undefined, { streamId: 'other' });

    const cli = await transport('cli');
    const addr = `127.0.0.1:${PORT + 1}`;
    await cli.send(addr, msg(0));
    for (let i = 1; i < 1_500; i++) await cli.send(addr, msg(i));
    await waitFor(() => queued(srv) >= 1_000 && (srv as any).messageQueue.size > 0);
    await new Promise((r) => setTimeout(r, 200));

    expect(srv.queuedMessageCount()).toBe(1_000);
  }, 30_000);

  it('listen() binds loopback by default', async () => {
    const srv = await transport('srv');
    await srv.listen(PORT + 2);
    const wss = (srv as any).servers.get(PORT + 2);
    expect(wss.address().address).toBe('127.0.0.1');
  });

  it('rejects frames larger than 1 MiB', async () => {
    const srv = await transport('srv');
    await srv.listen(PORT + 3, '127.0.0.1');
    let seen = 0;
    srv.onMessage(() => { seen++; });

    const ws = new WebSocket(`ws://127.0.0.1:${PORT + 3}`);
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    ws.send(JSON.stringify({ id: 'big', type: 'task', payload: 'x'.repeat(2 * 1024 * 1024) }));
    expect(await closed).toBe(1009); // Message Too Big
    expect(seen).toBe(0);
  });
});

describe('QUIC defaults', () => {
  it('bind loopback unless configured otherwise', () => {
    expect(DEFAULT_QUIC_CONFIG.host).toBe('127.0.0.1');
    expect((new QuicServer() as any).config.host).toBe('127.0.0.1');
    expect((new QuicClient() as any).config.host).toBe('127.0.0.1');
    expect((new QuicServer({ host: '0.0.0.0' }) as any).config.host).toBe('0.0.0.0');
  });
});
