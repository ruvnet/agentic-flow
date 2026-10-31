// Shared access control for the Anthropic-compatible translation proxies.
//
// The proxies hold a real upstream key (OpenRouter, Gemini, Requesty) and
// forward any /v1/messages request to it. Without a bind address and a
// credential check, anyone who can reach the port spends that key. These
// helpers give every proxy the same two defaults:
//   - bind 127.0.0.1 unless AGENTIC_FLOW_PROXY_HOST says otherwise
//   - require a per-run bearer token on every route except /health
import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export const DEFAULT_PROXY_HOST = '127.0.0.1';

/** Host the proxy binds to. Override with AGENTIC_FLOW_PROXY_HOST. */
export function resolveProxyHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENTIC_FLOW_PROXY_HOST?.trim() || DEFAULT_PROXY_HOST;
}

/**
 * Token clients must present. AGENTIC_FLOW_PROXY_TOKEN wins so a standalone
 * proxy can keep a stable token across restarts; otherwise a fresh random one.
 * The `sk-ant-` prefix keeps clients that sanity-check key shape happy.
 */
export function resolveProxyToken(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.AGENTIC_FLOW_PROXY_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return `sk-ant-proxy-${randomBytes(32).toString('hex')}`;
}

/** Pull the presented credential from `x-api-key` or `Authorization: Bearer`. */
export function extractPresentedToken(headers: Request['headers']): string | undefined {
  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) return apiKey;
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  return undefined;
}

function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Express middleware that rejects requests without the expected token with
 * an Anthropic-shaped 401. `/health` stays open so liveness probes work.
 */
export function createProxyAuthMiddleware(expectedToken: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && req.path === '/health') return next();
    const presented = extractPresentedToken(req.headers);
    if (presented && tokensMatch(presented, expectedToken)) return next();
    res.status(401).json({
      type: 'error',
      error: {
        type: 'authentication_error',
        message: 'Missing or invalid proxy token. Send it as x-api-key or Authorization: Bearer.',
      },
    });
  };
}

/**
 * URL a local client should use to reach a proxy bound to `host`. Wildcard
 * binds are reached over loopback; `localhost` is avoided because it can
 * resolve to ::1 while the proxy listens on 127.0.0.1 only.
 */
export function proxyClientBaseUrl(port: number, host: string = resolveProxyHost()): string {
  const target = host === '0.0.0.0' || host === '::' || host === 'localhost' ? '127.0.0.1' : host;
  const formatted = target.includes(':') ? `[${target}]` : target;
  return `http://${formatted}:${port}`;
}
