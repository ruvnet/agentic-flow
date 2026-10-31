/**
 * AgentDB Integration Service
 *
 * Singleton service providing a unified interface to the AgentDB controllers
 * (ReflexionMemory, ReasoningBank, LearningSystem). AgentDB is loaded with a
 * dynamic import; when it is missing or fails to initialize, the service keeps
 * working on an in-memory store and reports `getBackendName() === 'in-memory'`.
 *
 * Ported from agentic-flow 3.0.0-alpha.2 and trimmed to the surface used by
 * AutopilotLearning. The alpha line imported AgentDB through monorepo-relative
 * paths (`../../../packages/agentdb/src/...`) that never resolved from an
 * installed package, so it always ran on the in-memory fallback. This version
 * resolves the published `agentdb` package instead.
 *
 * Nothing here writes to stdout: callers such as ruflo's MCP server use stdout
 * as their JSON-RPC channel.
 */
import * as path from 'path';
import * as fs from 'fs';

// -- Public interfaces ------------------------------------------------------

export interface EpisodeData {
  sessionId: string;
  task: string;
  input?: string;
  output?: string;
  critique?: string;
  reward: number;
  success: boolean;
  latencyMs?: number;
  tokensUsed?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface Episode extends EpisodeData {
  id: number;
  ts: number;
  similarity?: number;
}

export interface PatternData {
  taskType: string;
  approach: string;
  successRate: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface Pattern extends PatternData {
  id: number;
  uses: number;
  similarity?: number;
}

export interface TrajectoryStep {
  state: string;
  action: string;
  reward: number;
  nextState?: string;
}

export interface PredictedAction {
  action: string;
  confidence: number;
  alternatives: Array<{ action: string; confidence: number }>;
}

export interface ServiceMetrics {
  backend: string;
  episodes: number;
  patterns: number;
  uptime: number;
}

/** Directory that holds agentdb.sqlite. Overridable for tests and embedders. */
export const AGENTDB_DIR_ENV = 'AGENTIC_FLOW_AGENTDB_DIR';

// -- In-memory fallback store -----------------------------------------------

class InMemoryStore<T extends { id: number }> {
  private items = new Map<number, T>();
  private nextId = 1;

  add(item: Omit<T, 'id'>): number {
    const id = this.nextId++;
    this.items.set(id, { ...item, id } as unknown as T);
    return id;
  }

  search(predicate: (item: T) => boolean, limit: number): T[] {
    const out: T[] = [];
    for (const item of this.items.values()) {
      if (predicate(item)) out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  get size(): number { return this.items.size; }
}

// -- Service ----------------------------------------------------------------

export class AgentDBService {
  private static instance: AgentDBService | null = null;

  private agentdb: any = null;
  private db: any = null;
  private reflexionMemory: any = null;
  private reasoningBank: any = null;
  private learningSystem: any = null;
  private embeddingService: any = null;
  private learningSessionId: string | null = null;
  private exitHook: (() => void) | null = null;

  private episodeStore = new InMemoryStore<Episode>();
  private patternStore = new InMemoryStore<Pattern>();
  private trajectories: Array<{ steps: TrajectoryStep[]; reward: number }> = [];

  private backendName = 'in-memory';
  private startTime = Date.now();
  private initialized = false;

  private constructor() {}

  static async getInstance(): Promise<AgentDBService> {
    if (!AgentDBService.instance) {
      AgentDBService.instance = new AgentDBService();
      await AgentDBService.instance.initialize();
    }
    return AgentDBService.instance;
  }

  static resetInstance(): void { AgentDBService.instance = null; }

  /** 'agentdb' when the real AgentDB backend is active, otherwise 'in-memory'. */
  getBackendName(): string { return this.backendName; }

  // -- Init -----------------------------------------------------------------

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    let agentdb: any;
    try {
      agentdb = await import(/* webpackIgnore: true */ 'agentdb');
    } catch {
      return; // AgentDB not installed — in-memory fallback
    }

    try {
      const dbDir = process.env[AGENTDB_DIR_ENV] || path.join(process.cwd(), '.claude-flow', 'agentdb');
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
      const dbPath = path.join(dbDir, 'agentdb.sqlite');

      const AgentDB = agentdb.AgentDB ?? agentdb.default;
      this.db = new AgentDB({ dbPath });
      await this.db.initialize();

      this.embeddingService = new agentdb.EmbeddingService({
        model: 'Xenova/all-MiniLM-L6-v2', dimension: 384, provider: 'transformers',
      });
      await this.embeddingService.initialize();

      // AgentDB builds its own vector backend during initialize(); the
      // controllers here use the SQL-backed embedding search so they need no
      // separate backend (the alpha line's MutationGuard wrapper is gone).
      const database = this.db.database;
      this.reflexionMemory = new agentdb.ReflexionMemory(database, this.embeddingService);
      this.reasoningBank = new agentdb.ReasoningBank(database, this.embeddingService);
      this.learningSystem = new agentdb.LearningSystem(database, this.embeddingService);
      this.agentdb = agentdb;
      this.backendName = 'agentdb';
      this.saveOnExit(database);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AgentDBService] AgentDB unavailable (${msg}), using in-memory fallback`);
      this.reflexionMemory = null;
      this.reasoningBank = null;
      this.learningSystem = null;
      this.backendName = 'in-memory';
    }
  }

  /**
   * better-sqlite3 writes through to disk. The sql.js WASM fallback (used when
   * the native module is not built) keeps everything in memory until save()
   * or close(), and a long-lived host such as an MCP server never calls
   * shutdown(). Saving after each write is not an option: in agentdb
   * 3.0.0-alpha.20, save() frees the cached prepared statements and the next
   * insert throws. So flush once, when the process exits.
   */
  private saveOnExit(database: any): void {
    if (!database || typeof database.save !== 'function') return;
    this.exitHook = () => {
      try { database.save(); } catch { /* nothing left to do at exit */ }
    };
    process.once('exit', this.exitHook);
  }

  // -- Episodes -------------------------------------------------------------

  async storeEpisode(episode: EpisodeData): Promise<string> {
    if (this.reflexionMemory) {
      try {
        return String(await this.reflexionMemory.storeEpisode(episode));
      } catch { this.reflexionMemory = null; }
    }
    return String(this.episodeStore.add({ ...episode, ts: Date.now(), id: 0 } as Episode));
  }

  async recallEpisodes(query: string, limit = 5, filters?: Record<string, any>): Promise<Episode[]> {
    const hasFilters = !!filters && Object.keys(filters).length > 0;
    if (this.reflexionMemory) {
      try {
        const fetchCount = hasFilters ? limit * 2 : limit;
        const results = await this.reflexionMemory.retrieveRelevant({ task: query, k: fetchCount });
        let episodes: Episode[] = (results ?? []).map((r: any) => ({
          id: r.id ?? 0, ts: r.ts ?? 0, sessionId: r.sessionId ?? '',
          task: r.task ?? '', input: r.input, output: r.output, critique: r.critique,
          reward: r.reward ?? 0, success: r.success ?? false, similarity: r.similarity,
          tags: r.tags, metadata: r.metadata,
        }));
        if (hasFilters && this.agentdb?.MetadataFilter) {
          try {
            episodes = this.agentdb.MetadataFilter.apply(episodes, filters);
          } catch { /* invalid filter — return unfiltered */ }
        }
        return episodes.slice(0, limit);
      } catch { this.reflexionMemory = null; }
    }
    const q = query.toLowerCase();
    return this.episodeStore.search((ep) => ep.task.toLowerCase().includes(q), limit);
  }

  // -- Patterns -------------------------------------------------------------

  async storePattern(pattern: PatternData): Promise<string> {
    if (this.reasoningBank) {
      try {
        return String(await this.reasoningBank.storePattern({
          taskType: pattern.taskType, approach: pattern.approach,
          successRate: pattern.successRate, tags: pattern.tags, metadata: pattern.metadata,
        }));
      } catch { this.reasoningBank = null; }
    }
    return String(this.patternStore.add({ ...pattern, id: 0, uses: 0 } as Pattern));
  }

  async searchPatterns(query: string, limit = 5): Promise<Pattern[]> {
    if (this.reasoningBank) {
      try {
        const results = await this.reasoningBank.searchPatterns({ task: query, k: limit });
        return (results ?? []).slice(0, limit).map((r: any) => ({
          id: r.id ?? 0, taskType: r.taskType ?? '', approach: r.approach ?? '',
          successRate: r.successRate ?? 0, uses: r.uses ?? 0,
          tags: r.tags, metadata: r.metadata, similarity: r.similarity,
        }));
      } catch { this.reasoningBank = null; }
    }
    const q = query.toLowerCase();
    return this.patternStore.search(
      (p) => p.taskType.toLowerCase().includes(q) || p.approach.toLowerCase().includes(q),
      limit,
    );
  }

  // -- Learning -------------------------------------------------------------

  /**
   * Record an agent trajectory into one long-lived Q-learning session, which
   * predictAction() then queries.
   */
  async recordTrajectory(steps: TrajectoryStep[], reward: number): Promise<void> {
    if (this.learningSystem) {
      try {
        if (!this.learningSessionId) {
          this.learningSessionId = await this.learningSystem.startSession(
            'default', 'q-learning', { learningRate: 0.01, discountFactor: 0.99 },
          );
        }
        for (const step of steps) {
          await this.learningSystem.submitFeedback({
            sessionId: this.learningSessionId, action: step.action, state: step.state,
            reward: step.reward, nextState: step.nextState, success: step.reward > 0,
            timestamp: Date.now(),
          });
        }
        return;
      } catch {
        this.learningSystem = null;
        this.learningSessionId = null;
      }
    }
    this.trajectories.push({ steps, reward });
  }

  /**
   * Predict the next action for a state. AgentDB 3 exposes
   * `LearningSystem.predict(sessionId, state)`; the alpha line called a
   * `predictAction()` method that no longer exists and always fell through.
   */
  async predictAction(state: any): Promise<PredictedAction> {
    if (this.learningSystem && this.learningSessionId) {
      try {
        const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
        const p = await this.learningSystem.predict(this.learningSessionId, stateStr);
        if (p?.action) {
          return {
            action: p.action,
            confidence: p.confidence ?? 0,
            alternatives: (p.alternatives ?? []).map((a: any) => ({ action: a.action, confidence: a.confidence ?? 0 })),
          };
        }
      } catch { /* fall through */ }
    }
    return { action: 'noop', confidence: 0, alternatives: [] };
  }

  // -- Metrics --------------------------------------------------------------

  /**
   * Counts come from the persistent store. AgentDB 3 has no
   * getEpisodeCount()/getPatternCount(), so episodes are counted in SQL and
   * patterns through ReasoningBank.getPatternStats().
   */
  async getMetrics(): Promise<ServiceMetrics> {
    let episodes = this.episodeStore.size;
    let patterns = this.patternStore.size;
    if (this.reflexionMemory && this.db) {
      try {
        const row = this.db.database.prepare('SELECT COUNT(*) AS c FROM episodes').get();
        if (row && typeof row.c === 'number') episodes = row.c;
      } catch { /* use in-memory count */ }
    }
    if (this.reasoningBank) {
      try {
        const stats = this.reasoningBank.getPatternStats();
        if (stats && typeof stats.totalPatterns === 'number') patterns = stats.totalPatterns;
      } catch { /* use in-memory count */ }
    }
    return { backend: this.backendName, episodes, patterns, uptime: Date.now() - this.startTime };
  }

  // -- Cleanup --------------------------------------------------------------

  async shutdown(): Promise<void> {
    if (this.exitHook) {
      process.removeListener('exit', this.exitHook);
      this.exitHook = null;
    }
    if (this.learningSystem && this.learningSessionId) {
      try { await this.learningSystem.endSession(this.learningSessionId); } catch { /* ignore */ }
    }
    if (this.db && typeof this.db.close === 'function') {
      try { await this.db.close(); } catch { /* ignore cleanup errors */ }
    }
    this.db = null;
    this.reflexionMemory = null;
    this.reasoningBank = null;
    this.learningSystem = null;
    this.learningSessionId = null;
    this.initialized = false;
    if (AgentDBService.instance === this) AgentDBService.instance = null;
  }
}

/**
 * Get or create the singleton AgentDBService instance
 */
export async function getAgentDBService(): Promise<AgentDBService> {
  return await AgentDBService.getInstance();
}
