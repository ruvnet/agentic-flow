// Access control for the HTTP/SSE MCP server.
//
// fastmcp 3.x has no CORS option, and the mcp-proxy HTTP server under it
// reflects any Origin with Access-Control-Allow-Credentials. Those headers
// cannot be turned off at this version, so the origin allowlist is enforced
// here, in `authenticate`, which runs before a session is created (the
// initialize POST on /mcp and the GET on /sse). Requests carrying a session id
// are bound to a session that already passed this check.
import { randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'http';

export const DEFAULT_MCP_HTTP_HOST = '127.0.0.1';
export const DEFAULT_MCP_HTTP_PORT = 8080;

export interface McpHttpAuthConfig {
  host: string;
  token: string;
  /** True when no AGENTIC_FLOW_MCP_TOKEN was set and a token was generated. */
  generated: boolean;
  /** Browser origins allowed to open a session. Empty means none. */
  allowedOrigins: Set<string>;
}

/** Normalise `https://Example.com:443/` style entries to `https://example.com`. */
function toOrigin(value: string): string | undefined {
  try {
    const origin = new URL(value.trim()).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    const origin = entry.trim() ? toOrigin(entry) : undefined;
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * Read AGENTIC_FLOW_MCP_HOST, AGENTIC_FLOW_MCP_TOKEN and
 * AGENTIC_FLOW_MCP_ALLOWED_ORIGINS, generating a token when none is set.
 */
export function resolveMcpHttpAuth(env: NodeJS.ProcessEnv = process.env): McpHttpAuthConfig {
  const fromEnv = env.AGENTIC_FLOW_MCP_TOKEN?.trim();
  return {
    host: env.AGENTIC_FLOW_MCP_HOST?.trim() || DEFAULT_MCP_HTTP_HOST,
    token: fromEnv || randomBytes(32).toString('hex'),
    generated: !fromEnv,
    allowedOrigins: parseAllowedOrigins(env.AGENTIC_FLOW_MCP_ALLOWED_ORIGINS),
  };
}

function presentedToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const apiKey = req.headers['x-api-key'];
  return typeof apiKey === 'string' && apiKey ? apiKey : undefined;
}

function sameToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** mcp-proxy writes a thrown Response straight back to the client. */
function reject(status: 401 | 403, statusText: string): never {
  throw new Response(null, { status, statusText });
}

export type McpHttpSession = { authenticated: true };

/** Build fastmcp's `authenticate` hook: origin allowlist, then bearer token. */
export function createMcpHttpAuthenticate(
  config: Pick<McpHttpAuthConfig, 'token' | 'allowedOrigins'>,
): (req: IncomingMessage) => Promise<McpHttpSession> {
  return async (req) => {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const normalised = typeof origin === 'string' ? toOrigin(origin) : undefined;
      if (!normalised || !config.allowedOrigins.has(normalised)) {
        reject(403, 'Origin not allowed');
      }
    }
    const token = presentedToken(req);
    if (!token || !sameToken(token, config.token)) {
      reject(401, 'Unauthorized');
    }
    return { authenticated: true };
  };
}
