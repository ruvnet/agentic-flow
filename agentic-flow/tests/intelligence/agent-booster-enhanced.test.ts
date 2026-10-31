/**
 * The enhanced agent-booster must not reward or serve its own cached outputs:
 * - a near-duplicate file with a different body gets its own output, not the
 *   cached output of the file it resembles;
 * - cache hits do not count as successes; only recordOutcome does;
 * - a pure identifier rename of a cached edit may still reuse the cache.
 *
 * The agent-booster CLI is replaced by a deterministic stub so no npx runs.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EnhancedAgentBooster } from '../../src/intelligence/agent-booster-enhanced.ts';

type Req = { code: string; edit: string; language: string };

let booster: EnhancedAgentBooster;
let boosterCalls: Req[];

/** Stub for the agent-booster CLI: applies `var` → `const` to the request's own code. */
async function fakeAgentBooster(request: Req) {
  boosterCalls.push(request);
  return {
    output: request.code.replace(/\bvar\b/g, 'const'),
    success: true,
    latency: 1,
    confidence: 0.9,
    strategy: 'agent_booster' as const,
    cacheHit: false,
    learned: false,
  };
}

function varToConst(code: string): Req {
  return { code, edit: code.replace(/\bvar\b/g, 'const'), language: 'javascript' };
}

function patternOf(id: string): any {
  return (booster as any).patterns.get(id);
}

beforeEach(async () => {
  booster = new EnhancedAgentBooster({
    storagePath: mkdtempSync(join(tmpdir(), 'booster-')),
    enableOnnx: false,
    enableSona: false,
  });
  boosterCalls = [];
  (booster as any).callAgentBooster = fakeAgentBooster;

  // Fuzzy matching only engages once three patterns are known.
  for (const code of ['var a = 1;', 'var list = [];', 'var name = "x";']) {
    await booster.apply(varToConst(code));
  }
  boosterCalls = [];
});

describe('EnhancedAgentBooster cache integrity', () => {
  it('gives two near-duplicate files with different bodies different outputs', async () => {
    const fileA = varToConst('var total = price * qty;\nreturn total;');
    const fileB = varToConst('var total = price * qty + tax;\nreturn total;');

    const a = await booster.apply(fileA);
    const b = await booster.apply(fileB);

    expect(a.output).toBe('const total = price * qty;\nreturn total;');
    expect(b.output).toBe('const total = price * qty + tax;\nreturn total;');
    expect(b.output).not.toBe(a.output);
    expect(boosterCalls.map(r => r.code)).toEqual([fileA.code, fileB.code]);
  });

  it('does not raise success counts from cache hits alone', async () => {
    const req = varToConst('var count = items.length;');
    const first = await booster.apply(req);
    const id = first.patternId ?? `${(booster as any).hash(req.code)}:${(booster as any).hash(req.edit)}:javascript`;
    const before = { ...patternOf(id) };

    for (let i = 0; i < 5; i++) {
      const hit = await booster.apply(req);
      expect(hit.strategy).toBe('exact_cache');
    }

    const after = patternOf(id);
    expect(after.successCount).toBe(before.successCount);
    expect(after.successCount).toBe(0);
    expect(after.failureCount).toBe(0);

    await booster.recordOutcome(id, true);
    expect(patternOf(id).successCount).toBe(1);
  });

  it('reuses a cached edit for a pure identifier rename, renamed', async () => {
    await booster.apply(varToConst('var count = items.length;'));
    boosterCalls = [];

    const renamed = await booster.apply(varToConst('var size = rows.length;'));

    expect(renamed.strategy).toBe('fuzzy_match');
    expect(renamed.output).toBe('const size = rows.length;');
    expect(boosterCalls).toHaveLength(0);
  });

  it('does not reuse a cached edit when a literal differs', async () => {
    await booster.apply(varToConst('var limit = 10;'));
    boosterCalls = [];

    const other = await booster.apply(varToConst('var limit = 20;'));

    expect(other.output).toBe('const limit = 20;');
    expect(boosterCalls).toHaveLength(1);
  });
});
