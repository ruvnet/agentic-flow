/**
 * Validation Utility
 *
 * Input validation functions for bridge operations
 */

import { BridgeError, BridgeErrorCode } from '../types/common.js';

/**
 * Validate that a value is not null or undefined
 */
export function validateRequired<T>(
  value: T | null | undefined,
  fieldName: string
): T {
  if (value === null || value === undefined) {
    throw new BridgeError(
      BridgeErrorCode.INVALID_INPUT,
      `${fieldName} is required`
    );
  }
  return value;
}

/**
 * Validate string is not empty
 */
export function validateNonEmptyString(
  value: string,
  fieldName: string
): string {
  validateRequired(value, fieldName);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BridgeError(
      BridgeErrorCode.INVALID_INPUT,
      `${fieldName} must be a non-empty string`
    );
  }
  return value;
}

/**
 * Validate number is positive
 */
export function validatePositiveNumber(
  value: number,
  fieldName: string
): number {
  validateRequired(value, fieldName);
  if (typeof value !== 'number' || value <= 0 || isNaN(value)) {
    throw new BridgeError(
      BridgeErrorCode.INVALID_INPUT,
      `${fieldName} must be a positive number`
    );
  }
  return value;
}

/**
 * Validate array is not empty
 */
export function validateNonEmptyArray<T>(
  value: T[],
  fieldName: string
): T[] {
  validateRequired(value, fieldName);
  if (!Array.isArray(value) || value.length === 0) {
    throw new BridgeError(
      BridgeErrorCode.INVALID_INPUT,
      `${fieldName} must be a non-empty array`
    );
  }
  return value;
}

/**
 * Validate object has required properties
 */
export function validateObject<T extends Record<string, any>>(
  value: T,
  requiredFields: string[],
  objectName: string
): T {
  validateRequired(value, objectName);
  if (typeof value !== 'object') {
    throw new BridgeError(
      BridgeErrorCode.INVALID_INPUT,
      `${objectName} must be an object`
    );
  }

  for (const field of requiredFields) {
    if (!(field in value)) {
      throw new BridgeError(
        BridgeErrorCode.INVALID_INPUT,
        `${objectName} is missing required field: ${field}`
      );
    }
  }

  return value;
}

/**
 * Validate number is within range
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): number {
  validatePositiveNumber(value, fieldName);
  if (value < min || value > max) {
    throw new BridgeError(
      BridgeErrorCode.INVALID_INPUT,
      `${fieldName} must be between ${min} and ${max}`
    );
  }
  return value;
}

/**
 * Validate enum value
 */
export function validateEnum<T>(
  value: T,
  validValues: T[],
  fieldName: string
): T {
  validateRequired(value, fieldName);
  if (!validValues.includes(value)) {
    throw new BridgeError(
      BridgeErrorCode.INVALID_INPUT,
      `${fieldName} must be one of: ${validValues.join(', ')}`
    );
  }
  return value;
}
