/**
 * Native optional packages must not be able to abort the Node process on bad
 * input: @ruvector/attention >= 2.2.3 (GHSA-p62c-q7fc-qmg9) validates lengths,
 * @ruvector/sona >= 0.1.9 throws on LoRA input-length mismatches (<= 0.1.8
 * aborted; GHSA-c27m-v4wg-f9qj), 0.1.11 also validates engine sizes and catches
 * panics at every NAPI entry point, and the sona loader checks LoRA lengths itself. The risky calls run in a child process so
 * a regression shows up as a failed assertion, not a dead test runner.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { requireSonaEngine, guardSonaEngine } from '../../src/services/sona-loader.js';

const require = createRequire(import.meta.url);
const attentionPkg = require('@ruvector/attention/package.json');

function runChild(code: string) {
  return spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', cwd: process.cwd(), timeout: 30000 });
}

describe('@ruvector/attention', () => {
  it('resolves a release with the input-validation fix (>= 2.2.3)', () => {
    const [major, minor, patch] = attentionPkg.version.split('.').map(Number);
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(2_002_003);
  });

  it('throws on a key/query length mismatch instead of aborting the process', () => {
    const r = runChild(`
      const m = require('@ruvector/attention');
      try { new m.MultiHeadAttention(8, 2).compute(new Float32Array(8), [new Float32Array(4)], [new Float32Array(8)]); console.log('no-throw'); }
      catch (e) { console.log('THROW ' + e.message); }`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^THROW keys\[0\] must have length 8/);
  });

  it('computes the attention calls agentic-flow makes', () => {
    const m = require('@ruvector/attention');
    const q = Float32Array.from({ length: 16 }, (_, i) => Math.sin(i) * 0.1);
    const kv = [q.map((x) => x * 0.5), q.map((x) => -x)];
    expect(new m.MultiHeadAttention(16, 4).compute(q, kv, kv)).toHaveLength(16);
    expect(new m.HyperbolicAttention(16, 1.0).compute(q, kv, kv)).toHaveLength(16);
    expect(new m.MoEAttention({ dim: 16, numExperts: 4, topK: 2 }).compute(q, kv, kv)).toHaveLength(16);
    expect(m.poincareDistance(Float32Array.from([0.1, 0.2]), Float32Array.from([-0.3, 0.1]), 1.0)).toBeCloseTo(0.8646, 3);
  });
});

describe('@ruvector/sona LoRA input guard', () => {
  it('resolves a release with boundary validation and catch_unwind (>= 0.1.11)', () => {
    const [major, minor, patch] = require('@ruvector/sona/package.json').version.split('.').map(Number);
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(1_011);
  });

  it('rejects zero-sized engine configs with an Error instead of aborting', () => {
    const r = runChild(`
      const { SonaEngine } = require('@ruvector/sona');
      for (const make of [() => new SonaEngine(0), () => SonaEngine.withConfig({ hiddenDim: 16, embeddingDim: 16, trajectoryCapacity: 0 })]) {
        try { make(); console.log('no-throw'); } catch (e) { console.log('THROW ' + e.message); }
      }`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^THROW hiddenDim must be between 1 and 65536, got 0\nTHROW trajectoryCapacity must be between/);
  });

  it('rejects a wrong-length vector with a RangeError and keeps working', () => {
    const SonaEngine = requireSonaEngine();
    for (const engine of [new SonaEngine(16), SonaEngine.withConfig({ hiddenDim: 16, embeddingDim: 32 })]) {
      expect(() => engine.applyMicroLora(new Array(5).fill(0.1))).toThrow(RangeError);
      expect(() => engine.applyBaseLora(0, new Array(32).fill(0.1))).toThrow(/hiddenDim is 16/);
      expect(() => engine.applyMicroLora('nope')).toThrow(TypeError);
      expect(engine.applyMicroLora(new Array(16).fill(0.1))).toHaveLength(16);
      expect(engine.applyBaseLora(0, new Array(16).fill(0.1))).toHaveLength(16);
    }
  });

  it('the resolved native engine throws (not aborts) on the same input without the guard', () => {
    const r = runChild(`
      const { SonaEngine } = require('@ruvector/sona');
      try { new SonaEngine(16).applyMicroLora(new Array(5).fill(0.1)); console.log('no-throw'); }
      catch (e) { console.log('THROW ' + e.message); }`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^THROW input length 5 does not match hiddenDim 16/);
  });

  it('guardSonaEngine ignores engines without a known dimension', () => {
    const fake = { applyMicroLora: (v: number[]) => v };
    expect(guardSonaEngine(fake, 0).applyMicroLora([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
