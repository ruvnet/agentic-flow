/**
 * Input Validation and Sanitization for AgentDB Security
 *
 * Provides comprehensive validation to prevent SQL injection and other attacks:
 * - Whitelist-based validation for identifiers (tables, columns, PRAGMA commands)
 * - Input sanitization for user data
 * - Type validation and constraints
 * - Error handling that doesn't leak sensitive information
 */

// Validation Constants
const MAX_TASK_LENGTH = 10000;
const MAX_TEXT_LENGTH = 100000;
const MAX_SESSION_ID_LENGTH = 255;
const MAX_TAG_LENGTH = 100;

// Reasonable timestamp bounds (2000-01-01 to 2100-01-01)
const MIN_TIMESTAMP = 946684800; 
const MAX_TIMESTAMP = 4102444800;

/**
 * Allowed table names in AgentDB (whitelist)
 */
const ALLOWED_TABLES = new Set([
  'episodes',
  'episode_embeddings',
  'skills',
  'skill_embeddings',
  'causal_edges',
  'causal_experiments',
  'causal_observations',
  'provenance_certificates',
  'reasoning_patterns',
  'pattern_embeddings',
  'rl_sessions',
  'rl_experiences',
  'rl_policies',
  'rl_q_values',
]);

/**
 * Allowed column names by table (whitelist)
 */
const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  episodes: new Set([
    'id', 'ts', 'session_id', 'task', 'input', 'output', 'critique',
    'reward', 'success', 'latency_ms', 'tokens_used', 'tags', 'metadata'
  ]),
  skills: new Set([
    'id', 'ts', 'name', 'description', 'signature', 'code',
    'success_rate', 'uses', 'avg_reward', 'avg_latency_ms', 'tags', 'metadata'
  ]),
  causal_edges: new Set([
    'id', 'ts', 'from_memory_id', 'from_memory_type', 'to_memory_id',
    'to_memory_type', 'similarity', 'uplift', 'confidence', 'sample_size', 'evidence_ids'
  ]),
  // Add more as needed
};

/**
 * Allowed PRAGMA commands (whitelist)
 */
const ALLOWED_PRAGMAS = new Set([
  'journal_mode',
  'synchronous',
  'cache_size',
  'page_size',
  'page_count',
  'user_version',
  'foreign_keys',
  'temp_store',
  'mmap_size',
  'wal_autocheckpoint',
]);

/**
 * Validation error with safe error messages
 */
export class ValidationError extends Error {
  public readonly code: string;
  public readonly field?: string;

  constructor(message: string, code: string = 'VALIDATION_ERROR', field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;
  }

  /**
   * Get safe error message (doesn't leak sensitive info)
   */
  getSafeMessage(): string {
    return `Invalid input: ${this.field || 'unknown field'}`;
  }
}

/**
 * Validate task string (NEW - for MCP tool optimization)
 */
export function validateTaskString(task: unknown, fieldName: string = 'task'): string {
  if (task === null || task === undefined) {
    throw new ValidationError(`${fieldName} is required`, 'MISSING_REQUIRED_FIELD', fieldName);
  }

  if (typeof task !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`, 'INVALID_TYPE', fieldName);
  }

  const trimmed = task.trim();

  if (trimmed.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`, 'EMPTY_STRING', fieldName);
  }

  if (trimmed.length > MAX_TASK_LENGTH) {
    throw new ValidationError(`${fieldName} exceeds maximum length of ${MAX_TASK_LENGTH} characters`, 'STRING_TOO_LONG', fieldName);
  }

  // Only block null bytes which are a threat to database/system integrity.
  // Content safety (XSS) should be handled at the rendering/output layer.
  if (trimmed.includes('\x00')) {
    throw new ValidationError(`${fieldName} contains invalid null bytes`, 'INVALID_CONTENT', fieldName);
  }

  return trimmed;
}

/**
 * Validate numeric range (NEW - for MCP tool optimization)
 */
export function validateNumericRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number
): number {
  if (value === null || value === undefined) {
    throw new ValidationError(`${fieldName} is required`, 'MISSING_REQUIRED_FIELD', fieldName);
  }

  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a valid number`, 'INVALID_NUMBER', fieldName);
  }

  if (value < min || value > max) {
    throw new ValidationError(
      `${fieldName} must be between ${min} and ${max} (got ${value})`,
      'OUT_OF_RANGE',
      fieldName
    );
  }

  return value;
}

/**
 * Validate array length (NEW - for MCP tool optimization)
 */
export function validateArrayLength<T>(
  arr: unknown,
  fieldName: string,
  minLength: number,
  maxLength: number
): T[] {
  if (arr === null || arr === undefined) {
    throw new ValidationError(`${fieldName} is required`, 'MISSING_REQUIRED_FIELD', fieldName);
  }

  if (!Array.isArray(arr)) {
    throw new ValidationError(`${fieldName} must be an array`, 'INVALID_ARRAY', fieldName);
  }

  if (arr.length < minLength || arr.length > maxLength) {
    throw new ValidationError(
      `${fieldName} must contain between ${minLength} and ${maxLength} items (got ${arr.length})`,
      'ARRAY_LENGTH_INVALID',
      fieldName
    );
  }

  return arr as T[];
}

/**
 * Validate object (NEW - for MCP tool optimization)
 */
export function validateObject(
  obj: unknown,
  fieldName: string,
  required: boolean = true
): Record<string, any> {
  if (obj === null || obj === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`, 'MISSING_REQUIRED_FIELD', fieldName);
    }
    return {};
  }

  if (typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ValidationError(`${fieldName} must be an object`, 'INVALID_OBJECT', fieldName);
  }

  return obj as Record<string, any>;
}

/**
 * Validate boolean (NEW - for MCP tool optimization)
 */
export function validateBoolean(
  value: unknown,
  fieldName: string,
  defaultValue?: boolean
): boolean {
  if (value === null || value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new ValidationError(`${fieldName} is required`, 'MISSING_REQUIRED_FIELD', fieldName);
  }

  if (typeof value !== 'boolean') {
    throw new ValidationError(`${fieldName} must be a boolean`, 'INVALID_BOOLEAN', fieldName);
  }

  return value;
}

/**
 * Validate enum value (NEW - for MCP tool optimization)
 */
export function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[]
): T {
  if (value === null || value === undefined) {
    throw new ValidationError(`${fieldName} is required`, 'MISSING_REQUIRED_FIELD', fieldName);
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`, 'INVALID_TYPE', fieldName);
  }

  if (!allowedValues.includes(value as T)) {
    throw new ValidationError(
      `${fieldName} must be one of: ${allowedValues.join(', ')} (got "${value}")`,
      'INVALID_ENUM_VALUE',
      fieldName
    );
  }

  return value as T;
}

/**
 * Validate table name against whitelist
 */
export function validateTableName(tableName: string): string {
  if (!tableName || typeof tableName !== 'string') {
    throw new ValidationError('Table name must be a non-empty string', 'INVALID_TABLE', 'tableName');
  }

  const sanitized = tableName.trim().toLowerCase();

  if (!ALLOWED_TABLES.has(sanitized)) {
    throw new ValidationError(
      `Invalid table name: ${sanitized}. Allowed tables: ${Array.from(ALLOWED_TABLES).join(', ')}`,
      'INVALID_TABLE',
      'tableName'
    );
  }

  return sanitized;
}

/**
 * Validate column name against whitelist
 */
export function validateColumnName(tableName: string, columnName: string): string {
  if (!columnName || typeof columnName !== 'string') {
    throw new ValidationError('Column name must be a non-empty string', 'INVALID_COLUMN', 'columnName');
  }

  const sanitized = columnName.trim().toLowerCase();
  const validatedTable = validateTableName(tableName);

  const allowedColumns = ALLOWED_COLUMNS[validatedTable];
  if (allowedColumns && !allowedColumns.has(sanitized)) {
    throw new ValidationError(
      `Invalid column name for table ${validatedTable}: ${sanitized}`,
      'INVALID_COLUMN',
      'columnName'
    );
  }

  return sanitized;
}

/**
 * Validate PRAGMA command against whitelist
 */
export function validatePragmaCommand(pragma: string): string {
  if (!pragma || typeof pragma !== 'string') {
    throw new ValidationError('PRAGMA command must be a non-empty string', 'INVALID_PRAGMA', 'pragma');
  }

  // Extract the pragma name (before any = or space)
  const pragmaName = pragma.trim().toLowerCase().split(/[=\s]/)[0];

  if (!ALLOWED_PRAGMAS.has(pragmaName)) {
    throw new ValidationError(
      `Invalid PRAGMA command: ${pragmaName}. Allowed: ${Array.from(ALLOWED_PRAGMAS).join(', ')}`,
      'INVALID_PRAGMA',
      'pragma'
    );
  }

  // Return the full pragma for execution (e.g., "journal_mode = WAL")
  return pragma.trim();
}

/**
 * Validate and sanitize session ID
 */
export function validateSessionId(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new ValidationError('Session ID must be a non-empty string', 'INVALID_SESSION_ID', 'sessionId');
  }

  // Allow alphanumeric, hyphens, underscores (max 255 chars)
  const sanitized = sessionId.trim();

  if (sanitized.length > MAX_SESSION_ID_LENGTH) {
    throw new ValidationError(`Session ID exceeds maximum length (${MAX_SESSION_ID_LENGTH})`, 'INVALID_SESSION_ID', 'sessionId');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new ValidationError(
      'Session ID must contain only alphanumeric characters, hyphens, and underscores',
      'INVALID_SESSION_ID',
      'sessionId'
    );
  }

  return sanitized;
}

/**
 * Validate numeric ID
 */
export function validateId(id: any, fieldName: string = 'id'): number {
  const numId = Number(id);

  if (!Number.isFinite(numId) || numId < 0 || !Number.isInteger(numId)) {
    throw new ValidationError(`${fieldName} must be a non-negative integer`, 'INVALID_ID', fieldName);
  }

  return numId;
}

/**
 * Validate timestamp
 */
export function validateTimestamp(timestamp: any, fieldName: string = 'timestamp'): number {
  const numTs = Number(timestamp);

  if (!Number.isFinite(numTs) || numTs < 0) {
    throw new ValidationError(`${fieldName} must be a non-negative number`, 'INVALID_TIMESTAMP', fieldName);
  }

  if (numTs < MIN_TIMESTAMP || numTs > MAX_TIMESTAMP) {
    throw new ValidationError(
      `${fieldName} is out of valid range (2000-2100)`,
      'INVALID_TIMESTAMP',
      fieldName
    );
  }

  return numTs;
}

/**
 * Validate reward value (0-1)
 */
export function validateReward(reward: any): number {
  const numReward = Number(reward);

  if (!Number.isFinite(numReward)) {
    throw new ValidationError('Reward must be a number', 'INVALID_REWARD', 'reward');
  }

  if (numReward < 0 || numReward > 1) {
    throw new ValidationError('Reward must be between 0 and 1', 'INVALID_REWARD', 'reward');
  }

  return numReward;
}

/**
 * Validate success flag
 */
export function validateSuccess(success: any): boolean {
  if (typeof success === 'boolean') {
    return success;
  }

  if (typeof success === 'number') {
    return success !== 0;
  }

  if (typeof success === 'string') {
    const lower = success.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }

  throw new ValidationError('Success must be a boolean value', 'INVALID_BOOLEAN', 'success');
}

/**
 * Sanitize text input (prevent extremely long strings, null bytes, etc.)
 */
export function sanitizeText(text: string, maxLength: number = MAX_TEXT_LENGTH, fieldName: string = 'text'): string {
  if (typeof text !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`, 'INVALID_TEXT', fieldName);
  }

  // Remove null bytes
  const sanitized = text.replace(/\0/g, '');

  if (sanitized.length > maxLength) {
    throw new ValidationError(
      `${fieldName} exceeds maximum length (${maxLength})`,
      'TEXT_TOO_LONG',
      fieldName
    );
  }

  return sanitized;
}

/**
 * Build safe WHERE clause with parameterized values
 * Returns both the SQL clause and the parameter values
 */
export function buildSafeWhereClause(
  tableName: string,
  conditions: Record<string, any>
): { clause: string; values: any[] } {
  const validatedTable = validateTableName(tableName);

  if (!conditions || typeof conditions !== 'object' || Object.keys(conditions).length === 0) {
    throw new ValidationError('Conditions must be a non-empty object', 'INVALID_CONDITIONS', 'conditions');
  }

  const clauses: string[] = [];
  const values: any[] = [];

  for (const [column, value] of Object.entries(conditions)) {
    const validatedColumn = validateColumnName(validatedTable, column);
    clauses.push(`${validatedColumn} = ?`);
    values.push(value);
  }

  return {
    clause: clauses.join(' AND '),
    values,
  };
}

/**
 * Build safe SET clause for UPDATE statements
 */
export function buildSafeSetClause(
  tableName: string,
  updates: Record<string, any>
): { clause: string; values: any[] } {
  const validatedTable = validateTableName(tableName);

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw new ValidationError('Updates must be a non-empty object', 'INVALID_UPDATES', 'updates');
  }

  const clauses: string[] = [];
  const values: any[] = [];

  for (const [column, value] of Object.entries(updates)) {
    const validatedColumn = validateColumnName(validatedTable, column);
    clauses.push(`${validatedColumn} = ?`);
    values.push(value);
  }

  return {
    clause: clauses.join(', '),
    values,
  };
}

/**
 * Validate JSON data
 */
export function validateJSON(data: any, fieldName: string = 'json'): string {
  try {
    return JSON.stringify(data);
  } catch (error) {
    throw new ValidationError(`${fieldName} is not valid JSON`, 'INVALID_JSON', fieldName);
  }
}

/**
 * Validate array of tags
 */
export function validateTags(tags: any): string[] {
  if (!Array.isArray(tags)) {
    throw new ValidationError('Tags must be an array', 'INVALID_TAGS', 'tags');
  }

  const sanitized = tags.map((tag, i) => {
    if (typeof tag !== 'string') {
      throw new ValidationError(`Tag at index ${i} must be a string`, 'INVALID_TAG', `tags[${i}]`);
    }
    return sanitizeText(tag, MAX_TAG_LENGTH, `tags[${i}]`);
  });

  return sanitized;
}

/**
 * Safe error handler that doesn't leak sensitive information
 */
export function handleSecurityError(error: any): string {
  if (error instanceof ValidationError) {
    // Safe to return validation errors
    return error.message;
  }

  // For other errors, return generic message and log details internally
  console.error('Security error:', error);
  return 'An error occurred while processing your request. Please check your input and try again.';
}