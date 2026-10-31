import type { GuardMode } from './options'

export type Stats = { calls: number; blocked: number; flagged: number }

export const newStats = (): Stats => ({ calls: 0, blocked: 0, flagged: 0 })

/** The status-line entry: mode and counts, short enough for a narrow terminal. */
export function statusText(mode: GuardMode, s: Stats): string {
  if (mode === 'off') return 'agentic-flow: guard off'
  const hit = mode === 'enforce' ? `${s.blocked} blocked` : `${s.flagged} flagged`
  return `agentic-flow: guard ${mode} · ${s.calls} checked · ${hit}`
}
