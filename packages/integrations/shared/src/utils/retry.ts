/**
 * Retry Utility
 *
 * Implements exponential backoff retry logic for bridge operations
 */

import { RetryConfig, Logger } from '../types/common.js';
import { createLogger } from './logger.js';

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
};

/**
 * Execute an operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  logger?: Logger
): Promise<T> {
  const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const log = logger || createLogger('[Retry]');

  let lastError: Error | undefined;
  let currentDelay = retryConfig.delayMs;

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    try {
      log.debug(`Attempt ${attempt}/${retryConfig.maxAttempts}`);
      const result = await operation();

      if (attempt > 1) {
        log.info(`Operation succeeded on attempt ${attempt}`);
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      if (attempt === retryConfig.maxAttempts) {
        log.error(`All ${retryConfig.maxAttempts} attempts failed`);
        break;
      }

      log.warn(
        `Attempt ${attempt} failed: ${lastError.message}. Retrying in ${currentDelay}ms...`
      );

      await sleep(currentDelay);

      // Exponential backoff
      if (retryConfig.backoffMultiplier) {
        currentDelay = Math.min(
          currentDelay * retryConfig.backoffMultiplier,
          retryConfig.maxDelayMs || Infinity
        );
      }
    }
  }

  throw lastError;
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute operation with timeout
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    ),
  ]);
}
