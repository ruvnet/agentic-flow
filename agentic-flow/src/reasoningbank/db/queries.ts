/**
 * Database queries for ReasoningBank
 * Operates on Claude Flow's memory.db at .swarm/memory.db
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { ReasoningMemory, PatternEmbedding, TaskTrajectory, MattsRun } from './schema.js';

// Simple logger for database operations
const logger = {
  info: (msg: string, data?: any) => console.error(`[INFO] ${msg}`, data || ''),
  error: (msg: string, data?: any) => console.error(`[ERROR] ${msg}`, data || '')
};

let dbInstance: Database.Database | null = null;

/**
 * Run database migrations (create tables)
 */
export async function runMigrations(): Promise<void> {
  const dbPath = process.env.CLAUDE_FLOW_DB_PATH || join(process.cwd(), '.swarm', 'memory.db');

  // Create directory if it doesn't exist
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    logger.info('Created database directory', { path: dbDir });
  }

  // Create database file
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      pattern_data TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used TEXT
    );

    CREATE TABLE IF NOT EXISTS pattern_embeddings (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dims INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id) REFERENCES patterns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pattern_links (
      src_id TEXT NOT NULL,
      dst_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (src_id, dst_id, relation),
      FOREIGN KEY (src_id) REFERENCES patterns(id) ON DELETE CASCADE,
      FOREIGN KEY (dst_id) REFERENCES patterns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_trajectories (
      task_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      query TEXT NOT NULL,
      trajectory_json TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      judge_label TEXT,
      judge_conf REAL,
      judge_reasons TEXT,
      matts_run_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS matts_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      k INTEGER NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS consolidation_runs (
      run_id TEXT PRIMARY KEY,
      items_processed INTEGER NOT NULL,
      duplicates_found INTEGER NOT NULL,
      contradictions_found INTEGER NOT NULL,
      items_pruned INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metrics_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_name TEXT NOT NULL,
      value REAL NOT NULL,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
    CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC);
    CREATE INDEX IF NOT EXISTS idx_patterns_created_at ON patterns(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pattern_links_relation ON pattern_links(relation);
    CREATE INDEX IF NOT EXISTS idx_trajectories_agent ON task_trajectories(agent_id);
  `);

  db.close();
  dbInstance = null; // Reset instance to force reconnection

  logger.info('Database migrations completed', { path: dbPath });
}

/**
 * Get database connection (singleton)
 */
export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = process.env.CLAUDE_FLOW_DB_PATH || join(process.cwd(), '.swarm', 'memory.db');

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Run migrations first.`);
  }

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  logger.info('Connected to ReasoningBank database', { path: dbPath });

  return dbInstance;
}

/**
 * Fetch reasoning memory candidates for retrieval
 */
export function fetchMemoryCandidates(options: {
  domain?: string;
  agent?: string;
  minConfidence?: number;
}): Array<ReasoningMemory & { embedding: Float32Array; age_days: number }> {
  const db = getDb();

  let query = `
    SELECT
      p.*,
      pe.vector as embedding,
      CAST((julianday('now') - julianday(p.created_at)) AS INTEGER) as age_days
    FROM patterns p
    JOIN pattern_embeddings pe ON p.id = pe.id
    WHERE p.type = 'reasoning_memory'
      AND p.confidence >= ?
  `;

  const params: any[] = [options.minConfidence || 0.3];

  if (options.domain) {
    query += ` AND json_extract(p.pattern_data, '$.domain') = ?`;
    params.push(options.domain);
  }

  query += ` ORDER BY p.confidence DESC, p.usage_count DESC`;

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];

  return rows.map((row: any) => {
    const buffer = Buffer.from((row as any).embedding);
    // Create Float32Array from buffer - buffer length / 4 bytes per float
    const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);

    return {
      ...row,
      pattern_data: JSON.parse((row as any).pattern_data),
      embedding: float32Array
    };
  });
}

/**
 * Store a new reasoning memory
 */
export function upsertMemory(memory: Omit<ReasoningMemory, 'created_at' | 'last_used'>): string {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO patterns (id, type, pattern_data, confidence, usage_count, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  stmt.run(
    memory.id,
    memory.type,
    JSON.stringify(memory.pattern_data),
    memory.confidence,
    memory.usage_count
  );

  logger.info('Upserted reasoning memory', { id: memory.id, title: memory.pattern_data.title });

  return memory.id;
}

/**
 * Store embedding for a memory
 */
export function upsertEmbedding(embedding: PatternEmbedding): void {
  const db = getDb();

  const buffer = Buffer.from(embedding.vector.buffer);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pattern_embeddings (id, model, dims, vector, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  stmt.run(embedding.id, embedding.model, embedding.dims, buffer);
}

/**
 * Increment usage count for a memory
 */
export function incrementUsage(memoryId: string): void {
  const db = getDb();

  db.prepare(`
    UPDATE patterns
    SET usage_count = usage_count + 1,
        last_used = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(memoryId);
}

/**
 * Store task trajectory
 */
export function storeTrajectory(trajectory: Omit<TaskTrajectory, 'created_at'>): void {
  const db = getDb();

  db.prepare(`
    INSERT OR REPLACE INTO task_trajectories
    (task_id, agent_id, query, trajectory_json, started_at, ended_at,
     judge_label, judge_conf, judge_reasons, matts_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    trajectory.task_id,
    trajectory.agent_id,
    trajectory.query,
    trajectory.trajectory_json,
    trajectory.started_at || null,
    trajectory.ended_at || null,
    trajectory.judge_label || null,
    trajectory.judge_conf || null,
    trajectory.judge_reasons || null,
    trajectory.matts_run_id || null
  );
}

/**
 * Store MaTTS run
 */
export function storeMattsRun(run: Omit<MattsRun, 'created_at'>): void {
  const db = getDb();

  db.prepare(`
    INSERT INTO matts_runs (run_id, task_id, mode, k, status, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(run.run_id, run.task_id, run.mode, run.k, run.status, run.summary || null);
}

/**
 * Log performance metric
 */
export function logMetric(name: string, value: number): void {
  try {
    const db = getDb();

    // Log to metrics_log table (our own table)
    db.prepare(`
      INSERT INTO metrics_log (metric_name, value, timestamp)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(name, value);
  } catch (error) {
    // Silently fail if metrics table doesn't exist
    // This is optional logging, not critical
  }
}

/**
 * Count new memories since last consolidation
 */
export function countNewMemoriesSinceConsolidation(): number {
  const db = getDb();

  const lastRun = db.prepare(`
    SELECT created_at
    FROM consolidation_runs
    ORDER BY created_at DESC
    LIMIT 1
  `).get() as { created_at: string } | undefined;

  if (!lastRun) {
    // No consolidation yet, count all memories
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM patterns
      WHERE type = 'reasoning_memory'
    `).get() as { count: number };
    return result.count;
  }

  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM patterns
    WHERE type = 'reasoning_memory'
      AND created_at > ?
  `).get(lastRun.created_at) as { count: number };

  return result.count;
}

/**
 * Get all active reasoning memories
 */
export function getAllActiveMemories(): ReasoningMemory[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT *
    FROM patterns
    WHERE type = 'reasoning_memory'
      AND confidence >= 0.3
    ORDER BY confidence DESC, usage_count DESC
  `).all() as any[];

  return rows.map((row: any) => ({
    ...row,
    pattern_data: JSON.parse((row as any).pattern_data)
  }));
}

/**
 * Store memory link (relationship)
 */
export function storeLink(
  srcId: string,
  dstId: string,
  relation: 'entails' | 'contradicts' | 'refines' | 'duplicate_of',
  weight: number
): void {
  const db = getDb();

  db.prepare(`
    INSERT OR REPLACE INTO pattern_links (src_id, dst_id, relation, weight, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(srcId, dstId, relation, weight);
}

/**
 * Get contradictions for a memory
 */
export function getContradictions(memoryId: string): string[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT dst_id
    FROM pattern_links
    WHERE src_id = ? AND relation = 'contradicts'
  `).all(memoryId) as { dst_id: string }[];

  return rows.map(r => r.dst_id);
}

/**
 * Store consolidation run
 */
export function storeConsolidationRun(run: {
  run_id: string;
  items_processed: number;
  duplicates_found: number;
  contradictions_found: number;
  items_pruned: number;
  duration_ms: number;
}): void {
  const db = getDb();

  db.prepare(`
    INSERT INTO consolidation_runs
    (run_id, items_processed, duplicates_found, contradictions_found, items_pruned, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    run.run_id,
    run.items_processed,
    run.duplicates_found,
    run.contradictions_found,
    run.items_pruned,
    run.duration_ms
  );
}

/**
 * Prune old, unused memories
 */
export function pruneOldMemories(options: {
  maxAgeDays: number;
  minConfidence: number;
}): number {
  const db = getDb();

  const result = db.prepare(`
    DELETE FROM patterns
    WHERE type = 'reasoning_memory'
      AND usage_count = 0
      AND confidence < ?
      AND CAST((julianday('now') - julianday(created_at)) AS INTEGER) > ?
  `).run(options.minConfidence, options.maxAgeDays);

  return result.changes;
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    logger.info('Closed ReasoningBank database connection');
  }
}
