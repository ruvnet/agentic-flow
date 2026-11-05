/**
 * Agent Booster edits: in-process library first, `npx` CLI as the fallback.
 *
 * `agent-booster` is an optionalDependency. When it is installed (the default)
 * edits run in-process through its WASM engine. When it is not, we fall back
 * to the pinned CLI via `npx --yes agent-booster@0.2.2 apply`, which is what
 * the MCP server always did before (and which downloads on first use).
 */

import { execFileSync } from 'node:child_process';
import { importOptional } from './optional.js';

export const AGENT_BOOSTER_CLI = 'agent-booster@0.2.2';

export interface BoosterEditResult {
  output: string;
  success: boolean;
  latency: number;
  confidence: number;
  strategy: string;
  /** How the edit was applied. */
  via: 'library' | 'npx';
}

type BoosterInstance = {
  apply(input: { code: string; edit: string; language: string }): Promise<Omit<BoosterEditResult, 'via'>>;
};

let instance: Promise<BoosterInstance | null> | null = null;

/** The in-process Agent Booster, or null when the optional package is absent. */
export function getAgentBoosterLibrary(): Promise<BoosterInstance | null> {
  if (!instance) {
    instance = importOptional<any>('agent-booster').then((mod) => {
      const Ctor = mod?.AgentBooster ?? mod?.default?.AgentBooster ?? mod?.default;
      if (typeof Ctor !== 'function') return null;
      return new Ctor({ confidenceThreshold: 0.5, maxChunks: 100 }) as BoosterInstance;
    });
  }
  return instance;
}

/** Apply `edit` to `code`. Never shells out when the library is installed. */
export async function applyAgentBoosterEdit(
  code: string,
  edit: string,
  language: string,
  options: { npxTimeoutMs?: number } = {},
): Promise<BoosterEditResult> {
  const lib = await getAgentBoosterLibrary();
  if (lib) {
    const r = await lib.apply({ code, edit, language });
    return { ...r, via: 'library' };
  }
  const stdout = execFileSync('npx', ['--yes', AGENT_BOOSTER_CLI, 'apply', '--language', language], {
    shell: false,
    encoding: 'utf-8',
    input: JSON.stringify({ code, edit }),
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.npxTimeoutMs ?? 30000,
  });
  return { ...JSON.parse(stdout), via: 'npx' };
}

/** Test hook. */
export function _resetAgentBoosterForTests(): void {
  instance = null;
}
