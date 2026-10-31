/**
 * ReasoningBank must learn from outcomes: memories used by a failing task lose
 * confidence and rank, retrieval alone is not a reward, and pruning does not
 * spare a failing memory because it was used.
 *
 * Runs against the built package (dist/): src/reasoningbank has stale tracked
 * .js siblings that the test runner would resolve instead of the .ts sources.
 * Requires `npm run build` first. No API keys: judge and distill run their
 * offline heuristic/template paths.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const pkgRoot = fileURLToPath(new URL('../..', import.meta.url));
const distIndex = join(pkgRoot, 'dist', 'reasoningbank', 'index.js');

const AGENT = 'coder-under-test';
const QUERY = 'retry flaky HTTP requests with exponential backoff';
const KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GEMINI_API_KEY'];

let rb: any;
let db: any;
const savedEnv: Record<string, string | undefined> = {};

async function seedMemory(id: string, confidence: number, agentId = AGENT): Promise<void> {
  db.upsertMemory({
    id,
    type: 'reasoning_memory',
    pattern_data: {
      title: 'Retry strategy',
      description: 'How to retry HTTP calls',
      content: 'Retry failed HTTP requests with exponential backoff and jitter.',
      source: { task_id: 'seed', agent_id: agentId, outcome: 'Success', evidence: [] },
      tags: [],
      domain: 'test',
      created_at: new Date().toISOString(),
      confidence,
      n_uses: 0,
    },
    confidence,
    usage_count: 0,
  });
  // Identical text for every seeded memory: similarity and recency tie, so
  // only confidence separates them.
  const vector = await rb.computeEmbedding(QUERY);
  db.upsertEmbedding({ id, model: 'test', dims: vector.length, vector });
}

function confidenceOf(id: string): number {
  return db.getDb().prepare('SELECT confidence FROM patterns WHERE id = ?').get(id).confidence;
}

function failingTask(n: number) {
  return rb.runTask({
    taskId: `task-${n}`,
    agentId: AGENT,
    query: QUERY,
    domain: 'test',
    executeFn: async () => ({ steps: [{ action: 'http.get', result: 'error: connection reset' }] }),
  });
}

describe('ReasoningBank outcome learning', () => {
  beforeAll(async () => {
    if (!existsSync(distIndex)) {
      throw new Error(`${distIndex} missing: run \`npm run build\` before this suite`);
    }
    for (const k of KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    savedEnv.CLAUDE_FLOW_DB_PATH = process.env.CLAUDE_FLOW_DB_PATH;
    rb = await import(pathToFileURL(distIndex).href);
    db = rb.db;
  });

  beforeEach(async () => {
    db.closeDb();
    process.env.CLAUDE_FLOW_DB_PATH = join(mkdtempSync(join(tmpdir(), 'rb-outcome-')), 'memory.db');
    await db.runMigrations();
  });

  afterAll(() => {
    db?.closeDb();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('decays a memory used by failing tasks below a neutral memory', async () => {
    await seedMemory('bad-advice', 0.7);
    await seedMemory('neutral', 0.5);
    // Another agent's memory: this agent's tasks never use it, so it stays a
    // fixed reference point. Both are ranked through an agent-agnostic fetch.
    db.getDb()
      .prepare(`UPDATE patterns SET pattern_data = json_set(pattern_data, '$.source.agent_id', 'someone-else') WHERE id = 'neutral'`)
      .run();

    const history: number[] = [confidenceOf('bad-advice')];
    for (let i = 0; i < 5; i++) {
      const { verdict, usedMemories } = await failingTask(i);
      expect(verdict.label).toBe('Failure');
      if (usedMemories.some((m: any) => m.id === 'bad-advice')) {
        history.push(confidenceOf('bad-advice'));
      }
    }

    expect(history.length).toBeGreaterThan(1);
    for (let i = 1; i < history.length; i++) expect(history[i]).toBeLessThan(history[i - 1]);
    expect(confidenceOf('bad-advice')).toBeLessThan(confidenceOf('neutral'));
    expect(confidenceOf('neutral')).toBe(0.5);

    const ranked = db.fetchMemoryCandidates({ minConfidence: 0 }).map((m: any) => m.id);
    expect(ranked.indexOf('neutral')).toBeLessThan(ranked.indexOf('bad-advice'));
  }, 120_000);

  it('does not reward a memory for being retrieved', async () => {
    await seedMemory('m', 0.6);
    for (let i = 0; i < 5; i++) await rb.retrieveMemories(QUERY, { agent: AGENT });
    expect(confidenceOf('m')).toBe(0.6);
  }, 60_000);

  it('prunes old low-confidence memories even if they were used', async () => {
    await seedMemory('used-but-bad', 0.1);
    db.incrementUsage('used-but-bad');
    db.getDb().prepare(`UPDATE patterns SET created_at = datetime('now', '-400 days')`).run();

    expect(db.pruneOldMemories({ maxAgeDays: 180, minConfidence: 0.3 })).toBe(1);
  });

  it('honours the agent filter, keeping shared memories', async () => {
    await seedMemory('mine', 0.6, AGENT);
    await seedMemory('theirs', 0.6, 'other-agent');
    await seedMemory('shared', 0.6, 'unknown');

    const ids = db.fetchMemoryCandidates({ agent: AGENT, minConfidence: 0 }).map((m: any) => m.id).sort();
    expect(ids).toEqual(['mine', 'shared']);
  });
});
