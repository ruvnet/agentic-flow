/**
 * Regression tests for the Anthropic-compatible translation proxies.
 *
 * Before 2.2.0 the proxies listened on every interface and forwarded any
 * /v1/messages request to the upstream provider with the user's key, so a
 * LAN peer could spend it. They now bind 127.0.0.1 and require a per-run
 * token. The OpenRouter proxy also used to drop SSE lines split across
 * reads and mangle multi-byte characters split across chunks.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { once } from 'events';
import type { AddressInfo } from 'net';
import { AnthropicToOpenRouterProxy } from '../../src/proxy/anthropic-to-openrouter.js';
import { AnthropicToGeminiProxy } from '../../src/proxy/anthropic-to-gemini.js';
import { AnthropicToRequestyProxy } from '../../src/proxy/anthropic-to-requesty.js';

const TOKEN = 'sk-ant-proxy-test-token';
const BODY = { model: 'openai/gpt-4o-mini', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => undefined);
});

async function listening(server: Server | undefined): Promise<AddressInfo> {
  if (!server) throw new Error('start() did not return the server');
  if (!server.listening) await once(server, 'listening');
  return server.address() as AddressInfo;
}

/** Fake OpenAI-compatible upstream. `onRequest` decides the response. */
async function fakeUpstream(onRequest: (req: IncomingMessage, res: ServerResponse, body: any) => void) {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    onRequest(req, res, raw ? JSON.parse(raw) : {});
  });
  server.listen(0, '127.0.0.1');
  const addr = await listening(server);
  cleanups.push(() => new Promise((r) => server.close(() => r())));
  return `http://127.0.0.1:${addr.port}`;
}

function jsonCompletion(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 'cmpl-1', model: 'openai/gpt-4o-mini',
    choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }));
}

async function startOpenRouter(upstream = 'http://127.0.0.1:9') {
  const proxy = new AnthropicToOpenRouterProxy({
    openrouterApiKey: 'sk-or-real-key',
    openrouterBaseUrl: upstream,
    defaultModel: 'openai/gpt-4o-mini',
    authToken: TOKEN,
  });
  const addr = await listening(proxy.start(0) as unknown as Server);
  cleanups.push(() => proxy.stop());
  return { proxy, addr, url: `http://127.0.0.1:${addr.port}` };
}

function post(url: string, headers: Record<string, string> = {}, body: unknown = BODY) {
  return fetch(`${url}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('proxy bind address and authentication', () => {
  it('OpenRouter proxy binds 127.0.0.1 by default', async () => {
    const { addr } = await startOpenRouter();
    expect(addr.address).toBe('127.0.0.1');
  });

  it('rejects /v1/messages without a token, and with a wrong one, before reaching upstream', async () => {
    let upstreamHits = 0;
    const upstream = await fakeUpstream((_req, res) => { upstreamHits++; jsonCompletion(res); });
    const { url } = await startOpenRouter(upstream);

    const none = await post(url);
    expect(none.status).toBe(401);
    const wrong = await post(url, { 'x-api-key': 'sk-ant-proxy-dummy-key' });
    expect(wrong.status).toBe(401);
    const wrongBearer = await post(url, { authorization: 'Bearer nope' });
    expect(wrongBearer.status).toBe(401);
    expect(upstreamHits).toBe(0);
  });

  it('accepts the token as x-api-key or Authorization: Bearer', async () => {
    const upstream = await fakeUpstream((_req, res) => jsonCompletion(res));
    const { url } = await startOpenRouter(upstream);

    const viaApiKey = await post(url, { 'x-api-key': TOKEN });
    expect(viaApiKey.status).toBe(200);
    expect((await viaApiKey.json()).content[0].text).toBe('pong');

    const viaBearer = await post(url, { authorization: `Bearer ${TOKEN}` });
    expect(viaBearer.status).toBe(200);
  });

  it('leaves /health open for liveness probes', async () => {
    const { url } = await startOpenRouter();
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it('generates a random token when none is configured', () => {
    const saved = process.env.AGENTIC_FLOW_PROXY_TOKEN;
    delete process.env.AGENTIC_FLOW_PROXY_TOKEN;
    cleanups.push(async () => { if (saved !== undefined) process.env.AGENTIC_FLOW_PROXY_TOKEN = saved; });
    const a = new AnthropicToOpenRouterProxy({ openrouterApiKey: 'k' });
    const b = new AnthropicToOpenRouterProxy({ openrouterApiKey: 'k' });
    expect(a.getAuthToken()).toMatch(/^sk-ant-proxy-[0-9a-f]{64}$/);
    expect(a.getAuthToken()).not.toBe(b.getAuthToken());
  });

  it('Gemini proxy binds 127.0.0.1 and rejects unauthenticated requests', async () => {
    const proxy = new AnthropicToGeminiProxy({ geminiApiKey: 'g-real-key', geminiBaseUrl: 'http://127.0.0.1:9', authToken: TOKEN });
    const addr = await listening(proxy.start(0) as unknown as Server);
    cleanups.push(() => proxy.stop());
    expect(addr.address).toBe('127.0.0.1');
    expect((await post(`http://127.0.0.1:${addr.port}`)).status).toBe(401);
  });

  it('Requesty proxy binds 127.0.0.1 and rejects unauthenticated requests', async () => {
    const proxy = new AnthropicToRequestyProxy({ requestyApiKey: 'r-real-key', requestyBaseUrl: 'http://127.0.0.1:9', authToken: TOKEN });
    const addr = await listening(proxy.start(0) as unknown as Server);
    cleanups.push(() => proxy.stop());
    expect(addr.address).toBe('127.0.0.1');
    expect((await post(`http://127.0.0.1:${addr.port}`)).status).toBe(401);
  });
});

describe('OpenRouter proxy SSE streaming', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Collect every text_delta from an Anthropic-format SSE body. */
  function textDeltas(sse: string): string {
    return sse
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
      .filter((e) => e?.delta?.type === 'text_delta')
      .map((e) => e.delta.text)
      .join('');
  }

  it('keeps a data: line split mid-JSON and an emoji split across a byte boundary intact', async () => {
    const text = 'héllo 🌍 wörld';
    const payload = Buffer.from(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      `data: [DONE]\n\n`,
    );
    const midJson = payload.indexOf('"delta"') + 3; // inside the JSON object
    const midEmoji = payload.indexOf(Buffer.from('🌍')) + 2; // inside the 4-byte emoji

    const upstream = await fakeUpstream(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(payload.subarray(0, midJson));
      await sleep(40);
      res.write(payload.subarray(midJson, midEmoji));
      await sleep(40);
      res.end(payload.subarray(midEmoji));
    });
    const { url } = await startOpenRouter(upstream);

    const res = await post(url, { 'x-api-key': TOKEN }, { ...BODY, stream: true });
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(textDeltas(sse)).toBe(text);
    expect(sse).toContain('event: message_stop');
  });
});
