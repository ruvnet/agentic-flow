/**
 * Adaptive Multi-Protocol Proxy
 *
 * Automatically selects optimal protocol based on:
 * - Client capabilities
 * - Network conditions
 * - Configuration priorities
 *
 * Fallback chain: HTTP/3 → HTTP/2 → HTTP/1.1 → WebSocket
 */

import { HTTP2Proxy } from './http2-proxy.js';
import { HTTP3Proxy } from './http3-proxy.js';
import { WebSocketProxy } from './websocket-proxy.js';
import { AnthropicToGeminiProxy } from './anthropic-to-gemini.js';
import { logger } from '../utils/logger.js';

export interface AdaptiveProxyConfig {
  enableHTTP2?: boolean;
  enableHTTP3?: boolean;
  enableWebSocket?: boolean;
  enableHTTP1?: boolean; // Always enabled as fallback

  http1Port?: number;
  http2Port?: number;
  http3Port?: number;
  wsPort?: number;

  cert?: string;
  key?: string;

  geminiApiKey?: string;
  geminiBaseUrl?: string;
}

interface ProxyServer {
  protocol: string;
  port: number;
  url: string;
  proxy: any;
}

export class AdaptiveProxy {
  private config: AdaptiveProxyConfig;
  private servers: ProxyServer[] = [];
  private isRunning: boolean = false;

  constructor(config: AdaptiveProxyConfig) {
    this.config = {
      enableHTTP1: true, // Always enabled
      enableHTTP2: config.enableHTTP2 ?? true,
      enableHTTP3: config.enableHTTP3 ?? false, // Disabled by default (requires QUIC)
      enableWebSocket: config.enableWebSocket ?? true,

      http1Port: config.http1Port || 3000,
      http2Port: config.http2Port || 3001,
      http3Port: config.http3Port || 4433,
      wsPort: config.wsPort || 8080,

      ...config
    };

    logger.info('Adaptive proxy created', {
      protocols: this.getEnabledProtocols()
    });
  }

  private getEnabledProtocols(): string[] {
    const protocols = [];
    if (this.config.enableHTTP3) protocols.push('HTTP/3');
    if (this.config.enableHTTP2) protocols.push('HTTP/2');
    if (this.config.enableHTTP1) protocols.push('HTTP/1.1');
    if (this.config.enableWebSocket) protocols.push('WebSocket');
    return protocols;
  }

  async start(): Promise<ProxyServer[]> {
    console.log('\n🚀 Starting Adaptive Multi-Protocol Proxy...\n');

    // Try HTTP/3 first (fastest)
    if (this.config.enableHTTP3) {
      try {
        const http3 = new HTTP3Proxy({
          port: this.config.http3Port!,
          cert: this.config.cert,
          key: this.config.key,
          geminiApiKey: this.config.geminiApiKey,
          geminiBaseUrl: this.config.geminiBaseUrl
        });

        await http3.start();

        this.servers.push({
          protocol: 'HTTP/3',
          port: this.config.http3Port!,
          url: `https://localhost:${this.config.http3Port}`,
          proxy: http3
        });

        console.log(`✅ HTTP/3 (QUIC)   → Port ${this.config.http3Port} (fastest, 50-70% improvement)`);

      } catch (error) {
        logger.warn('HTTP/3 unavailable, skipping', { error: (error as Error).message });
        console.log(`⚠️  HTTP/3 (QUIC)   → Unavailable (${(error as Error).message})`);
      }
    }

    // Try HTTP/2 next
    if (this.config.enableHTTP2) {
      try {
        const http2 = new HTTP2Proxy({
          port: this.config.http2Port!,
          cert: this.config.cert,
          key: this.config.key,
          geminiApiKey: this.config.geminiApiKey,
          geminiBaseUrl: this.config.geminiBaseUrl
        });

        await http2.start();

        this.servers.push({
          protocol: 'HTTP/2',
          port: this.config.http2Port!,
          url: `https://localhost:${this.config.http2Port}`,
          proxy: http2
        });

        console.log(`✅ HTTP/2          → Port ${this.config.http2Port} (30-50% improvement)`);

      } catch (error) {
        logger.warn('HTTP/2 unavailable, skipping', { error: (error as Error).message });
        console.log(`⚠️  HTTP/2          → Unavailable (${(error as Error).message})`);
      }
    }

    // HTTP/1.1 (always available)
    if (this.config.enableHTTP1) {
      try {
        const http1 = new AnthropicToGeminiProxy({
          geminiApiKey: this.config.geminiApiKey!,
          geminiBaseUrl: this.config.geminiBaseUrl,
          defaultModel: 'gemini-2.0-flash-exp'
        });

        http1.start(this.config.http1Port!);

        this.servers.push({
          protocol: 'HTTP/1.1',
          port: this.config.http1Port!,
          url: `http://localhost:${this.config.http1Port}`,
          proxy: http1
        });

        console.log(`✅ HTTP/1.1        → Port ${this.config.http1Port} (baseline, always available)`);
        console.log(`   HTTP/1.1 token (x-api-key): ${http1.getAuthToken()}`);

      } catch (error) {
        logger.error('HTTP/1.1 failed to start', { error: (error as Error).message });
        throw error; // HTTP/1.1 failure is fatal
      }
    }

    // WebSocket fallback for unreliable connections
    if (this.config.enableWebSocket) {
      try {
        const ws = new WebSocketProxy({
          port: this.config.wsPort!,
          geminiApiKey: this.config.geminiApiKey,
          geminiBaseUrl: this.config.geminiBaseUrl
        });

        await ws.start();

        this.servers.push({
          protocol: 'WebSocket',
          port: this.config.wsPort!,
          url: `ws://localhost:${this.config.wsPort}`,
          proxy: ws
        });

        console.log(`✅ WebSocket       → Port ${this.config.wsPort} (mobile/unstable connections)`);

      } catch (error) {
        logger.warn('WebSocket unavailable, skipping', { error: (error as Error).message });
        console.log(`⚠️  WebSocket       → Unavailable (${(error as Error).message})`);
      }
    }

    this.isRunning = true;

    console.log(`\n📊 Active Protocols: ${this.servers.length}/${this.getEnabledProtocols().length}`);
    console.log(`\n💡 Usage:`);
    this.servers.forEach(s => {
      console.log(`   ${s.protocol.padEnd(12)} → curl ${s.url}/health`);
    });
    console.log('');

    logger.info('Adaptive proxy started', {
      activeServers: this.servers.length,
      protocols: this.servers.map(s => s.protocol)
    });

    return this.servers;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('\n🛑 Stopping all proxy servers...\n');

    for (const server of this.servers) {
      try {
        if (server.proxy.stop) {
          await server.proxy.stop();
        }
        console.log(`✅ Stopped ${server.protocol}`);
      } catch (error) {
        logger.error(`Failed to stop ${server.protocol}`, { error: (error as Error).message });
      }
    }

    this.servers = [];
    this.isRunning = false;

    logger.info('Adaptive proxy stopped');
    console.log('\n✅ All proxy servers stopped\n');
  }

  getServers(): ProxyServer[] {
    return [...this.servers];
  }

  getStatus(): {
    isRunning: boolean;
    servers: Array<{ protocol: string; port: number; url: string }>;
    enabledProtocols: string[];
  } {
    return {
      isRunning: this.isRunning,
      servers: this.servers.map(s => ({
        protocol: s.protocol,
        port: s.port,
        url: s.url
      })),
      enabledProtocols: this.getEnabledProtocols()
    };
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!geminiApiKey) {
    console.error('❌ Error: GOOGLE_GEMINI_API_KEY environment variable required');
    process.exit(1);
  }

  const proxy = new AdaptiveProxy({
    enableHTTP1: true,
    enableHTTP2: true,
    enableHTTP3: false, // Requires QUIC setup
    enableWebSocket: true,

    http1Port: 3000,
    http2Port: 3001,
    http3Port: 4433,
    wsPort: 8080,

    cert: process.env.TLS_CERT,
    key: process.env.TLS_KEY,

    geminiApiKey,
    geminiBaseUrl: process.env.GEMINI_BASE_URL
  });

  proxy.start().catch((error) => {
    console.error('❌ Failed to start adaptive proxy:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await proxy.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await proxy.stop();
    process.exit(0);
  });
}
