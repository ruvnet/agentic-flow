/**
 * Input Validation Utilities
 *
 * Provides secure input validation for RuVector integration:
 * - Task description validation
 * - Configuration validation
 * - Injection attack prevention (prompt injection via aidefence when installed)
 * - Resource exhaustion prevention
 */

import { scanPromptInjection, type InjectionScan } from '../integrations/prompt-injection.js';

export interface ValidationOptions {
  maxLength?: number;
  minLength?: number;
  allowEmpty?: boolean;
  sanitize?: boolean;
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when task text is rejected by the prompt-injection policy. */
export class PromptInjectionError extends ValidationError {
  constructor(public scan: InjectionScan, field = 'taskDescription') {
    const top = scan.threats[0];
    super(
      `Task description rejected: possible prompt injection (${scan.maxSeverity}` +
        (top ? `, ${top.type}` : '') + `; engine ${scan.engine})`,
      field,
    );
    this.name = 'PromptInjectionError';
  }
}

/**
 * Input Validator
 *
 * Validates all external inputs to prevent:
 * - Injection attacks (XSS, SQL injection, and prompt injection — the latter
 *   through `scanPromptInjection`, see integrations/prompt-injection.ts)
 * - Resource exhaustion (excessive length, recursion)
 * - Malicious content (scripts, control characters)
 */
export class InputValidator {
  // Suspicious patterns that could indicate attacks
  private static readonly SUSPICIOUS_PATTERNS = [
    /<script/i,                    // XSS attempt
    /javascript:/i,                // JavaScript protocol
    /data:text\/html/i,            // Data URI XSS
    /on\w+\s*=/i,                  // Event handlers
    /\beval\s*\(/i,                // eval() calls
    /\bFunction\s*\(/i,            // Function constructor
    /__proto__/,                   // Prototype pollution
    /\.\.\//,                      // Path traversal
    /[;\x00]/,                     // SQL injection chars
  ];

  private static readonly warnedInjections = new Set<string>();

  // Control characters that should be removed
  private static readonly CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/g;

  /**
   * Validate task description
   *
   * @param taskDescription - User-provided task description
   * @param options - Validation options
   * @returns Sanitized task description
   * @throws ValidationError if invalid
   */
  static validateTaskDescription(
    taskDescription: string,
    options?: ValidationOptions
  ): string {
    const opts = {
      maxLength: options?.maxLength ?? 10000,
      minLength: options?.minLength ?? 1,
      allowEmpty: options?.allowEmpty ?? false,
      sanitize: options?.sanitize ?? true,
    };

    // Check for null/undefined
    if (taskDescription === null || taskDescription === undefined) {
      throw new ValidationError('Task description is required', 'taskDescription');
    }

    // Check type
    if (typeof taskDescription !== 'string') {
      throw new ValidationError(
        `Task description must be a string, got ${typeof taskDescription}`,
        'taskDescription'
      );
    }

    // Check empty
    if (!opts.allowEmpty && taskDescription.trim().length === 0) {
      throw new ValidationError('Task description cannot be empty', 'taskDescription');
    }

    // Check length
    if (taskDescription.length < opts.minLength) {
      throw new ValidationError(
        `Task description too short (min ${opts.minLength} chars)`,
        'taskDescription'
      );
    }

    if (taskDescription.length > opts.maxLength) {
      throw new ValidationError(
        `Task description too long (max ${opts.maxLength} chars)`,
        'taskDescription'
      );
    }

    // Sanitize if requested
    let sanitized = taskDescription;
    if (opts.sanitize) {
      // Remove control characters
      sanitized = sanitized.replace(InputValidator.CONTROL_CHARS_REGEX, '');

      // Check for suspicious patterns
      for (const pattern of InputValidator.SUSPICIOUS_PATTERNS) {
        if (pattern.test(sanitized)) {
          throw new ValidationError(
            'Task description contains suspicious content',
            'taskDescription'
          );
        }
      }

      // Prompt injection (aidefence when installed, built-in patterns otherwise)
      const scan = scanPromptInjection(sanitized);
      if (scan.decision === 'block') {
        throw new PromptInjectionError(scan);
      }
      if (scan.decision === 'warn') {
        const message =
          `possible prompt injection in task description (${scan.maxSeverity}: ` +
          `${scan.threats.map((t) => t.type).join(', ')}; engine ${scan.engine})`;
        // Once per distinct finding: an orchestrator loop would otherwise repeat it.
        if (!InputValidator.warnedInjections.has(message)) {
          InputValidator.warnedInjections.add(message);
          process.emitWarning(message, { code: 'AGENTIC_FLOW_PROMPT_INJECTION' });
        }
      }
    }

    return sanitized.trim();
  }

  /**
   * Validate agent name
   *
   * @param agentName - Agent identifier
   * @returns Sanitized agent name
   * @throws ValidationError if invalid
   */
  static validateAgentName(agentName: string): string {
    if (!agentName || typeof agentName !== 'string') {
      throw new ValidationError('Agent name is required', 'agentName');
    }

    if (agentName.length < 1 || agentName.length > 100) {
      throw new ValidationError(
        'Agent name must be between 1-100 characters',
        'agentName'
      );
    }

    // Only allow alphanumeric, dash, underscore
    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      throw new ValidationError(
        'Agent name can only contain letters, numbers, dash, and underscore',
        'agentName'
      );
    }

    return agentName.toLowerCase();
  }

  /**
   * Validate confidence score
   *
   * @param confidence - Confidence score (0-1)
   * @returns Validated confidence
   * @throws ValidationError if invalid
   */
  static validateConfidence(confidence: number): number {
    if (typeof confidence !== 'number') {
      throw new ValidationError(
        `Confidence must be a number, got ${typeof confidence}`,
        'confidence'
      );
    }

    if (Number.isNaN(confidence) || !Number.isFinite(confidence)) {
      throw new ValidationError('Confidence must be a valid number', 'confidence');
    }

    if (confidence < 0 || confidence > 1) {
      throw new ValidationError('Confidence must be between 0 and 1', 'confidence');
    }

    return confidence;
  }

  /**
   * Validate timeout value
   *
   * @param timeout - Timeout in milliseconds
   * @param min - Minimum allowed timeout (default: 100ms)
   * @param max - Maximum allowed timeout (default: 5 minutes)
   * @returns Validated timeout
   * @throws ValidationError if invalid
   */
  static validateTimeout(
    timeout: number,
    min: number = 100,
    max: number = 300000
  ): number {
    if (typeof timeout !== 'number') {
      throw new ValidationError(
        `Timeout must be a number, got ${typeof timeout}`,
        'timeout'
      );
    }

    if (Number.isNaN(timeout) || !Number.isFinite(timeout)) {
      throw new ValidationError('Timeout must be a valid number', 'timeout');
    }

    if (timeout < min) {
      throw new ValidationError(`Timeout too short (min ${min}ms)`, 'timeout');
    }

    if (timeout > max) {
      throw new ValidationError(`Timeout too long (max ${max}ms)`, 'timeout');
    }

    return Math.floor(timeout);
  }

  /**
   * Validate array of strings
   *
   * @param array - Array to validate
   * @param fieldName - Field name for error messages
   * @param maxItems - Maximum number of items
   * @param maxLength - Maximum length per item
   * @returns Validated array
   * @throws ValidationError if invalid
   */
  static validateStringArray(
    array: unknown,
    fieldName: string,
    maxItems: number = 100,
    maxLength: number = 1000
  ): string[] {
    if (!Array.isArray(array)) {
      throw new ValidationError(`${fieldName} must be an array`, fieldName);
    }

    if (array.length > maxItems) {
      throw new ValidationError(
        `${fieldName} has too many items (max ${maxItems})`,
        fieldName
      );
    }

    const validated: string[] = [];
    for (let i = 0; i < array.length; i++) {
      const item = array[i];

      if (typeof item !== 'string') {
        throw new ValidationError(
          `${fieldName}[${i}] must be a string`,
          fieldName
        );
      }

      if (item.length > maxLength) {
        throw new ValidationError(
          `${fieldName}[${i}] too long (max ${maxLength} chars)`,
          fieldName
        );
      }

      validated.push(item);
    }

    return validated;
  }

  /**
   * Validate configuration object
   *
   * @param config - Configuration to validate
   * @param schema - Validation schema
   * @returns Validated configuration
   * @throws ValidationError if invalid
   */
  static validateConfig<T extends Record<string, any>>(
    config: unknown,
    schema: {
      [K in keyof T]: {
        type: 'string' | 'number' | 'boolean' | 'object';
        required?: boolean;
        min?: number;
        max?: number;
        validator?: (value: any) => boolean;
      };
    }
  ): T {
    if (!config || typeof config !== 'object') {
      throw new ValidationError('Configuration must be an object', 'config');
    }

    const validated: any = {};
    const configObj = config as Record<string, any>;

    for (const [key, rules] of Object.entries(schema)) {
      const value = configObj[key];

      // Check required
      if (rules.required && (value === undefined || value === null)) {
        throw new ValidationError(`Configuration field '${key}' is required`, key);
      }

      // Skip if optional and not provided
      if (!rules.required && (value === undefined || value === null)) {
        continue;
      }

      // Check type
      if (typeof value !== rules.type) {
        throw new ValidationError(
          `Configuration field '${key}' must be ${rules.type}, got ${typeof value}`,
          key
        );
      }

      // Validate numbers
      if (rules.type === 'number') {
        if (Number.isNaN(value) || !Number.isFinite(value)) {
          throw new ValidationError(
            `Configuration field '${key}' must be a valid number`,
            key
          );
        }

        if (rules.min !== undefined && value < rules.min) {
          throw new ValidationError(
            `Configuration field '${key}' must be >= ${rules.min}`,
            key
          );
        }

        if (rules.max !== undefined && value > rules.max) {
          throw new ValidationError(
            `Configuration field '${key}' must be <= ${rules.max}`,
            key
          );
        }
      }

      // Custom validator
      if (rules.validator && !rules.validator(value)) {
        throw new ValidationError(
          `Configuration field '${key}' failed validation`,
          key
        );
      }

      validated[key] = value;
    }

    return validated as T;
  }

  /**
   * Sanitize HTML to prevent XSS
   *
   * @param html - HTML string to sanitize
   * @returns Sanitized HTML (text only)
   */
  static sanitizeHtml(html: string): string {
    if (typeof html !== 'string') {
      return '';
    }

    // Strip all HTML tags, keep text only
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'");
  }

  /**
   * Validate email address
   *
   * @param email - Email to validate
   * @returns Normalized email
   * @throws ValidationError if invalid
   */
  static validateEmail(email: string): string {
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required', 'email');
    }

    // Basic email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format', 'email');
    }

    if (email.length > 254) {
      throw new ValidationError('Email too long (max 254 chars)', 'email');
    }

    return email.toLowerCase().trim();
  }
}

/**
 * Validation middleware factory
 *
 * Creates validation middleware for Express/Fastify routes
 */
export function createValidationMiddleware(
  validator: (req: any) => void | Promise<void>
) {
  return async (req: any, res: any, next: any) => {
    try {
      await validator(req);
      next();
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: 'Validation Error',
          message: error.message,
          field: error.field,
        });
      } else {
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Validation failed',
        });
      }
    }
  };
}
