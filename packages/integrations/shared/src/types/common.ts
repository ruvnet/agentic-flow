/**
 * Common Types for Bridge Interfaces
 *
 * Shared type definitions used across all bridge implementations
 */

/**
 * Configuration base for all bridges
 */
export interface BridgeConfig {
  /** Enable verbose logging */
  debug?: boolean;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry delay in milliseconds */
  retryDelayMs?: number;
}

/**
 * Bridge operation result
 */
export interface BridgeResult<T = any> {
  /** Operation success status */
  success: boolean;
  /** Result data if successful */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Performance metrics */
  metrics: BridgeMetrics;
}

/**
 * Performance metrics for bridge operations
 */
export interface BridgeMetrics {
  /** Operation latency in milliseconds */
  latencyMs: number;
  /** Operation start timestamp */
  startTime: number;
  /** Operation end timestamp */
  endTime: number;
  /** Success rate (0-1) */
  successRate?: number;
  /** Additional custom metrics */
  custom?: Record<string, number>;
}

/**
 * Error types for bridges
 */
export enum BridgeErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  INVALID_INPUT = 'INVALID_INPUT',
  OPERATION_FAILED = 'OPERATION_FAILED',
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
}

/**
 * Bridge error class
 */
export class BridgeError extends Error {
  constructor(
    public code: BridgeErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
