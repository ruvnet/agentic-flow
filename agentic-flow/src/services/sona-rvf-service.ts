/**
 * SONA trajectory + RVF vector-store service.
 *
 * Ported from agentic-flow 3.0.0-alpha.2. Trajectories, patterns and RVF
 * databases are kept in memory; `@ruvector/sona` and `@ruvector/rvf` are probed
 * with dynamic imports only to report availability, so the service works when
 * neither optional package is installed.
 */
// Held in variables so the optional packages are never resolved at compile time.
const SONA_MODULE = '@ruvector/sona';
const RVF_MODULE = '@ruvector/rvf';

export interface SonaTrajectory {
  id: string;
  startedAt: string;
  steps: SonaStep[];
  status: 'active' | 'completed';
}

export interface SonaStep {
  state: string;
  action: string;
  reward: number;
  timestamp: string;
}

export interface SonaPattern {
  id: string;
  pattern: string;
  frequency: number;
  avgReward: number;
}

export interface SonaStats {
  totalTrajectories: number;
  totalSteps: number;
  avgReward: number;
  patternsFound: number;
}

export interface RvfDatabase {
  id: string;
  name: string;
  vectorCount: number;
  dimension: number;
  createdAt: string;
}

export interface RvfQueryResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export class SonaRvfService {
  private static instance: SonaRvfService | null = null;
  private sonaModule: any = null;
  private rvfModule: any = null;
  private sonaAvailable = false;
  private rvfAvailable = false;
  private initialized = false;

  // In-memory fallbacks
  private trajectories = new Map<string, SonaTrajectory>();
  private patterns: SonaPattern[] = [];
  private rvfDatabases = new Map<string, RvfDatabase & { vectors: Array<{ id: string; vector: number[]; metadata: Record<string, unknown> }> }>();
  private trajectoryCounter = 0;

  private constructor() {}

  static async getInstance(): Promise<SonaRvfService> {
    if (!SonaRvfService.instance) {
      SonaRvfService.instance = new SonaRvfService();
      await SonaRvfService.instance.initialize();
    }
    return SonaRvfService.instance;
  }

  static resetInstance(): void {
    SonaRvfService.instance = null;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      this.sonaModule = await import(/* webpackIgnore: true */ SONA_MODULE);
      this.sonaAvailable = true;
    } catch {
      this.sonaAvailable = false;
    }
    try {
      this.rvfModule = await import(/* webpackIgnore: true */ RVF_MODULE);
      this.rvfAvailable = true;
    } catch {
      this.rvfAvailable = false;
    }
    this.initialized = true;
  }

  getAvailability(): { sona: boolean; rvf: boolean } {
    return { sona: this.sonaAvailable, rvf: this.rvfAvailable };
  }

  // -- SONA methods --

  beginTrajectory(): SonaTrajectory {
    const id = `traj-${++this.trajectoryCounter}-${Date.now()}`;
    const traj: SonaTrajectory = { id, startedAt: new Date().toISOString(), steps: [], status: 'active' };
    this.trajectories.set(id, traj);
    return traj;
  }

  addStep(trajectoryId: string, step: Omit<SonaStep, 'timestamp'>): SonaStep | null {
    const traj = this.trajectories.get(trajectoryId);
    if (!traj || traj.status !== 'active') return null;
    const fullStep: SonaStep = { ...step, timestamp: new Date().toISOString() };
    traj.steps.push(fullStep);
    return fullStep;
  }

  endTrajectory(trajectoryId: string): SonaTrajectory | null {
    const traj = this.trajectories.get(trajectoryId);
    if (!traj) return null;
    traj.status = 'completed';
    // Extract patterns
    if (traj.steps.length >= 2) {
      const avgReward = traj.steps.reduce((sum, s) => sum + s.reward, 0) / traj.steps.length;
      const patternStr = traj.steps.map(s => s.action).join(' -> ');
      const existing = this.patterns.find(p => p.pattern === patternStr);
      if (existing) {
        existing.frequency++;
        existing.avgReward = (existing.avgReward + avgReward) / 2;
      } else {
        this.patterns.push({ id: `pat-${this.patterns.length + 1}`, pattern: patternStr, frequency: 1, avgReward });
      }
    }
    return traj;
  }

  forceLearn(): { patternsUpdated: number; trajectoriesProcessed: number } {
    let processed = 0;
    for (const [, traj] of this.trajectories) {
      if (traj.status === 'active') {
        this.endTrajectory(traj.id);
        processed++;
      }
    }
    return { patternsUpdated: this.patterns.length, trajectoriesProcessed: processed };
  }

  findPatterns(limit: number = 10): SonaPattern[] {
    return [...this.patterns].sort((a, b) => b.frequency - a.frequency).slice(0, limit);
  }

  getStats(): SonaStats {
    let totalSteps = 0;
    let totalReward = 0;
    for (const [, traj] of this.trajectories) {
      totalSteps += traj.steps.length;
      totalReward += traj.steps.reduce((sum, s) => sum + s.reward, 0);
    }
    return {
      totalTrajectories: this.trajectories.size,
      totalSteps,
      avgReward: totalSteps > 0 ? totalReward / totalSteps : 0,
      patternsFound: this.patterns.length,
    };
  }

  // -- RVF methods --

  createDatabase(name: string, dimension: number): RvfDatabase {
    const id = `rvf-${Date.now()}`;
    const db: RvfDatabase & { vectors: Array<{ id: string; vector: number[]; metadata: Record<string, unknown> }> } = {
      id, name, vectorCount: 0, dimension, createdAt: new Date().toISOString(), vectors: [],
    };
    this.rvfDatabases.set(id, db);
    return { id, name, vectorCount: 0, dimension, createdAt: db.createdAt };
  }

  ingestBatch(databaseId: string, vectors: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): { ingested: number } | null {
    const db = this.rvfDatabases.get(databaseId);
    if (!db) return null;
    for (const v of vectors) {
      if (v.vector.length !== db.dimension) continue;
      db.vectors.push({ id: v.id, vector: v.vector, metadata: v.metadata || {} });
      db.vectorCount++;
    }
    return { ingested: vectors.length };
  }

  query(databaseId: string, queryVector: number[], k: number = 10): RvfQueryResult[] | null {
    const db = this.rvfDatabases.get(databaseId);
    if (!db) return null;
    // Cosine similarity search
    const results = db.vectors.map(v => {
      let dot = 0, magA = 0, magB = 0;
      for (let i = 0; i < Math.min(queryVector.length, v.vector.length); i++) {
        dot += queryVector[i] * v.vector[i];
        magA += queryVector[i] * queryVector[i];
        magB += v.vector[i] * v.vector[i];
      }
      const score = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
      return { id: v.id, score, metadata: v.metadata };
    }).sort((a, b) => b.score - a.score).slice(0, k);
    return results;
  }

  compact(databaseId: string): { compacted: boolean; vectorCount: number } | null {
    const db = this.rvfDatabases.get(databaseId);
    if (!db) return null;
    // Remove duplicate vectors
    const seen = new Set<string>();
    db.vectors = db.vectors.filter(v => {
      const key = v.vector.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    db.vectorCount = db.vectors.length;
    return { compacted: true, vectorCount: db.vectorCount };
  }

  getDatabaseStatus(databaseId: string): RvfDatabase | null {
    const db = this.rvfDatabases.get(databaseId);
    if (!db) return null;
    return { id: db.id, name: db.name, vectorCount: db.vectorCount, dimension: db.dimension, createdAt: db.createdAt };
  }
}
