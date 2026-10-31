/**
 * Pure checks for agentic_flow_agent calls. No `$` here: register.ts makes
 * every engine call and imports only these helpers.
 *
 * This is a short list of obvious patterns, not a sandbox. Text that means the
 * same thing in other words gets through; the real boundary is agentic-flow's
 * own permission default (read-only tools unless bypass is opted into).
 */

/** Matches the tool however the server is named: plugin-scoped or a direct `mcp__agentic-flow__` entry. */
export const AGENT_TOOL = /^mcp__[A-Za-z0-9_.-]*agentic-flow__agentic_flow_agent$/

export type Refusal = { readonly cls: 'destructive' | 'exfiltration' | 'key-in-args'; readonly reason: string }

type Rule = { readonly cls: Refusal['cls']; readonly what: string; readonly re: RegExp }

const RULES: readonly Rule[] = [
  { cls: 'destructive', what: 'recursive delete of /, ~, $HOME or *', re: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]*\s+)*(--no-preserve-root\s+)?["'`]?(\/|~|\$home|\*)(\/?\*?)?["'`]?(\s|$|;|&|\||\))/ },
  { cls: 'destructive', what: 'filesystem format (mkfs)', re: /\bmkfs(\.[a-z0-9]+)?\b/ },
  { cls: 'destructive', what: 'raw write to a disk device', re: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|vd|xvd|disk|mmcblk)/ },
  { cls: 'destructive', what: 'shell fork bomb', re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  { cls: 'destructive', what: 'recursive chmod/chown of /', re: /\bch(mod|own)\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*\s+\S+\s+\/(\s|$)/ },
  { cls: 'destructive', what: 'dropping a database', re: /\bdrop\s+(database|schema)\b/ },
  { cls: 'destructive', what: 'force-push over a main branch', re: /\bgit\s+push\b[^\n]*(--force\b|\s-f\b)[^\n]*\b(main|master)\b/ },
  { cls: 'exfiltration', what: 'piping a download into a shell', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/ },
  { cls: 'exfiltration', what: 'reading private keys or cloud credentials', re: /(~|\$home|\/home\/[^/\s]+|\/root)\/\.(ssh\/(id_|[a-z0-9_-]*key)|aws\/credentials|config\/gcloud|kube\/config|docker\/config\.json|npmrc|netrc|gnupg)/ },
  { cls: 'exfiltration', what: 'reading /etc/shadow', re: /\/etc\/(g?shadow)\b/ },
  { cls: 'exfiltration', what: 'sending secrets or .env files to the network', re: /(\.env\b|secret|token|api[_-]?key|password|credential)[^\n]{0,120}\b(curl|wget|nc|ncat|netcat|scp|rsync)\b|\b(curl|wget|nc|ncat|netcat|scp)\b[^\n]{0,120}(\.env\b|secret|token|api[_-]?key|password|credential)/ },
  { cls: 'exfiltration', what: 'an explicit exfiltration request', re: /\bexfiltrat/ },
]

/** Lowercased, whitespace collapsed, so spacing and case do not slip a pattern. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

const KEY_ARGS = ['anthropicApiKey', 'openrouterApiKey'] as const

/** The first rule the call breaks, or undefined. `args` is the tool call's input (`e`). */
export function screen(args: Readonly<Record<string, unknown>>): Refusal | undefined {
  for (const k of KEY_ARGS) {
    const v = args[k]
    if (typeof v === 'string' && v.trim() !== '') {
      return { cls: 'key-in-args', reason: `agentic-flow guard: refused agentic_flow_agent with ${k} as an argument; arguments land in the transcript. Set the key in the plugin's settings or your environment instead.` }
    }
  }
  const text = normalize([args.task, args.agent].filter(v => typeof v === 'string').join(' \n '))
  if (text === '') return undefined
  for (const r of RULES) {
    if (r.re.test(text)) {
      return { cls: r.cls, reason: `agentic-flow guard: refused agentic_flow_agent: the task matches a ${r.cls} pattern (${r.what}). If this is intended, run it yourself, or set the plugin's guardMode to notify.` }
    }
  }
  return undefined
}

/** What a guard that threw or overran answers: fail closed while it is on. */
export const GUARD_FAILED = 'agentic-flow guard: the check failed, so the call is refused (fail closed). Set guardMode to off to bypass the guard.'
