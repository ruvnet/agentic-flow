// QUIC-enabled Proxy for Anthropic API
// Optional QUIC transport with automatic HTTP/2 fallback

import express, { Request, Response as ExpressResponse, NextFunction } from 'express';
import { QuicClient, QuicConnectionPool, QuicConfig } from '../transport/quic.js';
import { logger } from '../utils/logger.js';
import { AnthropicToOpenRouterProxy } from './anthropic-to-openrouter.js';

export interface QuicProxyConfig {
  // Base proxy config
  openrouterApiKey: string;
  openrouterBaseUrl?: string;
  defaultModel?: string;

  // Transport selection
  transport?: 'quic' | 'http2' | 'auto';
  enableQuic?: boolean;

  // QUIC configuration
  quic?: QuicConfig;

  // Fallback behavior
  fallbackToHttp2?: boolean;
  fallbackTimeout?: number;
}

export class QuicEnabledProxy extends AnthropicToOpenRouterProxy {
  private quicClient?: QuicClient;
  private quicPool?: QuicConnectionPool;
  private transport: 'quic' | 'http2' | 'auto';
  private quicEnabled: boolean;
  private fallbackToHttp2: boolean;

  constructor(config: QuicProxyConfig) {
    super({
      openrouterApiKey: config.openrouterApiKey,
      openrouterBaseUrl: config.openrouterBaseUrl,
      defaultModel: config.defaultModel
    });

    this.transport = config.transport || 'auto';
    this.quicEnabled = config.enableQuic ?? this.checkQuicFeatureFlag();
    this.fallbackToHttp2 = config.fallbackToHttp2 ?? true;

    if (this.quicEnabled) {
      this.initializeQuic(config.quic || {});
    }
  }

  /**
   * Check if QUIC is enabled via environment variable
   */
  private checkQuicFeatureFlag(): boolean {
    const flag = process.env.AGENTIC_FLOW_ENABLE_QUIC;
    return flag === 'true' || flag === '1';
  }

  /**
   * Initialize QUIC client and connection pool
   */
  private async initializeQuic(quicConfig: QuicConfig): Promise<void> {
    try {
      logger.info('Initializing QUIC transport...', { config: quicConfig });

      this.quicClient = new QuicClient(quicConfig);
      await this.quicClient.initialize();

      this.quicPool = new QuicConnectionPool(this.quicClient, 20);

      logger.info('QUIC transport initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize QUIC transport', { error });

      if (this.fallbackToHttp2) {
        logger.warn('Falling back to HTTP/2 transport');
        this.quicEnabled = false;
      } else {
        throw error;
      }
    }
  }

  /**
   * Select transport protocol based on configuration and availability
   */
  private selectTransport(): 'quic' | 'http2' {
    if (this.transport === 'quic' && this.quicEnabled) {
      return 'quic';
    }

    if (this.transport === 'http2') {
      return 'http2';
    }

    // Auto mode: prefer QUIC if available, fallback to HTTP/2
    if (this.transport === 'auto') {
      return this.quicEnabled ? 'quic' : 'http2';
    }

    return 'http2';
  }

  /**
   * Send request using selected transport
   */
  protected async sendRequest(url: string, options: RequestInit): Promise<Response> {
    const selectedTransport = this.selectTransport();

    logger.debug('Sending request', {
      transport: selectedTransport,
      url,
      method: options.method
    });

    if (selectedTransport === 'quic') {
      return this.sendQuicRequest(url, options);
    } else {
      return this.sendHttp2Request(url, options);
    }
  }

  /**
   * Send request over QUIC
   */
  private async sendQuicRequest(url: string, options: RequestInit): Promise<Response> {
    if (!this.quicClient || !this.quicPool) {
      throw new Error('QUIC client not initialized');
    }

    try {
      const urlObj = new URL(url);
      const connection = await this.quicPool.getConnection(
        urlObj.hostname,
        parseInt(urlObj.port) || 443
      );

      logger.debug('Using QUIC connection', {
        connectionId: connection.id,
        url
      });

      // Prepare headers
      const headers: Record<string, string> = {};
      if (options.headers) {
        const headerEntries = options.headers instanceof Headers
          ? Array.from((options.headers as any).entries())
          : Object.entries(options.headers);

        for (const entry of headerEntries as Array<[string, string]>) {
          headers[entry[0]] = entry[1];
        }
      }

      // Convert body to Uint8Array
      let body: Uint8Array | undefined;
      if (options.body) {
        if (typeof options.body === 'string') {
          body = new TextEncoder().encode(options.body);
        } else if (options.body instanceof Uint8Array) {
          body = options.body;
        } else {
          body = new TextEncoder().encode(JSON.stringify(options.body));
        }
      }

      // Send HTTP/3 request over QUIC
      const response = await this.quicClient.sendRequest(
        connection.id,
        options.method || 'GET',
        urlObj.pathname + urlObj.search,
        headers,
        body
      );

      logger.info('QUIC request completed', {
        status: response.status,
        bytes: response.body.length
      });

      // Convert to fetch Response
      const responseText = new TextDecoder().decode(response.body);
      return new Response(responseText, {
        status: response.status,
        headers: new Headers(response.headers)
      }) as any;

    } catch (error) {
      logger.error('QUIC request failed', { error, url });

      if (this.fallbackToHttp2) {
        logger.warn('Falling back to HTTP/2 for this request');
        return this.sendHttp2Request(url, options);
      }

      throw error;
    }
  }

  /**
   * Send request over HTTP/2 (standard fetch)
   */
  private async sendHttp2Request(url: string, options: RequestInit): Promise<Response> {
    logger.debug('Using HTTP/2 transport', { url });
    return fetch(url, options) as any;
  }

  /**
   * Get transport statistics
   */
  getTransportStats(): any {
    if (this.quicClient) {
      return {
        transport: this.selectTransport(),
        quicEnabled: this.quicEnabled,
        quicStats: this.quicClient.getStats()
      };
    }

    return {
      transport: 'http2',
      quicEnabled: false
    };
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.quicPool) {
      await this.quicPool.clear();
    }

    if (this.quicClient) {
      await this.quicClient.shutdown();
    }

    logger.info('QUIC proxy shutdown complete');
  }
}

/**
 * Create QUIC-enabled proxy with configuration
 */
export function createQuicProxy(config: QuicProxyConfig): QuicEnabledProxy {
  const proxy = new QuicEnabledProxy(config);

  logger.info('QUIC proxy created', {
    transport: config.transport || 'auto',
    quicEnabled: config.enableQuic ?? (process.env.AGENTIC_FLOW_ENABLE_QUIC === 'true'),
    fallbackEnabled: config.fallbackToHttp2 ?? true
  });

  return proxy;
}

// CLI entry point for QUIC proxy
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3000');
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;

  if (!openrouterApiKey) {
    console.error('❌ Error: OPENROUTER_API_KEY environment variable required');
    process.exit(1);
  }

  const proxy = createQuicProxy({
    openrouterApiKey,
    openrouterBaseUrl: process.env.ANTHROPIC_PROXY_BASE_URL,
    defaultModel: process.env.COMPLETION_MODEL || process.env.REASONING_MODEL,
    transport: (process.env.TRANSPORT as 'quic' | 'http2' | 'auto') || 'auto',
    enableQuic: process.env.AGENTIC_FLOW_ENABLE_QUIC === 'true',
    quic: {
      port: parseInt(process.env.QUIC_PORT || '4433'),
      serverHost: process.env.QUIC_HOST || 'localhost',
      certPath: process.env.QUIC_CERT_PATH,
      keyPath: process.env.QUIC_KEY_PATH
    }
  });

  proxy.start(port);
  console.log(`   Proxy token (send as x-api-key / ANTHROPIC_API_KEY): ${proxy.getAuthToken()}`);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await proxy.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await proxy.shutdown();
    process.exit(0);
  });
}
