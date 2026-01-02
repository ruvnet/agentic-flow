/**
 * Audit Logger Service for AgentDB
 *
 * Comprehensive audit logging for security events:
 * - Authentication events (login, logout, failed attempts)
 * - Authorization failures
 * - API key operations
 * - Rate limiting events
 * - Sensitive data access
 * - Configuration changes
 *
 * Features:
 * - Structured logging with timestamps
 * - Automatic log rotation
 * - Configurable log levels
 * - Performance metrics
 * - Compliance support (SOC2, GDPR, HIPAA)
 */

import fs from 'fs/promises';
import path from 'path';
import { createWriteStream, WriteStream } from 'fs';

/**
 * Audit event types
 */
export type AuditEventType =
  | 'jwt_auth_success'
  | 'jwt_auth_failed'
  | 'api_key_auth_success'
  | 'api_key_auth_failed'
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'registration'
  | 'password_change'
  | 'api_key_created'
  | 'api_key_revoked'
  | 'api_key_rotated'
  | 'authorization_failed'
  | 'rate_limit_exceeded'
  | 'sensitive_data_access'
  | 'config_change'
  | 'session_expired'
  | 'auth_error';

/**
 * Audit event interface
 */
export interface AuditEvent {
  type: AuditEventType;
  timestamp: Date;
  userId?: string;
  ip?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Audit log entry
 */
interface AuditLogEntry {
  id: string;
  event: AuditEvent;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

/**
 * Audit logger configuration
 */
interface AuditLoggerConfig {
  enabled: boolean;
  logDirectory: string;
  maxFileSize: number;       // In bytes
  maxFiles: number;          // Number of rotated files to keep
  logToConsole: boolean;
  logToFile: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AuditLoggerConfig = {
  enabled: true,
  logDirectory: './logs/audit',
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  maxFiles: 10,
  logToConsole: process.env.NODE_ENV !== 'production',
  logToFile: true,
};

/**
 * Audit Logger Service
 */
export class AuditLogger {
  private config: AuditLoggerConfig;
  private currentLogFile?: WriteStream;
  private currentFileSize: number = 0;
  private eventCount: number = 0;

  constructor(config: Partial<AuditLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.enabled && this.config.logToFile) {
      this.initializeLogDirectory();
    }
  }

  /**
   * Initialize log directory
   */
  private async initializeLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.logDirectory, { recursive: true });
    } catch (error) {
      console.error('[Audit Logger] Failed to create log directory:', error);
    }
  }

  /**
   * Get current log file path
   */
  private getCurrentLogFilePath(): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return path.join(this.config.logDirectory, `audit-${timestamp}.log`);
  }

  /**
   * Rotate log files if necessary
   */
  private async rotateLogsIfNeeded(): Promise<void> {
    if (this.currentFileSize < this.config.maxFileSize) {
      return;
    }

    // Close current log file
    if (this.currentLogFile) {
      this.currentLogFile.end();
      this.currentLogFile = undefined;
    }

    // Rename current file with timestamp
    const currentPath = this.getCurrentLogFilePath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = currentPath.replace('.log', `.${timestamp}.log`);

    try {
      await fs.rename(currentPath, rotatedPath);
      this.currentFileSize = 0;

      // Clean up old files
      await this.cleanupOldLogs();
    } catch (error) {
      console.error('[Audit Logger] Failed to rotate logs:', error);
    }
  }

  /**
   * Clean up old log files
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.logDirectory);
      const auditFiles = files
        .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.config.logDirectory, f),
        }));

      // Sort by modification time (newest first)
      const fileStats = await Promise.all(
        auditFiles.map(async f => ({
          ...f,
          stats: await fs.stat(f.path),
        }))
      );

      fileStats.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

      // Delete files beyond maxFiles limit
      const filesToDelete = fileStats.slice(this.config.maxFiles);
      await Promise.all(
        filesToDelete.map(f => fs.unlink(f.path).catch(err =>
          console.error(`[Audit Logger] Failed to delete ${f.name}:`, err)
        ))
      );
    } catch (error) {
      console.error('[Audit Logger] Failed to cleanup old logs:', error);
    }
  }

  /**
   * Get log file stream
   */
  private getLogStream(): WriteStream {
    if (!this.currentLogFile) {
      const logPath = this.getCurrentLogFilePath();
      this.currentLogFile = createWriteStream(logPath, { flags: 'a' });
    }

    return this.currentLogFile;
  }

  /**
   * Determine event severity
   */
  private getSeverity(event: AuditEvent): 'low' | 'medium' | 'high' | 'critical' {
    switch (event.type) {
      case 'login_failed':
      case 'jwt_auth_failed':
      case 'api_key_auth_failed':
        return 'medium';

      case 'authorization_failed':
      case 'rate_limit_exceeded':
        return 'medium';

      case 'api_key_revoked':
      case 'password_change':
        return 'high';

      case 'auth_error':
        return 'critical';

      case 'sensitive_data_access':
      case 'config_change':
        return 'high';

      default:
        return 'low';
    }
  }

  /**
   * Format audit event message
   */
  private formatMessage(event: AuditEvent): string {
    const parts: string[] = [event.type.toUpperCase()];

    if (event.userId) parts.push(`user=${event.userId}`);
    if (event.ip) parts.push(`ip=${event.ip}`);
    if (event.path) parts.push(`path=${event.path}`);
    if (event.method) parts.push(`method=${event.method}`);
    if (event.reason) parts.push(`reason=${event.reason}`);

    return parts.join(' ');
  }

  /**
   * Log audit event
   */
  async logEvent(event: AuditEvent): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const severity = this.getSeverity(event);
    const message = this.formatMessage(event);

    const logEntry: AuditLogEntry = {
      id: `${Date.now()}-${++this.eventCount}`,
      event,
      severity,
      message,
    };

    // Log to console
    if (this.config.logToConsole) {
      const color = {
        low: '\x1b[32m',      // Green
        medium: '\x1b[33m',   // Yellow
        high: '\x1b[35m',     // Magenta
        critical: '\x1b[31m', // Red
      }[severity];

      console.log(
        `${color}[AUDIT ${severity.toUpperCase()}]\x1b[0m ${message}`,
        event.metadata || ''
      );
    }

    // Log to file
    if (this.config.logToFile) {
      try {
        await this.rotateLogsIfNeeded();

        const logStream = this.getLogStream();
        const logLine = JSON.stringify(logEntry) + '\n';

        const canWrite = logStream.write(logLine);
        this.currentFileSize += Buffer.byteLength(logLine);

        if (!canWrite) {
          await this.waitForDrain(logStream);
        }
      } catch (error) {
        console.error('[Audit Logger] Failed to write to log file:', error);
      }
    }
  }

  /**
   * Wait for stream to drain
   */
  private waitForDrain(stream: WriteStream): Promise<void> {
    return new Promise((resolve) => {
      stream.once('drain', resolve);
    });
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(event: Omit<AuditEvent, 'timestamp'> & { timestamp?: Date }): Promise<void> {
    await this.logEvent({
      ...event,
      timestamp: event.timestamp || new Date(),
    });
  }

  /**
   * Log rate limit event
   */
  async logRateLimitEvent(event: {
    type: 'rate_limit_exceeded';
    limitType: string;
    userId?: string;
    ip?: string;
    userAgent?: string;
    path?: string;
    method?: string;
    timestamp: Date;
  }): Promise<void> {
    await this.logEvent({
      ...event,
      metadata: { limitType: event.limitType },
    });
  }

  /**
   * Log API key event
   */
  async logApiKeyEvent(event: {
    type: 'api_key_created' | 'api_key_revoked' | 'api_key_rotated';
    userId: string;
    keyId: string;
    environment: 'live' | 'test';
    reason?: string;
  }): Promise<void> {
    await this.logEvent({
      type: event.type,
      userId: event.userId,
      reason: event.reason,
      timestamp: new Date(),
      metadata: {
        keyId: event.keyId,
        environment: event.environment,
      },
    });
  }

  /**
   * Log configuration change
   */
  async logConfigChange(event: {
    userId: string;
    setting: string;
    oldValue?: any;
    newValue?: any;
    reason?: string;
  }): Promise<void> {
    await this.logEvent({
      type: 'config_change',
      userId: event.userId,
      reason: event.reason,
      timestamp: new Date(),
      metadata: {
        setting: event.setting,
        oldValue: event.oldValue,
        newValue: event.newValue,
      },
    });
  }

  /**
   * Log sensitive data access
   */
  async logSensitiveDataAccess(event: {
    userId: string;
    dataType: string;
    recordId?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.logEvent({
      type: 'sensitive_data_access',
      userId: event.userId,
      ip: event.ip,
      userAgent: event.userAgent,
      timestamp: new Date(),
      metadata: {
        dataType: event.dataType,
        recordId: event.recordId,
      },
    });
  }

  /**
   * Query audit logs
   */
  async queryLogs(filter: {
    startDate?: Date;
    endDate?: Date;
    userId?: string;
    eventType?: AuditEventType;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<AuditLogEntry[]> {
    // In production, this would query a database
    // For now, read from log files

    const logs: AuditLogEntry[] = [];

    try {
      const files = await fs.readdir(this.config.logDirectory);
      const auditFiles = files.filter(f => f.startsWith('audit-') && f.endsWith('.log'));

      for (const file of auditFiles) {
        const content = await fs.readFile(
          path.join(this.config.logDirectory, file),
          'utf-8'
        );

        const lines = content.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const entry: AuditLogEntry = JSON.parse(line);

            // Apply filters
            if (filter.startDate && new Date(entry.event.timestamp) < filter.startDate) {
              continue;
            }

            if (filter.endDate && new Date(entry.event.timestamp) > filter.endDate) {
              continue;
            }

            if (filter.userId && entry.event.userId !== filter.userId) {
              continue;
            }

            if (filter.eventType && entry.event.type !== filter.eventType) {
              continue;
            }

            if (filter.severity && entry.severity !== filter.severity) {
              continue;
            }

            logs.push(entry);
          } catch (error) {
            // Skip malformed log lines
          }
        }
      }
    } catch (error) {
      console.error('[Audit Logger] Failed to query logs:', error);
    }

    return logs.sort((a, b) =>
      new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime()
    );
  }

  /**
   * Close logger
   */
  close(): void {
    if (this.currentLogFile) {
      this.currentLogFile.end();
      this.currentLogFile = undefined;
    }
  }
}

/**
 * Global audit logger instance
 */
export const auditLogger = new AuditLogger();
