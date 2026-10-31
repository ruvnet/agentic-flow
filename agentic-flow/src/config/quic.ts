// QUIC Configuration Schema
// Validates and manages QUIC transport configuration

import { QuicConfig } from '../transport/quic.js';
import { logger } from '../utils/logger.js';

export interface QuicConfigSchema extends QuicConfig {
  enabled: boolean;
  autoDetect: boolean;
  fallbackToHttp2: boolean;
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
  };
  monitoring: {
    enabled: boolean;
    logInterval: number;
  };
}

/**
 * Default QUIC configuration
 */
export const DEFAULT_QUIC_CONFIG: QuicConfigSchema = {
  enabled: false,
  autoDetect: true,
  fallbackToHttp2: true,

  // Connection settings
  host: '127.0.0.1',
  port: 4433,
  serverHost: 'localhost',
  serverPort: 4433,
  verifyPeer: true,

  // TLS certificates
  certPath: './certs/cert.pem',
  keyPath: './certs/key.pem',

  // Connection pool
  maxConnections: 100,
  connectionTimeout: 30000,
  idleTimeout: 60000,

  // Stream multiplexing
  maxConcurrentStreams: 100,
  streamTimeout: 30000,

  // Performance tuning
  initialCongestionWindow: 10,
  maxDatagramSize: 1200,
  enableEarlyData: true,

  // Health check
  healthCheck: {
    enabled: true,
    interval: 30000, // 30 seconds
    timeout: 5000 // 5 seconds
  },

  // Monitoring
  monitoring: {
    enabled: true,
    logInterval: 60000 // 1 minute
  }
};

/**
 * Load QUIC configuration from environment and config file
 */
export function loadQuicConfig(overrides: Partial<QuicConfigSchema> = {}): QuicConfigSchema {
  const config: QuicConfigSchema = {
    ...DEFAULT_QUIC_CONFIG,
    ...overrides
  };

  // Environment variable overrides
  if (process.env.AGENTIC_FLOW_ENABLE_QUIC !== undefined) {
    config.enabled = process.env.AGENTIC_FLOW_ENABLE_QUIC === 'true';
  }

  if (process.env.QUIC_PORT) {
    config.port = parseInt(process.env.QUIC_PORT);
  }

  if (process.env.QUIC_HOST) {
    config.host = process.env.QUIC_HOST;
  }

  if (process.env.QUIC_SERVER_HOST) {
    config.serverHost = process.env.QUIC_SERVER_HOST;
  }

  if (process.env.QUIC_SERVER_PORT) {
    config.serverPort = parseInt(process.env.QUIC_SERVER_PORT);
  }

  if (process.env.QUIC_CERT_PATH) {
    config.certPath = process.env.QUIC_CERT_PATH;
  }

  if (process.env.QUIC_KEY_PATH) {
    config.keyPath = process.env.QUIC_KEY_PATH;
  }

  if (process.env.QUIC_MAX_CONNECTIONS) {
    config.maxConnections = parseInt(process.env.QUIC_MAX_CONNECTIONS);
  }

  if (process.env.QUIC_MAX_STREAMS) {
    config.maxConcurrentStreams = parseInt(process.env.QUIC_MAX_STREAMS);
  }

  if (process.env.QUIC_VERIFY_PEER !== undefined) {
    config.verifyPeer = process.env.QUIC_VERIFY_PEER === 'true';
  }

  // Validate configuration
  validateQuicConfig(config);

  logger.info('QUIC configuration loaded', {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    maxConnections: config.maxConnections,
    healthCheckEnabled: config.healthCheck.enabled
  });

  return config;
}

/**
 * Validate QUIC configuration
 */
export function validateQuicConfig(config: QuicConfigSchema): void {
  const errors: string[] = [];

  // Port validation
  if (config.port! < 1 || config.port! > 65535) {
    errors.push(`Invalid port: ${config.port}. Must be between 1 and 65535.`);
  }

  if (config.serverPort! < 1 || config.serverPort! > 65535) {
    errors.push(`Invalid server port: ${config.serverPort}. Must be between 1 and 65535.`);
  }

  // Connection limits
  if (config.maxConnections! < 1) {
    errors.push(`Invalid maxConnections: ${config.maxConnections}. Must be at least 1.`);
  }

  if (config.maxConcurrentStreams! < 1) {
    errors.push(`Invalid maxConcurrentStreams: ${config.maxConcurrentStreams}. Must be at least 1.`);
  }

  // Timeouts
  if (config.connectionTimeout! < 1000) {
    errors.push(`Invalid connectionTimeout: ${config.connectionTimeout}. Must be at least 1000ms.`);
  }

  if (config.idleTimeout! < 1000) {
    errors.push(`Invalid idleTimeout: ${config.idleTimeout}. Must be at least 1000ms.`);
  }

  if (config.streamTimeout! < 1000) {
    errors.push(`Invalid streamTimeout: ${config.streamTimeout}. Must be at least 1000ms.`);
  }

  // Performance tuning
  if (config.initialCongestionWindow! < 1) {
    errors.push(`Invalid initialCongestionWindow: ${config.initialCongestionWindow}. Must be at least 1.`);
  }

  if (config.maxDatagramSize! < 1200 || config.maxDatagramSize! > 65527) {
    errors.push(`Invalid maxDatagramSize: ${config.maxDatagramSize}. Must be between 1200 and 65527.`);
  }

  // TLS certificates (warn only)
  if (config.enabled && config.verifyPeer) {
    const fs = require('fs');
    if (!fs.existsSync(config.certPath)) {
      logger.warn(`Certificate not found: ${config.certPath}`);
    }
    if (!fs.existsSync(config.keyPath)) {
      logger.warn(`Private key not found: ${config.keyPath}`);
    }
  }

  if (errors.length > 0) {
    const errorMessage = `QUIC configuration validation failed:\n${errors.join('\n')}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Get QUIC configuration for router integration
 */
export function getQuicRouterConfig(config: QuicConfigSchema) {
  return {
    transport: {
      quic: {
        enabled: config.enabled,
        port: config.port,
        host: config.host,
        maxConnections: config.maxConnections,
        certPath: config.certPath,
        keyPath: config.keyPath
      },
      fallback: {
        enabled: config.fallbackToHttp2,
        protocol: 'http2'
      }
    }
  };
}

/**
 * Check if QUIC is available and properly configured
 */
export async function checkQuicAvailability(): Promise<{
  available: boolean;
  reason?: string;
}> {
  try {
    // Check if WASM module is available
    // This will be implemented when WASM module is integrated
    const wasmAvailable = true; // Placeholder

    if (!wasmAvailable) {
      return {
        available: false,
        reason: 'QUIC WASM module not available'
      };
    }

    // Check if certificates exist (for server mode)
    const config = loadQuicConfig();
    if (config.enabled && config.verifyPeer) {
      const fs = require('fs');
      if (!fs.existsSync(config.certPath) || !fs.existsSync(config.keyPath)) {
        return {
          available: false,
          reason: 'TLS certificates not found'
        };
      }
    }

    return { available: true };
  } catch (error) {
    logger.error('Error checking QUIC availability', { error });
    return {
      available: false,
      reason: (error as Error).message
    };
  }
}

/**
 * Simplified config getter (alias for loadQuicConfig)
 */
export function getQuicConfig(overrides: Partial<QuicConfigSchema> = {}): QuicConfigSchema {
  return loadQuicConfig(overrides);
}
