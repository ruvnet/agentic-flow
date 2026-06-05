/**
 * Authentication Middleware - API key and JWT validation
 *
 * Features:
 * - API key validation
 * - JWT token verification
 * - Role-based access control (RBAC)
 * - Audit logging
 */

import { SecurityManager, AgentTokenPayload } from '../federation/SecurityManager.js';
import { AuditLogger, AuditEventType, AuditEvent } from './audit-logger.js';

export interface AuthConfig {
  apiKeys: Set<string>;
  jwtSecret?: string;
  enableAudit?: boolean;
}

export interface AuthContext {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  apiKey?: string;
  roles?: string[];
  tokenPayload?: AgentTokenPayload;
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authentication Middleware
 *
 * Validates API keys and JWT tokens for secure access
 */
export class AuthMiddleware {
  private apiKeys: Set<string>;
  private securityManager: SecurityManager;
  private auditLogger: AuditLogger | null = null;

  constructor(config: AuthConfig) {
    this.apiKeys = new Set(config.apiKeys);
    this.securityManager = new SecurityManager();

    if (config.enableAudit) {
      this.auditLogger = new AuditLogger();
    }
  }

  /**
   * Validate API key
   *
   * @param apiKey - API key to validate
   * @returns Auth context if valid
   * @throws AuthenticationError if invalid
   */
  async validateApiKey(apiKey: string): Promise<AuthContext> {
    if (!apiKey || typeof apiKey !== 'string') {
      this.logAuthEvent('api_key_missing', false);
      throw new AuthenticationError('API key is required', 'MISSING_API_KEY');
    }

    // Remove Bearer prefix if present
    const cleanKey = apiKey.replace(/^Bearer\s+/i, '').trim();

    if (!this.apiKeys.has(cleanKey)) {
      this.logAuthEvent('api_key_invalid', false, { apiKey: cleanKey.substring(0, 8) + '...' });
      throw new AuthenticationError('Invalid API key', 'INVALID_API_KEY');
    }

    this.logAuthEvent('api_key_valid', true, { apiKey: cleanKey.substring(0, 8) + '...' });

    return {
      authenticated: true,
      apiKey: cleanKey,
      roles: ['user'],
    };
  }

  /**
   * Validate JWT token
   *
   * @param token - JWT token to validate
   * @returns Auth context with token payload
   * @throws AuthenticationError if invalid
   */
  async validateToken(token: string): Promise<AuthContext> {
    if (!token || typeof token !== 'string') {
      this.logAuthEvent('token_missing', false);
      throw new AuthenticationError('Token is required', 'MISSING_TOKEN');
    }

    // Remove Bearer prefix if present
    const cleanToken = token.replace(/^Bearer\s+/i, '').trim();

    try {
      const payload = await this.securityManager.verifyAgentToken(cleanToken);

      this.logAuthEvent('token_valid', true, {
        agentId: payload.agentId,
        tenantId: payload.tenantId,
      });

      return {
        authenticated: true,
        userId: payload.agentId,
        tenantId: payload.tenantId,
        tokenPayload: payload,
        roles: ['agent'],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('expired')) {
        this.logAuthEvent('token_expired', false);
        throw new AuthenticationError('Token has expired', 'TOKEN_EXPIRED');
      }

      if (errorMessage.includes('signature')) {
        this.logAuthEvent('token_invalid_signature', false);
        throw new AuthenticationError('Invalid token signature', 'INVALID_SIGNATURE');
      }

      this.logAuthEvent('token_invalid', false, { error: errorMessage });
      throw new AuthenticationError('Invalid token', 'INVALID_TOKEN');
    }
  }

  /**
   * Validate either API key or JWT token
   *
   * @param authorization - Authorization header value
   * @returns Auth context
   * @throws AuthenticationError if invalid
   */
  async authenticate(authorization: string): Promise<AuthContext> {
    if (!authorization) {
      throw new AuthenticationError('Authorization header is required', 'MISSING_AUTH');
    }

    // Try JWT token first (starts with "Bearer ")
    if (authorization.startsWith('Bearer ')) {
      const token = authorization.substring(7);

      // Check if it looks like a JWT (3 parts separated by dots)
      if (token.split('.').length === 3) {
        return this.validateToken(authorization);
      }

      // Otherwise treat as API key
      return this.validateApiKey(authorization);
    }

    // Try as API key
    return this.validateApiKey(authorization);
  }

  /**
   * Check if user has required role
   *
   * @param context - Auth context
   * @param requiredRole - Required role
   * @returns true if authorized
   * @throws AuthenticationError if not authorized
   */
  requireRole(context: AuthContext, requiredRole: string): boolean {
    if (!context.authenticated) {
      throw new AuthenticationError('Not authenticated', 'NOT_AUTHENTICATED');
    }

    if (!context.roles || !context.roles.includes(requiredRole)) {
      this.logAuthEvent('role_denied', false, {
        userId: context.userId,
        requiredRole,
        userRoles: context.roles,
      });
      throw new AuthenticationError(
        `Missing required role: ${requiredRole}`,
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    return true;
  }

  /**
   * Add API key
   *
   * @param apiKey - API key to add
   */
  addApiKey(apiKey: string): void {
    this.apiKeys.add(apiKey);
  }

  /**
   * Remove API key
   *
   * @param apiKey - API key to remove
   */
  removeApiKey(apiKey: string): void {
    this.apiKeys.delete(apiKey);
  }

  /**
   * Check if API key exists
   *
   * @param apiKey - API key to check
   */
  hasApiKey(apiKey: string): boolean {
    return this.apiKeys.has(apiKey);
  }

  /**
   * Get total number of API keys
   */
  getApiKeyCount(): number {
    return this.apiKeys.size;
  }

  /**
   * Log authentication event
   */
  private logAuthEvent(
    eventType: string,
    success: boolean,
    metadata?: Record<string, any>
  ): void {
    if (this.auditLogger) {
      this.auditLogger.logEvent({
        eventType: eventType as AuditEventType,
        userId: metadata?.userId || metadata?.agentId || 'anonymous',
        success,
        metadata,
      });
    }
  }

  /**
   * Get audit statistics
   */
  getAuditStats(): ReturnType<AuditLogger['getStatistics']> | undefined {
    return this.auditLogger?.getStatistics();
  }
}
