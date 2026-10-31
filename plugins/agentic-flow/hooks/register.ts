import type { Register } from 'claude-code'

import { AGENT_TOOL, GUARD_FAILED, screen } from './guard'
import { readMode } from './options'
import { newStats, statusText } from './status'

/**
 * agentic-flow as a mod: a tighten-only guard on agentic_flow_agent and a
 * status-line entry. Every `$` call is in this file; guard.ts, options.ts and
 * status.ts are pure. No network, no process, no MCP calls.
 */
export const register: Register = (on, options) => {
  const mode = readMode(options)
  const stats = newStats()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      $.ui.status(statusText(mode, stats))
    } catch {
      /* a surface without a status line changes nothing */
    }
    return result
  })

  // Tighten-only: a deny or the event unchanged; never a rewrite.
  on('tool.call', { tool: AGENT_TOOL }, async ($, e, next) => {
    if (mode === 'off') return next(e)
    stats.calls++
    const refusal = screen(e as Readonly<Record<string, unknown>>)
    if (refusal !== undefined && mode === 'enforce') stats.blocked++
    if (refusal !== undefined && mode === 'notify') stats.flagged++
    try {
      $.ui.status(statusText(mode, stats))
      if (refusal !== undefined && mode === 'notify') $.ui.toast(`agentic-flow guard (notify): ${refusal.cls} pattern in an agentic_flow_agent task`)
    } catch {
      /* display is a courtesy */
    }
    if (refusal !== undefined && mode === 'enforce') return { deny: refusal.reason }
    return next(e)
  }).catch(($, e, next) => {
    // Fail closed: a guard that threw refuses the call, unless the guard is off
    // or the failure came from beneath it (the call already ran).
    if (mode === 'off' || next.called) return next(e)
    return { deny: GUARD_FAILED }
  })
}
