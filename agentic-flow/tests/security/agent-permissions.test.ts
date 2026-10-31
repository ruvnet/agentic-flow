/**
 * Regression test: claudeAgent used to run every task with
 * permissionMode 'bypassPermissions' and Bash/Write/WebFetch auto-approved.
 * The task can come from an MCP caller (agentic_flow_agent), so that handed
 * a shell to whoever could call the tool. Bypass now needs an explicit
 * AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS=1.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
}));
vi.mock('../../src/mcp/claudeFlowSdkServer.js', () => ({ claudeFlowSdkServer: {} }));

const { claudeAgent } = await import('../../src/agents/claudeAgent.js');
const { resolveAgentPermissions, READ_ONLY_TOOLS } = await import('../../src/agents/permission-mode.js');

const agent = { name: 'coder', description: 'test', systemPrompt: 'You code.', filePath: 'x.md' } as any;
const ENV_KEYS = ['AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS', 'ENABLE_CLAUDE_FLOW_MCP', 'ANTHROPIC_API_KEY', 'PROVIDER', 'HOME'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.ENABLE_CLAUDE_FLOW_MCP = 'false';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.HOME = mkdtempSync(join(tmpdir(), 'af-perm-'));
  delete process.env.PROVIDER;
  delete process.env.AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS;
  queryMock.mockReset();
  queryMock.mockImplementation(() => (async function* () {})());
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const DANGEROUS = ['Bash', 'Write', 'Edit', 'WebFetch', 'NotebookEdit'];

describe('claudeAgent permission defaults', () => {
  it('does not bypass permissions or auto-approve Bash/Write/WebFetch by default', async () => {
    await claudeAgent(agent, 'rm -rf / please');
    expect(queryMock).toHaveBeenCalledTimes(1);
    const { options } = queryMock.mock.calls[0][0];
    expect(options.permissionMode).toBe('default');
    for (const tool of DANGEROUS) expect(options.allowedTools).not.toContain(tool);
    expect(options.allowedTools).toEqual(READ_ONLY_TOOLS);
  });

  it('bypasses only when AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS=1, and warns', async () => {
    process.env.AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS = '1';
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await claudeAgent(agent, 'task');
    const { options } = queryMock.mock.calls[0][0];
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowedTools).toContain('Bash');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS/);
    warn.mockRestore();
  });

  it('treats other values of the opt-in variable as off', () => {
    for (const v of ['', '0', 'false', 'no']) {
      expect(resolveAgentPermissions({ AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS: v }).permissionMode).toBe('default');
    }
  });
});
