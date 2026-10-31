import type { GuardMode } from './options'

export type Stats = { calls: number; blocked: number; flagged: number }

export const newStats = (): Stats => ({ calls: 0, blocked: 0, flagged: 0 })

/** The status-line entry: mode and counts, short enough for a narrow terminal. */
export function statusText(mode: GuardMode, s: Stats): string {
  if (mode === 'off') return 'agentic-flow: guard off'
  const hit = mode === 'enforce' ? `${s.blocked} blocked` : `${s.flagged} flagged`
  return `agentic-flow: guard ${mode} · ${s.calls} checked · ${hit}`
}

/** `/agentic-flow-guard`: the mod's own answer, no model turn. */
export const COMMAND = 'agentic-flow-guard'

export function commandText(mode: GuardMode, s: Stats): string {
  const lines = [statusText(mode, s)]
  if (mode === 'enforce') lines.push('agentic_flow_agent calls with destructive or exfiltration task text, or inline keys, are refused.')
  else if (mode === 'notify') lines.push('Matching agentic_flow_agent calls are flagged, not refused.')
  else lines.push('The guard is off: agentic_flow_agent calls pass unchecked.')
  lines.push('This is a pattern list, not a sandbox. Set guardMode in the plugin options.')
  return lines.join('\n')
}
