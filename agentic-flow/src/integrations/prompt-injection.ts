/**
 * Prompt-injection screening for task text.
 *
 * Uses the optional `aidefence` package (53 curated patterns across encodings
 * and obfuscation variants) when installed, and a small built-in pattern set
 * otherwise. Only the `aidefence/dist/detection` subpath is loaded: the package
 * root starts an Express server stack, the detection engine has no deps.
 *
 * Policy (env `AGENTIC_FLOW_PROMPT_INJECTION`):
 * - `block` (default): reject `critical` findings, warn on the rest
 * - `strict`: reject `critical` and `high`, warn on the rest
 * - `warn`: never reject, warn on every finding
 * - `off`: do not scan
 *
 * `high` is not rejected by default because legitimate agent prompts often
 * trip it — "You are now a code reviewer…" matches aidefence's role-switch rule.
 */

import { requireOptional } from './optional.js';

export type InjectionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type InjectionPolicy = 'block' | 'strict' | 'warn' | 'off';

export interface InjectionThreat {
  id: string;
  type: string;
  severity: InjectionSeverity;
  confidence: number;
  description: string;
  match?: string;
}

export interface InjectionScan {
  safe: boolean;
  maxSeverity: InjectionSeverity | null;
  threats: InjectionThreat[];
  /** Which engine produced the result. */
  engine: 'aidefence' | 'builtin' | 'disabled';
  /** What the active policy decided. */
  decision: 'allow' | 'warn' | 'block';
}

interface AidefenceDetector {
  detect(text: string): {
    safe: boolean;
    maxSeverity: InjectionSeverity | null;
    threats: Array<InjectionThreat & Record<string, unknown>>;
  };
}

const SEVERITY_RANK: Record<InjectionSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Built-in fallback: the highest-signal override/exfiltration/jailbreak shapes. */
const BUILTIN_RULES: Array<Omit<InjectionThreat, 'match'> & { pattern: RegExp }> = [
  {
    id: 'AF-001', type: 'instruction_override', severity: 'critical', confidence: 0.95,
    description: 'Attempt to override prior instructions',
    pattern: /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)*(previous|prior|above|earlier|preceding|system)\s+(instructions?|rules?|prompts?|directions?|guidelines?)/i,
  },
  {
    id: 'AF-002', type: 'prompt_exfiltration', severity: 'high', confidence: 0.9,
    description: 'Attempt to reveal the system prompt or hidden instructions',
    pattern: /\b(reveal|print|show|output|repeat|leak)\s+(me\s+)?(your|the)\s+(system\s+prompt|hidden\s+instructions?|initial\s+instructions?)/i,
  },
  {
    id: 'AF-003', type: 'jailbreak', severity: 'high', confidence: 0.9,
    description: 'Known jailbreak persona or mode switch',
    pattern: /\b(do\s+anything\s+now|DAN\s+mode|developer\s+mode\s+(enabled|on)|jailbreak(ed)?\s+mode)\b/i,
  },
  {
    id: 'AF-004', type: 'role_token_injection', severity: 'high', confidence: 0.9,
    description: 'Chat-template role markers embedded in user text',
    pattern: /<\|?(im_start|im_end|system|endoftext)\|?>|\[\/?INST\]/i,
  },
];

let detector: AidefenceDetector | null | undefined;
let detectorOverride: AidefenceDetector | null | undefined;

function getDetector(): AidefenceDetector | null {
  if (detectorOverride !== undefined) return detectorOverride;
  if (detector !== undefined) return detector;
  const mod = requireOptional<{ createInjectionDetector?: () => AidefenceDetector }>('aidefence/dist/detection');
  try {
    detector = mod?.createInjectionDetector ? mod.createInjectionDetector() : null;
  } catch {
    detector = null;
  }
  return detector;
}

export function getInjectionPolicy(): InjectionPolicy {
  const raw = (process.env.AGENTIC_FLOW_PROMPT_INJECTION ?? 'block').toLowerCase();
  return (['block', 'strict', 'warn', 'off'] as const).includes(raw as InjectionPolicy)
    ? (raw as InjectionPolicy)
    : 'block';
}

function builtinDetect(text: string): Pick<InjectionScan, 'threats' | 'maxSeverity'> {
  const threats: InjectionThreat[] = [];
  for (const { pattern, ...rule } of BUILTIN_RULES) {
    const m = pattern.exec(text);
    if (m) threats.push({ ...rule, match: m[0] });
  }
  return { threats, maxSeverity: highest(threats) };
}

function highest(threats: InjectionThreat[]): InjectionSeverity | null {
  let best: InjectionSeverity | null = null;
  for (const t of threats) {
    if (!best || SEVERITY_RANK[t.severity] > SEVERITY_RANK[best]) best = t.severity;
  }
  return best;
}

function decide(maxSeverity: InjectionSeverity | null, policy: InjectionPolicy): InjectionScan['decision'] {
  if (!maxSeverity || policy === 'off') return 'allow';
  if (policy === 'warn') return 'warn';
  const threshold = policy === 'strict' ? SEVERITY_RANK.high : SEVERITY_RANK.critical;
  return SEVERITY_RANK[maxSeverity] >= threshold ? 'block' : 'warn';
}

/** Scan `text` for prompt-injection attempts under the active policy. */
export function scanPromptInjection(text: string, policy: InjectionPolicy = getInjectionPolicy()): InjectionScan {
  if (policy === 'off') {
    return { safe: true, maxSeverity: null, threats: [], engine: 'disabled', decision: 'allow' };
  }
  const engine = getDetector();
  let threats: InjectionThreat[];
  let maxSeverity: InjectionSeverity | null;
  let engineName: InjectionScan['engine'] = 'builtin';
  if (engine) {
    try {
      const r = engine.detect(text);
      threats = r.threats.map((t) => ({
        id: t.id, type: t.type, severity: t.severity, confidence: t.confidence,
        description: t.description, match: t.match,
      }));
      maxSeverity = r.maxSeverity ?? highest(threats);
      engineName = 'aidefence';
    } catch {
      ({ threats, maxSeverity } = builtinDetect(text));
    }
  } else {
    ({ threats, maxSeverity } = builtinDetect(text));
  }
  return { safe: threats.length === 0, maxSeverity, threats, engine: engineName, decision: decide(maxSeverity, policy) };
}

/** Which engine `scanPromptInjection` will use. */
export function promptInjectionEngine(): 'aidefence' | 'builtin' {
  return getDetector() ? 'aidefence' : 'builtin';
}

/** Test hook: `null` forces the built-in engine, `undefined` restores auto-detection. */
export function _setInjectionDetectorForTests(d: AidefenceDetector | null | undefined): void {
  detectorOverride = d;
}
