/**
 * Raspberry Pi 4 safety for the native optional packages.
 *
 * - @ruvector/router <= 0.1.33 and @ruvector/sona <= 0.1.12 shipped
 *   linux-arm64 binaries with LDAPR (ARMv8.3 RCPC) instructions and died with
 *   SIGILL on a Cortex-A72; router 0.1.34 and sona 0.1.13 are rebuilt without
 *   them, so those are the floors.
 * - @ruvector/attention linux-arm64 2.2.3/2.3.0 contain LDAPR; 2.3.1 does not.
 *   agentic-flow loads the native binary on a CPU without RCPC only when the
 *   installed binary is >= 2.3.1 (utils/native-cpu.ts), and the floor is ^2.3.1.
 * - A child killed by a signal must not be reported as exit code 0.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { cpuinfoHasRcpc, nativeAttentionCpuCheck, versionAtLeast } from '../../src/utils/native-cpu.js';
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

  it('on a Pi 4, loads an RCPC-free binary (>= 2.3.1) and skips older ones', () => {
    const pi4 = (binaryVersion: string | null) =>
      nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: PI4_CORTEX_A72, binaryVersion, override: '' });
    expect(pi4('2.3.1').ok).toBe(true);
    expect(pi4('2.4.0').ok).toBe(true);
    const old = pi4('2.3.0');
    expect(old.ok).toBe(false);
    expect(old.reason).toMatch(/lacks RCPC.*attention-linux-arm64-gnu@2\.3\.0/);
    expect(pi4('2.2.3').ok).toBe(false);
    expect(pi4(null).ok).toBe(false);
  });

  it('on a Pi 5 (RCPC), loads any binary; unknown CPU features need >= 2.3.1', () => {
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: PI5_CORTEX_A76, binaryVersion: '2.3.0', override: '' }).ok).toBe(true);
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: null, binaryVersion: '2.3.0', override: '' }).ok).toBe(false);
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: null, binaryVersion: '2.3.1', override: '' }).ok).toBe(true);
  });

  it('compares versions numerically', () => {
    expect(versionAtLeast('2.3.10', '2.3.1')).toBe(true);
    expect(versionAtLeast('2.10.0', '2.3.1')).toBe(true);
    expect(versionAtLeast('2.3.0', '2.3.1')).toBe(false);
    expect(versionAtLeast('x', '2.3.1')).toBeNull();
  });

  it('resolves @ruvector/attention >= 2.3.1 (the RCPC-free arm64 build)', () => {
    expect(versionNumber('@ruvector/attention')).toBeGreaterThanOrEqual(2_003_001);
  });

  it('never blocks other platforms, and honours the override', () => {
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'x64', cpuinfo: PI4_CORTEX_A72, override: '' }).ok).toBe(true);
    expect(nativeAttentionCpuCheck({ platform: 'darwin', arch: 'arm64', cpuinfo: null, override: '' }).ok).toBe(true);
    expect(nativeAttentionCpuCheck({ platform: 'linux', arch: 'arm64', cpuinfo: PI4_CORTEX_A72, binaryVersion: '2.3.0', override: '1' }).ok).toBe(true);
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
