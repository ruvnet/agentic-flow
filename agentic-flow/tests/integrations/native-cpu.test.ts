/**
 * Raspberry Pi 4 safety for the native optional packages.
 *
 * - @ruvector/router <= 0.1.33 and @ruvector/sona <= 0.1.12 shipped
 *   linux-arm64 binaries with LDAPR (ARMv8.3 RCPC) instructions and died with
 *   SIGILL on a Cortex-A72; router 0.1.34 and sona 0.1.13 are rebuilt without
 *   them, so those are the floors.
 * - No @ruvector/attention linux-arm64 binary is LDAPR-free yet, so
 *   agentic-flow checks the CPU before loading it (utils/native-cpu.ts).
 * - A child killed by a signal must not be reported as exit code 0.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { cpuinfoHasRcpc, nativeAttentionCpuCheck } from '../../src/utils/native-cpu.js';
import { childExitCode } from '../../src/utils/child-exit.js';

const require = createRequire(import.meta.url);

// Features lines as printed by the kernel on each board.
const PI4_CORTEX_A72 = 'processor\t: 0\nFeatures\t: fp asimd evtstrm crc32 cpuid\nCPU part\t: 0xd08\n';
const PI5_CORTEX_A76 =
  'processor\t: 0\nFeatures\t: fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid asimdrdm lrcpc dcpop asimddp\nCPU part\t: 0xd0b\n';

function versionNumber(pkg: string): number {
  const [major, minor, patch] = require(`${pkg}/package.json`).version.split('.').map(Number);
  return major * 1e6 + minor * 1e3 + patch;
}

describe('arm64 CPU check for @ruvector/attention', () => {
  it('reads lrcpc from the cpuinfo Features line', () => {
    expect(cpuinfoHasRcpc(PI4_CORTEX_A72)).toBe(false);
    expect(cpuinfoHasRcpc(PI5_CORTEX_A76)).toBe(true);
    expect(cpuinfoHasRcpc('processor\t: 0\n')).toBeNull();
  });

  it('skips the native binary on a Pi 4 and loads it on a Pi 5', () => {
    const pi4 = nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: PI4_CORTEX_A72, override: '' });
    expect(pi4.ok).toBe(false);
    expect(pi4.reason).toMatch(/lacks RCPC/);
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: PI5_CORTEX_A76, override: '' }).ok).toBe(true);
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: null, override: '' }).ok).toBe(false);
  });

  it('never blocks other platforms, and honours the override', () => {
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'x64', cpuinfo: PI4_CORTEX_A72, override: '' }).ok).toBe(true);
    expect(nativeAttentionCpuCheck({ platform: 'darwin', arch: 'arm64', cpuinfo: null, override: '' }).ok).toBe(true);
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: PI4_CORTEX_A72, override: '1' }).ok).toBe(true);
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'x64', override: '0' }).ok).toBe(false);
  });

  it('loads the real package where the CPU allows it, and falls back when it does not', async () => {
    vi.resetModules();
    const native = await import('../../src/core/attention-native.js');
    expect(native.attentionAvailable).toBe(nativeAttentionCpuCheck().ok);

    vi.resetModules();
    vi.stubEnv('AGENTIC_FLOW_NATIVE_ATTENTION', '0');
    try {
      const skipped = await import('../../src/core/attention-native.js');
      expect(skipped.attentionAvailable).toBe(false);
      const fallbacks = await import('../../src/core/attention-fallbacks.js');
      expect(fallbacks.isNativeAttentionAvailable()).toBe(false);
      const mha = fallbacks.createAttention('multi-head', { hiddenDim: 8, numHeads: 2 }) as any;
      const q = Array.from({ length: 8 }, (_, i) => i / 8);
      expect(mha.forward(q, q, q).output).toHaveLength(8);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('LDAPR-free floors for the other native packages', () => {
  it('resolves @ruvector/router >= 0.1.34 and its HNSW index works', () => {
    expect(versionNumber('@ruvector/router')).toBeGreaterThanOrEqual(1_034);
    const { VectorDb } = require('@ruvector/router');
    const db = new VectorDb({ dimensions: 4 });
    db.insert('a', new Float32Array([1, 0, 0, 0]));
    db.insert('b', new Float32Array([0, 1, 0, 0]));
    expect(db.search(new Float32Array([1, 0, 0, 0]), 1)[0].id).toBe('a');
  });

  it('resolves @ruvector/sona >= 0.1.13 and constructs an engine', () => {
    expect(versionNumber('@ruvector/sona')).toBeGreaterThanOrEqual(1_013);
    const { SonaEngine } = require('@ruvector/sona');
    expect(new SonaEngine(16)).toBeTruthy();
  });
});

describe('childExitCode', () => {
  it('forwards a crash by signal as 128 + signal instead of 0', () => {
    expect(childExitCode(null, 'SIGILL')).toBe(132);
    expect(childExitCode(null, 'SIGKILL')).toBe(137);
    expect(childExitCode(0, null)).toBe(0);
    expect(childExitCode(3, null)).toBe(3);
    expect(childExitCode(null, null)).toBe(1);
  });
});
