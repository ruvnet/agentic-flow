import type { PluginOptions } from 'claude-code'

/** `enforce` (default): refuse. `notify`: let the call run, toast and count it. `off`: no checks. */
export type GuardMode = 'off' | 'notify' | 'enforce'
export const GUARD_MODES: readonly GuardMode[] = ['off', 'notify', 'enforce']

/** The userConfig key this mod reads. */
export const OPTION_KEY = 'guardMode'

/** A missing or unknown value is the default, enforce; `true`/`on` read as enforce and `false` as off. */
export function readMode(options: PluginOptions | Readonly<Record<string, unknown>> | undefined): GuardMode {
  const value = (options ?? {})[OPTION_KEY]
  if (value === true || value === 'on' || value === 'true') return 'enforce'
  if (value === false || value === 'false') return 'off'
  return GUARD_MODES.find(m => m === value) ?? 'enforce'
}
