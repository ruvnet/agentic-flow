/**
 * CPU feature check for native optional packages on linux-arm64.
 *
 * The published @ruvector/attention linux-arm64-gnu binaries (2.2.3, 2.3.0)
 * contain LDAPR instructions (ARMv8.3 RCPC). A Raspberry Pi 4 (Cortex-A72,
 * ARMv8.0) has no RCPC, so loading the binary kills the process with SIGILL.
 * A signal is not an exception: the try/catch around the dynamic import never
 * runs, and the JS fallback never gets a chance. So we look at the CPU first
 * and skip the native load when the `lrcpc` feature is missing.
 *
 * Override with AGENTIC_FLOW_NATIVE_ATTENTION=1 (always load) or =0 (never).
 */
import { readFileSync } from 'node:fs';

export interface NativeCpuCheck {
  ok: boolean;
  reason?: string;
}

export interface NativeCpuEnv {
  platform?: string;
  arch?: string;
  /** Contents of /proc/cpuinfo; read from disk when omitted. */
  cpuinfo?: string | null;
  override?: string;
}

function readCpuinfo(): string | null {
  try {
    return readFileSync('/proc/cpuinfo', 'utf8');
  } catch {
    return null;
  }
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
  return {
    ok: false,
    reason:
      rcpc === false
        ? 'this arm64 CPU lacks RCPC (lrcpc), which the @ruvector/attention linux-arm64 binary needs (e.g. Raspberry Pi 4); using the JS fallback'
        : 'could not read arm64 CPU features from /proc/cpuinfo; using the JS fallback',
  };
}
