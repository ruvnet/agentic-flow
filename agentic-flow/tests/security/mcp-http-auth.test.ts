/**
 * Regression test: the HTTP/SSE MCP server (src/mcp/fastmcp/servers/http-sse.ts)
 * had no authenticate hook, listened on every interface, and inherited
 * mcp-proxy's reflect-any-Origin CORS. Any LAN peer or web page could open a
 * session and call agentic_flow_agent. It now binds 127.0.0.1, requires a
 * bearer token, and only opens sessions for allowlisted browser origins.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, connect } from 'net';
import { networkInterfaces } from 'os';

const TOKEN = 'mcp-test-token-0123456789';
const ALLOWED = 'http://allowed.example';

// A valid token must get past authentication. Whether the session then opens
// depends on the fastmcp / MCP SDK pair: the locked fastmcp 3.21 + SDK 1.30
// fails every session with 500 "Error creating server" (completions
// capability), unrelated to auth. So the positive cases assert "not 401/403".
const passedAuth = (status: number) => status !== 401 && status !== 403;

let handle: { host: string; port: number; stop: () => Promise<void> };
let base: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
};

function postInit(headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(initialize),
  });
}

beforeAll(async () => {
  process.env.AGENTIC_FLOW_MCP_TOKEN = TOKEN;
  process.env.AGENTIC_FLOW_MCP_ALLOWED_ORIGINS = ALLOWED;
  delete process.env.AGENTIC_FLOW_MCP_HOST;
  const mod: any = await import('../../src/mcp/fastmcp/servers/http-sse.js');
  handle = await mod.startHttpSseServer(await freePort());
  base = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle?.stop();
});

describe('HTTP/SSE MCP server access control', () => {
  it('refuses to open a session without a token', async () => {
    const res = await postInit();
    expect(res.status).toBe(401);
  });

  it('refuses a wrong token', async () => {
    const res = await postInit({ authorization: 'Bearer not-the-token' });
    expect(res.status).toBe(401);
  });

  it('lets the bearer token past authentication', async () => {
    const res = await postInit({ authorization: `Bearer ${TOKEN}` });
    expect(passedAuth(res.status)).toBe(true);
    await res.body?.cancel();
  });

  it('refuses a browser origin that is not allowlisted, even with the token', async () => {
    const res = await postInit({ authorization: `Bearer ${TOKEN}`, origin: 'http://evil.example' });
    expect(res.status).toBe(403);
  });

  it('lets an allowlisted origin with the token past authentication', async () => {
    const res = await postInit({ authorization: `Bearer ${TOKEN}`, origin: ALLOWED });
    expect(passedAuth(res.status)).toBe(true);
    await res.body?.cancel();
  });

  it('refuses the legacy SSE endpoint without a token', async () => {
    const res = await fetch(`${base}/sse`);
    expect(res.status).toBe(401);
  });

  it('binds loopback only: a non-loopback address of this host is refused', async () => {
    expect(handle.host).toBe('127.0.0.1');
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (!external) return; // no non-loopback interface on this machine
    const outcome = await new Promise<string>((resolve) => {
      const sock = connect(handle.port, external);
      sock.setTimeout(2000);
      sock.once('connect', () => { sock.destroy(); resolve('connected'); });
      sock.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
      sock.once('timeout', () => { sock.destroy(); resolve('timeout'); });
    });
    expect(outcome).not.toBe('connected');
  });
});

describe('createMcpHttpAuthenticate', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as any;

  it('accepts the token as Bearer or x-api-key and rejects everything else', async () => {
    const { createMcpHttpAuthenticate, parseAllowedOrigins } = await import('../../src/mcp/fastmcp/auth/http-auth.js');
    const auth = createMcpHttpAuthenticate({ token: TOKEN, allowedOrigins: parseAllowedOrigins('https://ok.example/') });
    await expect(auth(req({ authorization: `Bearer ${TOKEN}` }))).resolves.toEqual({ authenticated: true });
    await expect(auth(req({ 'x-api-key': TOKEN }))).resolves.toEqual({ authenticated: true });
    await expect(auth(req({ authorization: `Bearer ${TOKEN}`, origin: 'https://ok.example' }))).resolves.toBeTruthy();
    await expect(auth(req({}))).rejects.toMatchObject({ status: 401 });
    await expect(auth(req({ authorization: `Bearer ${TOKEN}`, origin: 'null' }))).rejects.toMatchObject({ status: 403 });
  });

  it('generates a token when AGENTIC_FLOW_MCP_TOKEN is unset, and defaults to loopback with no origins', async () => {
    const { resolveMcpHttpAuth } = await import('../../src/mcp/fastmcp/auth/http-auth.js');
    const cfg = resolveMcpHttpAuth({});
    expect(cfg.generated).toBe(true);
    expect(cfg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.allowedOrigins.size).toBe(0);
  });
});
