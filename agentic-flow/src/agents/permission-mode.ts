// Permission policy for agents run through the Claude Agent SDK.
//
// The agent's task can come from an MCP caller (agentic_flow_agent), so the
// default must not hand it a shell, the filesystem and the network without a
// prompt. In the SDK, `allowedTools` are auto-approved, so switching
// permissionMode alone is not enough: the default also narrows allowedTools to
// read-only tools. Anything else is denied in a headless run.
import { logger } from '../utils/logger.js';

export const BYPASS_PERMISSIONS_ENV = 'AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS';

/** Every built-in tool, auto-approved only when bypass is opted into. */
export const FULL_ACCESS_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'TodoWrite',
];

/** Tools that cannot change the machine or reach the network. */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'TodoWrite'];

export interface AgentPermissions {
  permissionMode: 'default' | 'bypassPermissions';
  allowedTools: string[];
  bypass: boolean;
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Resolve the SDK permission settings. Bypass needs an explicit
 * AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS=1 and logs a warning when used.
 */
export function resolveAgentPermissions(env: NodeJS.ProcessEnv = process.env): AgentPermissions {
  if (isTruthy(env[BYPASS_PERMISSIONS_ENV])) {
    const warning =
      `${BYPASS_PERMISSIONS_ENV} is set: the agent runs with bypassPermissions and may use ` +
      'Bash, Write, Edit and WebFetch without confirmation. Only use this in a sandbox.';
    logger.warn(warning);
    console.error(`⚠️  ${warning}`);
    return { permissionMode: 'bypassPermissions', allowedTools: [...FULL_ACCESS_TOOLS], bypass: true };
  }
  return { permissionMode: 'default', allowedTools: [...READ_ONLY_TOOLS], bypass: false };
}
