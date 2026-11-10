import { constants } from 'node:os';

/**
 * Exit code to forward from a child process. A child killed by a signal
 * reports `code === null`; forwarding `code || 0` turned a crash (for example
 * SIGILL from a native module on a CPU it does not support) into success.
 * Use the shell convention 128 + signal number instead.
 */
export function childExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal) return 128 + ((constants.signals as Record<string, number>)[signal] ?? 0);
  return 1;
}
