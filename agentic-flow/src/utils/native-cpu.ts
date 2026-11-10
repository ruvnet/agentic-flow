/**
 * CPU feature check for the native @ruvector/attention binary on linux-arm64.
 *
 * The @ruvector/attention linux-arm64-gnu binaries 2.2.3 and 2.3.0 contain
 * LDAPR instructions (ARMv8.3 RCPC). A Raspberry Pi 4 (Cortex-A72, ARMv8.0)
 * has no RCPC, so loading them kills the process with SIGILL. A signal is not
 * an exception: the try/catch around the dynamic import never runs. 2.3.1 is
 * rebuilt without RCPC (0 LDAPR) and loads on a Cortex-A72.
 *
 * So on linux-arm64 we allow the native load when the CPU has `lrcpc`, or when
 * the installed platform binary is >= 2.3.1. Anything else (older binary on a
 * CPU without RCPC, or a version we cannot read) uses the JS fallback.
 *
 * Override with AGENTIC_FLOW_NATIVE_ATTENTION=1 (always load) or =0 (never).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/** First @ruvector/attention linux-arm64-gnu release built without RCPC. */
export const RCPC_FREE_ATTENTION_ARM64 = '2.3.1';

const ARM64_BINARY_PKG = '@ruvector/attention-linux-arm64-gnu';

export interface NativeCpuCheck {
  ok: boolean;
  reason?: string;
}

export interface NativeCpuEnv {
  platform?: string;
  arch?: string;
  /** Contents of /proc/cpuinfo; read from disk when omitted. */
  cpuinfo?: string | null;
  /** Installed linux-arm64 attention binary version; resolved when omitted. */
  binaryVersion?: string | null;
  override?: string;
}

function readCpuinfo(): string | null {
  try {
    return readFileSync('/proc/cpuinfo', 'utf8');
  } catch {
    return null;
  }
}

/**
 * Version of the linux-arm64 attention binary package that
 * `require('@ruvector/attention')` would load, read from its package.json
 * (resolved from @ruvector/attention's own directory, as its loader does),
 * without loading the binary.
 */
export function installedArm64AttentionVersion(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const fromAttention = createRequire(req.resolve('@ruvector/attention/package.json'));
    return fromAttention(`${ARM64_BINARY_PKG}/package.json`).version ?? null;
  } catch {
    return null;
  }
}

/** a >= b for plain x.y.z versions; null if either does not parse. */
export function versionAtLeast(a: string, b: string): boolean | null {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
}

/** True when the cpuinfo `Features` line lists `lrcpc` (ARMv8.3 RCPC, LDAPR). */
export function cpuinfoHasRcpc(cpuinfo: string): boolean | null {
  const lines = cpuinfo.split('\n').filter((l) => /^Features\s*:/.test(l));
  if (lines.length === 0) return null;
  return lines.every((l) => l.split(':')[1].trim().split(/\s+/).includes('lrcpc'));
}

/**
 * Whether it is safe to load the native @ruvector/attention binary here.
 * Off linux-arm64 the answer is always yes (the module's own loader decides).
 */
export function nativeAttentionCpuCheck(env: NativeCpuEnv = {}): NativeCpuCheck {
  const override = env.override ?? process.env.AGENTIC_FLOW_NATIVE_ATTENTION;
  if (override === '0') return { ok: false, reason: 'disabled by AGENTIC_FLOW_NATIVE_ATTENTION=0' };
  if (override === '1') return { ok: true };

  const platform = env.platform ?? process.platform;
  const arch = env.arch ?? process.arch;
  if (platform !== 'linux' || arch !== 'arm64') return { ok: true };

  const cpuinfo = env.cpuinfo === undefined ? readCpuinfo() : env.cpuinfo;
  const rcpc = cpuinfo == null ? null : cpuinfoHasRcpc(cpuinfo);
  if (rcpc === true) return { ok: true };

  const binary = env.binaryVersion === undefined ? installedArm64AttentionVersion() : env.binaryVersion;
  if (binary && versionAtLeast(binary, RCPC_FREE_ATTENTION_ARM64)) return { ok: true };

  const cpu = rcpc === false ? 'this arm64 CPU lacks RCPC (lrcpc)' : 'could not read arm64 CPU features from /proc/cpuinfo';
  const have = binary ? `${ARM64_BINARY_PKG}@${binary} needs it` : `the ${ARM64_BINARY_PKG} version could not be read`;
  return {
    ok: false,
    reason: `${cpu} and ${have}; ${RCPC_FREE_ATTENTION_ARM64}+ runs without it. Using the JS fallback`,
  };
}
