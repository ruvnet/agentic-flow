/**
 * Database System using sql.js (WASM SQLite)
 * Pure JavaScript implementation with NO build dependencies
 *
 * SECURITY: Fixed SQL injection vulnerabilities:
 * - PRAGMA commands validated against whitelist
 * - Removed eval() usage (replaced with async import)
 */

import { validatePragmaCommand, ValidationError } from './security/input-validation.js';
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- sql.js Database has no shared TS type with better-sqlite3; kept for documentation
type Database = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cached wrapper class
let sqlJsWrapper: any = null;

/**
 * Get sql.js database implementation (ONLY sql.js, no better-sqlite3)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- returns dynamically constructed class
export async function getDatabaseImplementation(): Promise<any> {
  // Return cached wrapper
  if (sqlJsWrapper) {
    return sqlJsWrapper;
  }

  try {
    console.log('✅ Using sql.js (WASM SQLite, no build tools required)');

    // sql.js requires async initialization
    const mod = await import('sql.js');
    const SQL = await mod.default();

    // Create database wrapper
    sqlJsWrapper = createSqlJsWrapper(SQL);

    return sqlJsWrapper;
  } catch (error) {
    console.error('❌ Failed to initialize sql.js:', (error as Error).message);
    throw new Error(
      'Failed to initialize SQLite. Please ensure sql.js is installed:\n' +
      'npm install sql.js'
    );
  }
}

/**
 * Create a better-sqlite3 compatible wrapper around sql.js
 * This allows AgentDB to work (with reduced performance) without native compilation
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js SQL factory type
function createSqlJsWrapper(SQL: any) {
  return class SqlJsDatabase {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js Database instance
    private db: any;
    private filename: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js Statement instances
    private activeStatements: Map<number, any> = new Map();
    // Cache wrappers by SQL text so repeated db.prepare(sameSql) returns the
    // same underlying sql.js Statement and doesn't add a new entry to
    // activeStatements. Without this, callers using the
    // db.prepare(sql).run(...)-and-discard pattern (idiomatic in
    // better-sqlite3, where V8 GCs the handle) leak forever under sql.js.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prepared-statement wrapper objects
    private statementCache: Map<string, any> = new Map();
    private statementCounter: number = 0;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(filename: string, _options?: unknown) {
      this.filename = filename;

      // In-memory database
      if (filename === ':memory:') {
        this.db = new SQL.Database();
      } else {
        // File-based database - use safe fs module (no eval)
        try {
          if (fs.existsSync(filename)) {
            const buffer = fs.readFileSync(filename);
            this.db = new SQL.Database(buffer);
          } else {
            this.db = new SQL.Database();
          }
        } catch (error) {
          console.warn('⚠️  Could not read database file:', (error as Error).message);
          this.db = new SQL.Database();
        }
      }

      // Warn if too many active statements (memory leak detection)
      this.intervalId = setInterval(() => {
        if (this.activeStatements.size > 50) {
          console.warn(`⚠️  Detected ${this.activeStatements.size} active SQL statements - possible memory leak`);
        }
      }, 10000);
    }

    prepare(sql: string) {
      // Reuse the cached wrapper for an identical SQL string. The cache owns
      // the underlying stmt's lifetime; finalize() is a no-op on a cached
      // wrapper so concurrent callers that all called prepare(sql) keep
      // working. close() drops everything.
      const cached = this.statementCache.get(sql);
      if (cached) return cached;

      const stmt = this.db.prepare(sql);
      let isFinalized = false;
      const stmtId = ++this.statementCounter;
      const self = this;

      // Track active statement
      this.activeStatements.set(stmtId, stmt);

      const evictOnError = () => {
        if (!isFinalized) {
          stmt.free();
          isFinalized = true;
          self.activeStatements.delete(stmtId);
          self.statementCache.delete(sql);
        }
      };

      const wrapper = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js bind accepts heterogeneous params
        run: (...params: any[]) => {
          if (isFinalized) throw new Error('Statement already finalized');
          try {
            stmt.bind(params);
            stmt.step();
            stmt.reset();

            return {
              changes: this.db.getRowsModified(),
              lastInsertRowid: this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] || 0
            };
          } catch (error) {
            evictOnError();
            throw error;
          }
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js bind accepts heterogeneous params
        get: (...params: any[]) => {
          if (isFinalized) throw new Error('Statement already finalized');
          try {
            stmt.bind(params);
            const hasRow = stmt.step();

            if (!hasRow) {
              stmt.reset();
              return undefined;
            }

            const columns = stmt.getColumnNames();
            const values = stmt.get();
            stmt.reset();

            const result: Record<string, unknown> = {};
            columns.forEach((col: string, idx: number) => {
              result[col] = values[idx];
            });

            return result;
          } catch (error) {
            evictOnError();
            throw error;
          }
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js bind accepts heterogeneous params
        all: (...params: any[]) => {
          if (isFinalized) throw new Error('Statement already finalized');
          try {
            stmt.bind(params);
            const results: Record<string, unknown>[] = [];

            while (stmt.step()) {
              const columns = stmt.getColumnNames();
              const values = stmt.get();

              const result: Record<string, unknown> = {};
              columns.forEach((col: string, idx: number) => {
                result[col] = values[idx];
              });

              results.push(result);
            }

            stmt.reset();
            return results;
          } catch (error) {
            evictOnError();
            throw error;
          }
        },

        finalize: () => {
          // No-op while cached: the wrapper is shared and finalize() must not
          // tear out a stmt another caller is about to use. close() handles
          // the real teardown.
        }
      };

      this.statementCache.set(sql, wrapper);
      return wrapper;
    }

    exec(sql: string) {
      return this.db.exec(sql);
    }

    save() {
      // Save to file if needed
      if (this.filename !== ':memory:') {
        try {
          // Create parent directories if they don't exist
          const dir = path.dirname(this.filename);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const data = this.db.export();
          fs.writeFileSync(this.filename, Buffer.from(data));
        } catch (error) {
          console.error('❌ Could not save database to file:', (error as Error).message);
          throw error;
        }
      }
    }

    close() {
      // Clear interval timer
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }

      // Free all active statements to prevent memory leaks
      for (const [, stmt] of this.activeStatements.entries()) {
        try {
          stmt.free();
        } catch {
          // Statement may already be freed
        }
      }
      this.activeStatements.clear();
      this.statementCache.clear();

      // Save to file before closing
      this.save();
      this.db.close();
    }

    pragma(pragma: string, _options?: unknown) {
      try {
        // SECURITY: Validate PRAGMA command against whitelist to prevent SQL injection
        const validatedPragma = validatePragmaCommand(pragma);

        // Execute validated PRAGMA
        const result = this.db.exec(`PRAGMA ${validatedPragma}`);
        return result[0]?.values[0]?.[0];
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error(`❌ Invalid PRAGMA command: ${error.message}`);
          throw error;
        }
        throw error;
      }
    }

    transaction(fn: () => unknown) {
      // Return a function that executes the transaction when called
      // This matches better-sqlite3 API where transaction() returns a callable function
      return () => {
        try {
          this.db.exec('BEGIN TRANSACTION');
          const result = fn();
          this.db.exec('COMMIT');
          return result;
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      };
    }
  };
}

/**
 * Create a database instance using sql.js
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- returns dynamically constructed SqlJsDatabase
export async function createDatabase(filename: string, options?: unknown): Promise<any> {
  const DatabaseImpl = await getDatabaseImplementation();
  return new DatabaseImpl(filename, options);
}

/**
 * Wrap an EXISTING sql.js raw database with the better-sqlite3-compatible API.
 * Used by AgentDB unified mode to share one sql.js Database instance for both
 * vector (rvf) and relational tables in a single .rvf file.
 *
 * Unlike createDatabase(), this does NOT create a new SQL.Database — it wraps
 * the one already held by SqlJsRvfBackend.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js raw database and returned wrapper
export function wrapExistingSqlJsDatabase(rawDb: any, filename: string = ':memory:'): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js Statement instances
  const activeStatements = new Map<number, any>();
  // SQL-text cache; see SqlJsDatabase.statementCache for rationale.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prepared-statement wrapper objects
  const statementCache = new Map<string, any>();
  let statementCounter = 0;

  return {
    prepare(sql: string) {
      const cached = statementCache.get(sql);
      if (cached) return cached;

      const stmt = rawDb.prepare(sql);
      let isFinalized = false;
      const stmtId = ++statementCounter;
      activeStatements.set(stmtId, stmt);

      const evictOnError = () => {
        if (!isFinalized) {
          stmt.free();
          isFinalized = true;
          activeStatements.delete(stmtId);
          statementCache.delete(sql);
        }
      };

      const wrapper = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js bind accepts heterogeneous params
        run(...params: any[]) {
          if (isFinalized) throw new Error('Statement already finalized');
          try {
            stmt.bind(params);
            stmt.step();
            stmt.reset();
            return {
              changes: rawDb.getRowsModified(),
              lastInsertRowid: rawDb.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] || 0,
            };
          } catch (error) {
            evictOnError();
            throw error;
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js bind accepts heterogeneous params
        get(...params: any[]) {
          if (isFinalized) throw new Error('Statement already finalized');
          try {
            stmt.bind(params);
            const hasRow = stmt.step();
            if (!hasRow) { stmt.reset(); return undefined; }
            const columns = stmt.getColumnNames();
            const values = stmt.get();
            stmt.reset();
            const result: Record<string, unknown> = {};
            columns.forEach((col: string, idx: number) => { result[col] = values[idx]; });
            return result;
          } catch (error) {
            evictOnError();
            throw error;
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js bind accepts heterogeneous params
        all(...params: any[]) {
          if (isFinalized) throw new Error('Statement already finalized');
          try {
            stmt.bind(params);
            const results: Record<string, unknown>[] = [];
            while (stmt.step()) {
              const columns = stmt.getColumnNames();
              const values = stmt.get();
              const result: Record<string, unknown> = {};
              columns.forEach((col: string, idx: number) => { result[col] = values[idx]; });
              results.push(result);
            }
            stmt.reset();
            return results;
          } catch (error) {
            evictOnError();
            throw error;
          }
        },
        finalize() {
          // No-op while cached; close() handles teardown.
        },
      };

      statementCache.set(sql, wrapper);
      return wrapper;
    },

    exec(sql: string) {
      return rawDb.exec(sql);
    },

    save() {
      if (filename !== ':memory:') {
        const dir = path.dirname(filename);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        const data = rawDb.export();
        fs.writeFileSync(filename, Buffer.from(data));
      }
    },

    close() {
      for (const [, stmt] of activeStatements.entries()) {
        try { stmt.free(); } catch { /* already freed */ }
      }
      activeStatements.clear();
      statementCache.clear();
      this.save();
      rawDb.close();
    },

    pragma(pragma: string, _options?: unknown) {
      try {
        const validatedPragma = validatePragmaCommand(pragma);
        const result = rawDb.exec(`PRAGMA ${validatedPragma}`);
        return result[0]?.values[0]?.[0];
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error(`Invalid PRAGMA command: ${error.message}`);
          throw error;
        }
        throw error;
      }
    },

    transaction(fn: () => unknown) {
      return () => {
        try {
          rawDb.exec('BEGIN TRANSACTION');
          const result = fn();
          rawDb.exec('COMMIT');
          return result;
        } catch (error) {
          rawDb.exec('ROLLBACK');
          throw error;
        }
      };
    },
  };
}

/**
 * Get information about current database implementation
 */
export function getDatabaseInfo(): {
  implementation: string;
  isNative: boolean;
  performance: 'high' | 'medium' | 'low';
  requiresBuildTools: boolean;
} {
  return {
    implementation: 'sql.js (WASM)',
    isNative: false,
    performance: 'medium',
    requiresBuildTools: false
  };
}
