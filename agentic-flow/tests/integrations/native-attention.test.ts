/**
 * RuVectorIntelligence must reach the native @ruvector/attention kernels, not
 * its JS fallback. Before 3.3.1, five of the six attention types plus all three
 * async helpers were called with argument shapes that @ruvector/attention 2.x
 * rejects (missing flash block size, positional args where 2.x takes a config
 * object, an AttentionType enum member that does not exist). Each call threw,
 * the error was swallowed and routing quietly fell back to JS.
 *
 * These tests load the real package (no mocks) and assert the native instance
 * computed the result and the fallback was never entered.
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RuVectorIntelligence,
  attentionAvailable,
} from '../../src/intelligence/RuVectorIntelligence.js';

const require = createRequire(import.meta.url);

function nativeAttentionInstalled(): boolean {
  try {
    require('@ruvector/attention');
    return true;
  } catch {
    return false;
  }
}

// CI runs on linux-x64, where the prebuilt binary always installs. Require it
// there so this suite cannot silently skip; elsewhere skip if it is absent.
const mustHaveNative = process.platform === 'linux' && process.arch === 'x64';
const haveNative = nativeAttentionInstalled();

const DIM = 64;
const vec = (seed: number) => Float32Array.from({ length: DIM }, (_, i) => Math.sin(i * 0.37 + seed) * 0.1);

// attentionType -> the private field holding the native instance
const NATIVE_FIELD = {
  multi_head: 'multiHeadAttention',
  flash: 'flashAttention',
  hyperbolic: 'hyperbolicAttention',
  moe: 'moeAttention',
  graph: 'graphAttention',
  dual: 'dualSpaceAttention',
} as const;

const created: RuVectorIntelligence[] = [];

async function makeIntelligence(attentionType: keyof typeof NATIVE_FIELD) {
  const intel = new RuVectorIntelligence({
    embeddingDim: DIM,
    attentionType,
    enableSona: false,
    enableHnsw: false,
    enableTrajectories: false,
  });
  created.push(intel);
  await intel.waitForInit();
  return intel;
}

afterEach(() => {
  while (created.length) created.pop()!.dispose();
  vi.restoreAllMocks();
});

describe('native @ruvector/attention is installed', () => {
  it.runIf(mustHaveNative)('loads on linux-x64 (the CI platform)', () => {
    expect(haveNative).toBe(true);
    expect(attentionAvailable).toBe(true);
  });
});

describe.skipIf(!haveNative)('RuVectorIntelligence routes through native attention', () => {
  for (const type of Object.keys(NATIVE_FIELD) as Array<keyof typeof NATIVE_FIELD>) {
    it(`'${type}' constructs the native kernel and never falls back`, async () => {
      const warn = vi.spyOn(console, 'warn');
      const intel = await makeIntelligence(type);

      const native = (intel as any)[NATIVE_FIELD[type]];
      expect(native, `${type} native instance`).toBeTruthy();
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Attention init failed/);

      const nativeCompute = vi.spyOn(native, 'compute');
      const fallback = vi.spyOn(intel as any, 'computeFallbackAttention');

      await intel.registerAgent('coder', vec(1));
      await intel.registerAgent('reviewer', vec(2));
      await intel.registerAgent('tester', vec(3));
      const results = await intel.routeTask(vec(1.1), undefined, 3);

      expect(nativeCompute).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();
      expect(results).toHaveLength(3);
      expect(results[0].attentionWeights).toHaveLength(DIM);
      for (const r of results) expect(Number.isFinite(r.confidence)).toBe(true);
    });
  }

  for (const type of ['standard', 'flash', 'hyperbolic'] as const) {
    it(`computeAttentionAsync('${type}') runs the native async kernel`, async () => {
      const intel = await makeIntelligence('moe');
      const keys = [vec(1), vec(2), vec(3)];
      const out = await intel.computeAttentionAsync(vec(1.1), keys, keys, type);
      expect(out).toBeInstanceOf(Float32Array);
      expect(out).toHaveLength(DIM);
      expect(Array.from(out).every(Number.isFinite)).toBe(true);
    });
  }
});
