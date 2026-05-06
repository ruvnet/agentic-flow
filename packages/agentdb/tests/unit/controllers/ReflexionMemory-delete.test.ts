/**
 * Verification for issue #150 (agentdb side of ruflo#1784 / RuVector#427).
 *
 * Covers:
 *   - ReflexionMemory.deleteEpisode removes from SQL when no graph/vector
 *     backend is configured.
 *   - GraphDatabaseAdapter.deleteNode / deleteEdge / deleteHyperedge /
 *     deleteEdgesByEndpoints emit the expected Cypher and surface the
 *     correct boolean / count.
 *   - cascade: false refuses when incident edges exist.
 *
 * The Cypher-emission tests use a fake `db` that records every `query()`
 * call — so they verify behaviour without standing up the native binding,
 * which isn't always available in CI.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReflexionMemory, type Episode } from '../../../src/controllers/ReflexionMemory.js';
import { GraphDatabaseAdapter } from '../../../src/backends/graph/GraphDatabaseAdapter.js';

// ---------- minimal in-memory SQLite-shaped fake ----------
type Row = Record<string, any>;
class InMemoryStmt {
  constructor(public sql: string, private impl: (params: any[]) => any) {}
  run(...params: any[]) {
    return this.impl(params);
  }
  all(...params: any[]) {
    return this.impl(params);
  }
  get(...params: any[]) {
    const all = this.impl(params);
    return Array.isArray(all) ? all[0] : all;
  }
}

class InMemoryDb {
  private nextEpisodeId = 1;
  episodes: Row[] = [];
  embeddings: Row[] = [];

  prepare(sql: string): InMemoryStmt {
    const norm = sql.replace(/\s+/g, ' ').trim();
    if (norm.startsWith('INSERT INTO episodes')) {
      return new InMemoryStmt(sql, (p) => {
        const id = this.nextEpisodeId++;
        this.episodes.push({
          id,
          ts: Math.floor(Date.now() / 1000),
          session_id: p[0],
          task: p[1],
          input: p[2],
          output: p[3],
          critique: p[4],
          reward: p[5],
          success: p[6],
          latency_ms: p[7],
          tokens_used: p[8],
          tags: p[9],
          metadata: p[10],
        });
        return { changes: 1, lastInsertRowid: id };
      });
    }
    if (norm.startsWith('INSERT INTO episode_embeddings')) {
      return new InMemoryStmt(sql, (p) => {
        this.embeddings.push({ episode_id: p[0], embedding: p[1] });
        return { changes: 1, lastInsertRowid: p[0] };
      });
    }
    if (norm.startsWith('DELETE FROM episodes')) {
      return new InMemoryStmt(sql, (p) => {
        const before = this.episodes.length;
        this.episodes = this.episodes.filter((e) => e.id !== p[0]);
        return { changes: before - this.episodes.length, lastInsertRowid: p[0] };
      });
    }
    if (norm.startsWith('DELETE FROM episode_embeddings')) {
      return new InMemoryStmt(sql, (p) => {
        const before = this.embeddings.length;
        this.embeddings = this.embeddings.filter((e) => e.episode_id !== p[0]);
        return { changes: before - this.embeddings.length, lastInsertRowid: p[0] };
      });
    }
    if (norm.startsWith('SELECT')) {
      return new InMemoryStmt(sql, () => []);
    }
    throw new Error(`InMemoryDb: unsupported SQL: ${norm}`);
  }
  exec() {}
  pragma() {}
}

class FakeEmbedder {
  async initialize() {}
  async embed(_text: string): Promise<Float32Array> {
    return new Float32Array([1, 0, 0]);
  }
}

describe('ReflexionMemory.deleteEpisode (issue #150)', () => {
  let db: InMemoryDb;
  let mem: ReflexionMemory;

  beforeEach(() => {
    db = new InMemoryDb();
    mem = new ReflexionMemory(db as any, new FakeEmbedder() as any);
  });

  it('removes the episode and its embedding from SQL', async () => {
    const epId = await mem.storeEpisode({
      sessionId: 's1',
      task: 'demo',
      reward: 0.9,
      success: true,
    } as Episode);

    expect(db.episodes.find((e) => e.id === epId)).toBeDefined();
    expect(db.embeddings.find((e) => e.episode_id === epId)).toBeDefined();

    const removed = await mem.deleteEpisode(epId);
    expect(removed).toBe(true);
    expect(db.episodes.find((e) => e.id === epId)).toBeUndefined();
    expect(db.embeddings.find((e) => e.episode_id === epId)).toBeUndefined();
  });

  it('returns false when the episode does not exist', async () => {
    const removed = await mem.deleteEpisode(99999);
    expect(removed).toBe(false);
  });

  it('accepts numeric and string ids interchangeably', async () => {
    const epId = await mem.storeEpisode({
      sessionId: 's1',
      task: 't',
      reward: 1,
      success: true,
    } as Episode);
    const removed = await mem.deleteEpisode(String(epId));
    expect(removed).toBe(true);
  });
});

// ---------- Cypher-emission tests for GraphDatabaseAdapter ----------

class CypherSpy {
  calls: string[] = [];
  rowsToReturn: Record<string, any[]> = {};
  // Allow tests to set canned return values keyed by RegExp source.
  pattern(regex: string, rows: any[]) {
    this.rowsToReturn[regex] = rows;
  }
  async query(cypher: string) {
    this.calls.push(cypher);
    for (const [src, rows] of Object.entries(this.rowsToReturn)) {
      if (new RegExp(src).test(cypher)) return { rows };
    }
    return { rows: [{ deleted: 0, edgeCount: 0 }] };
  }
}

function makeAdapter(db: CypherSpy): GraphDatabaseAdapter {
  const adapter = new GraphDatabaseAdapter(
    { storagePath: ':memory:' } as any,
    {} as any,
  );
  // bypass initialize() — inject fake db directly
  (adapter as any).db = db;
  return adapter;
}

describe('GraphDatabaseAdapter delete API (issue #150)', () => {
  it('deleteNode emits DETACH DELETE and reports edge count', async () => {
    const db = new CypherSpy();
    db.pattern('MATCH \\({id:.*}\\)-\\[r\\]-', [{ edgeCount: 3 }]);
    db.pattern('DETACH DELETE n RETURN', [{ deleted: 1 }]);

    const adapter = makeAdapter(db);
    const r = await adapter.deleteNode('episode-42');

    expect(r).toEqual({ deletedNode: true, deletedEdges: 3 });
    expect(db.calls.some((c) => c.includes('DETACH DELETE'))).toBe(true);
    expect(db.calls.some((c) => c.includes("episode-42"))).toBe(true);
  });

  it('deleteNode { cascade: false } refuses when incident edges exist', async () => {
    const db = new CypherSpy();
    db.pattern('MATCH \\({id:.*}\\)-\\[r\\]-', [{ edgeCount: 2 }]);

    const adapter = makeAdapter(db);
    await expect(adapter.deleteNode('n1', { cascade: false })).rejects.toThrow(
      /2 incident edge/,
    );
  });

  it('deleteEdge matches by id and returns deleted: true on hit', async () => {
    const db = new CypherSpy();
    db.pattern('MATCH \\(\\)-\\[r {id:', [{ deleted: 1 }]);
    const adapter = makeAdapter(db);
    const r = await adapter.deleteEdge('edge-7');
    expect(r).toEqual({ deleted: true });
    expect(db.calls[0]).toContain("'edge-7'");
  });

  it('deleteHyperedge scopes the match with :HYPEREDGE label', async () => {
    const db = new CypherSpy();
    db.pattern('HYPEREDGE', [{ deleted: 1 }]);
    const adapter = makeAdapter(db);
    const r = await adapter.deleteHyperedge('hy-1');
    expect(r).toEqual({ deleted: true });
    expect(db.calls[0]).toMatch(/:HYPEREDGE/);
  });

  it('deleteEdgesByEndpoints returns the count of matched edges', async () => {
    const db = new CypherSpy();
    db.pattern('->\\({id:', [{ deleted: 4 }]);
    const adapter = makeAdapter(db);
    const r = await adapter.deleteEdgesByEndpoints('a', 'b', 'SUPERSEDES');
    expect(r).toEqual({ deleted: 4 });
    expect(db.calls[0]).toContain(":SUPERSEDES");
  });

  it('deleteEdgesByEndpoints rejects invalid label characters', async () => {
    const db = new CypherSpy();
    const adapter = makeAdapter(db);
    await expect(adapter.deleteEdgesByEndpoints('a', 'b', 'evil; DROP')).rejects.toThrow(
      /Invalid graph label/,
    );
  });

  it('escapes embedded single quotes and backslashes in ids', async () => {
    const db = new CypherSpy();
    db.pattern('deleted', [{ deleted: 0 }]);
    const adapter = makeAdapter(db);
    await adapter.deleteEdge("ed'ge\\1");
    // Embedded single quote should appear escaped in the emitted Cypher.
    expect(db.calls[0]).toContain("ed\\'ge");
    expect(db.calls[0]).toContain("\\\\1");
  });
});
