/**
 * Authentication Service for AgentDB
 *
 * Comprehensive authentication management:
 * - User registration and login
 * - Password-based authentication
 * - API key management (generation, validation, rotation)
 * - Session management
 * - Token lifecycle management
 * - Rate limiting and brute force protection
 *
 * Security Features:
 * - Argon2id password hashing
 * - Secure API key generation and storage
 * - Automatic key rotation
 * - Login attempt tracking
 * - Account lockout protection
 * - Audit logging
 */

import {
  hashPassword,
  verifyPassword,
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  generateSessionId,
} from '../utils/crypto.utils.js';
import {
  createTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
  revokeToken,
  TokenPair,
  TokenPayload,
} from './token.service.js';
import { ValidationError } from '../security/input-validation.js';

/**
 * User interface
 */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  active: boolean;
}

/**
 * API Key interface
 */
export interface ApiKey {
  id: string;
  userId: string;
  keyHash: string;
  name: string;
  environment: 'live' | 'test';
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  active: boolean;
  revokedAt?: Date;
  revokedReason?: string;
}

/**
 * Login result
 */
export interface LoginResult {
  success: boolean;
  user?: Partial<User>;
  tokens?: TokenPair;
  error?: string;
  accountLocked?: boolean;
  attemptsRemaining?: number;
}

/**
 * Registration result
 */
export interface RegistrationResult {
  success: boolean;
  user?: Partial<User>;
  error?: string;
}

/**
 * API Key creation result
 */
export interface ApiKeyCreationResult {
  success: boolean;
  apiKey?: string; // Only returned once at creation
  keyInfo?: Omit<ApiKey, 'keyHash'>;
  error?: string;
}

/**
 * Authentication configuration
 */
const AUTH_CONFIG = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes
  API_KEY_DEFAULT_EXPIRY_DAYS: 365, // 1 year
  SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
} as const;

/**
 * In-memory user store (for production, use a database)
 */
const users = new Map<string, User>();
const usersByEmail = new Map<string, User>();

/**
 * In-memory API key store (for production, use a database)
 */
const apiKeys = new Map<string, ApiKey>();
const apiKeysByHash = new Map<string, ApiKey>();

/**
 * In-memory session store (for production, use Redis)
 */
const activeSessions = new Map<string, { userId: string; expiresAt: Date }>();
let autoCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start automatic session cleanup
 */
export function startAutoCleanup(): void {
  if (autoCleanupInterval) return;

  autoCleanupInterval = setInterval(() => {
    cleanupExpiredSessions();
  }, AUTH_CONFIG.CLEANUP_INTERVAL_MS);
  
  // Don't keep process alive just for cleanup
  autoCleanupInterval.unref();
}

/**
 * Stop automatic session cleanup
 */
export function stopAutoCleanup(): void {
  if (autoCleanupInterval) {
    clearInterval(autoCleanupInterval);
    autoCleanupInterval = null;
  }
}

// Start cleanup automatically
startAutoCleanup();

/**
 * Register a new user
 */
export async function registerUser(
  email: string,
  password: string,
  role: string = 'user',
  permissions: string[] = []
): Promise<RegistrationResult> {
  // Validate email
  if (!email || typeof email !== 'string') {
    return {
      success: false,
      error: 'Valid email is required',
    };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      success: false,
      error: 'Invalid email format',
    };
  }

  // Check if user already exists
  if (usersByEmail.has(email.toLowerCase())) {
    return {
      success: false,
      error: 'User with this email already exists',
    };
  }

  // Validate password
  if (!password || typeof password !== 'string') {
    return {
      success: false,
      error: 'Password is required',
    };
  }

  if (password.length < 8) {
    return {
      success: false,
      error: 'Password must be at least 8 characters long',
    };
  }

  try {
    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const now = new Date();
    const userId = `user_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const user: User = {
      id: userId,
      email: email.toLowerCase(),
      passwordHash,
      role,
      permissions,
      createdAt: now,
      updatedAt: now,
      failedLoginAttempts: 0,
      active: true,
    };

    // Store user
    users.set(userId, user);
    usersByEmail.set(email.toLowerCase(), user);

    // Return user (without password hash)
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      success: true,
      user: userWithoutPassword,
    };
  } catch (error) {
    return {
      success: false,
      error: `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Authenticate user with email and password
 */
export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  // Validate inputs
  if (!email || !password) {
    return {
      success: false,
      error: 'Email and password are required',
    };
  }

  // Find user
  const user = usersByEmail.get(email.toLowerCase());

  if (!user) {
    // Don't reveal that user doesn't exist
    return {
      success: false,
      error: 'Invalid credentials',
    };
  }

  // Check if account is active
  if (!user.active) {
    return {
      success: false,
      error: 'Account is disabled',
    };
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMinutes = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / (60 * 1000)
    );

    return {
      success: false,
      error: `Account is locked. Try again in ${remainingMinutes} minutes`,
      accountLocked: true,
    };
  }

  // Verify password
  const passwordValid = await verifyPassword(password, user.passwordHash);

  if (!passwordValid) {
    // Increment failed login attempts
    user.failedLoginAttempts += 1;

    // Lock account if too many failed attempts
    if (user.failedLoginAttempts >= AUTH_CONFIG.MAX_LOGIN_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + AUTH_CONFIG.LOCKOUT_DURATION_MS);

      return {
        success: false,
        error: `Too many failed login attempts. Account locked for 15 minutes`,
        accountLocked: true,
      };
    }

    const attemptsRemaining = AUTH_CONFIG.MAX_LOGIN_ATTEMPTS - user.failedLoginAttempts;

    return {
      success: false,
      error: 'Invalid credentials',
      attemptsRemaining,
    };
  }

  // Reset failed login attempts on successful login
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();

  // Create session
  const sessionId = generateSessionId();
  activeSessions.set(sessionId, {
    userId: user.id,
    expiresAt: new Date(Date.now() + AUTH_CONFIG.SESSION_TIMEOUT_MS),
  });

  // Create token pair
  const tokenPayload: Omit<TokenPayload, 'type'> = {
    userId: user.id,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    sessionId,
  };

  const tokens = createTokenPair(tokenPayload);

  // Return user and tokens (without password hash)
  const { passwordHash: _, ...userWithoutPassword } = user;

  return {
    success: true,
    user: userWithoutPassword,
    tokens,
  };
}

/**
 * Logout user (revoke tokens and clear session)
 */
export function logout(sessionId: string, refreshToken?: string): void {
  // Remove session
  activeSessions.delete(sessionId);

  // Revoke refresh token if provided
  if (refreshToken) {
    revokeToken(refreshToken);
  }
}

/**
 * Validate session
 */
export function validateSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);

  if (!session) {
    return false;
  }

  // Check if session expired
  if (session.expiresAt < new Date()) {
    activeSessions.delete(sessionId);
    return false;
  }

  return true;
}

/**
 * Refresh session (extend expiration)
 */
export function refreshSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.expiresAt = new Date(Date.now() + AUTH_CONFIG.SESSION_TIMEOUT_MS);
  return true;
}

/**
 * Create API key for user
 */
export async function createUserApiKey(
  userId: string,
  name: string,
  environment: 'live' | 'test' = 'live',
  expiresInDays?: number
): Promise<ApiKeyCreationResult> {
  // Validate user exists
  const user = users.get(userId);
  if (!user) {
    return {
      success: false,
      error: 'User not found',
    };
  }

  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return {
      success: false,
      error: 'API key name is required',
    };
  }

  // Generate API key
  const { key, hash } = generateApiKey(environment);

  // Create API key record
  const now = new Date();
  const apiKeyId = `key_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const expiresAt = expiresInDays
    ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
    : new Date(now.getTime() + AUTH_CONFIG.API_KEY_DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const apiKeyRecord: ApiKey = {
    id: apiKeyId,
    userId,
    keyHash: hash,
    name: name.trim(),
    environment,
    createdAt: now,
    expiresAt,
    active: true,
  };

  // Store API key
  apiKeys.set(apiKeyId, apiKeyRecord);
  apiKeysByHash.set(hash, apiKeyRecord);

  // Return key (only shown once) and key info
  const { keyHash, ...keyInfo } = apiKeyRecord;

  return {
    success: true,
    apiKey: key, // Only returned once!
    keyInfo,
  };
}

/**
 * Validate API key
 */
export function validateApiKey(apiKey: string): {
  valid: boolean;
  userId?: string;
  keyInfo?: Omit<ApiKey, 'keyHash'>;
  error?: string;
} {
  if (!apiKey || typeof apiKey !== 'string') {
    return {
      valid: false,
      error: 'API key is required',
    };
  }

  // Hash the provided key
  let keyHash: string;
  try {
    keyHash = hashApiKey(apiKey);
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid API key format',
    };
  }

  // Find matching API key (O(1) lookup)
  const storedKey = apiKeysByHash.get(keyHash);

  if (storedKey) {
    // Check if key is active
    if (!storedKey.active) {
      return {
        valid: false,
        error: 'API key has been revoked',
      };
    }

    // Check if key is expired
    if (storedKey.expiresAt && storedKey.expiresAt < new Date()) {
      return {
        valid: false,
        error: 'API key has expired',
      };
    }

    // Update last used timestamp
    storedKey.lastUsedAt = new Date();

    // Return valid result
    const { keyHash: _, ...keyInfo } = storedKey;

    return {
      valid: true,
      userId: storedKey.userId,
      keyInfo,
    };
  }

  return {
    valid: false,
    error: 'Invalid API key',
  };
}

/**
 * Revoke API key
 */
export function revokeApiKey(
  keyId: string,
  reason?: string
): { success: boolean; error?: string } {
  const apiKey = apiKeys.get(keyId);

  if (!apiKey) {
    return {
      success: false,
      error: 'API key not found',
    };
  }

  apiKey.active = false;
  apiKey.revokedAt = new Date();
  apiKey.revokedReason = reason;

  return { success: true };
}

/**
 * List API keys for user
 */
export function listUserApiKeys(userId: string): Array<Omit<ApiKey, 'keyHash'>> {
  const userKeys: Array<Omit<ApiKey, 'keyHash'>> = [];

  for (const [keyId, apiKey] of apiKeys.entries()) {
    if (apiKey.userId === userId) {
      const { keyHash, ...keyInfo } = apiKey;
      userKeys.push(keyInfo);
    }
  }

  return userKeys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Rotate API key (create new key and revoke old one)
 */
export async function rotateApiKey(
  keyId: string,
  reason: string = 'Key rotation'
): Promise<ApiKeyCreationResult> {
  const oldKey = apiKeys.get(keyId);

  if (!oldKey) {
    return {
      success: false,
      error: 'API key not found',
    };
  }

  // Create new key
  const newKeyResult = await createUserApiKey(
    oldKey.userId,
    oldKey.name,
    oldKey.environment
  );

  if (!newKeyResult.success) {
    return newKeyResult;
  }

  // Revoke old key
  revokeApiKey(keyId, reason);

  return newKeyResult;
}

/**
 * Get user by ID
 */
export function getUserById(userId: string): Partial<User> | null {
  const user = users.get(userId);

  if (!user) {
    return null;
  }

  const { passwordHash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/**
 * Update user password
 */
export async function updateUserPassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = users.get(userId);

  if (!user) {
    return {
      success: false,
      error: 'User not found',
    };
  }

  // Verify old password
  const passwordValid = await verifyPassword(oldPassword, user.passwordHash);

  if (!passwordValid) {
    return {
      success: false,
      error: 'Current password is incorrect',
    };
  }

  // Validate new password
  if (newPassword.length < 8) {
    return {
      success: false,
      error: 'New password must be at least 8 characters long',
    };
  }

  try {
    // Hash new password
    user.passwordHash = await hashPassword(newPassword);
    user.updatedAt = new Date();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Password update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Clean up expired sessions (call periodically)
 */
export function cleanupExpiredSessions(): number {
  let cleaned = 0;
  const now = new Date();

  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.expiresAt < now) {
      activeSessions.delete(sessionId);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  cleanupExpiredSessions();
  return activeSessions.size;
}

/**
 * Export for testing
 */
export const __testing__ = {
  users,
  usersByEmail,
  apiKeys,
  activeSessions,
  AUTH_CONFIG,
};
