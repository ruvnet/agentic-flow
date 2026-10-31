/**
 * Regression test for the settings.json that `agentic-flow init` writes.
 *   - Hooks and the MCP server ran `npx agentic-flow@alpha`, i.e. whatever the
 *     alpha tag pointed at on each invocation, not the installed release.
 *   - permissions.allow pre-approved Bash(npx:*), Bash(npm run:*) and every
 *     tool of the agentic-flow / claude-flow MCP servers.
 *   - The agentic-flow MCP server was registered as "claude-flow", colliding
 *     with ruflo's server of that name.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const version = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version;
let settings: any;
let claudeMd: string;
let savedCwd: string;

beforeAll(async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'af-init-'));
  savedCwd = process.cwd();
  process.chdir(cwd);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const { handleInitCommand } = await import('../../src/cli/commands/init.js');
  await handleInitCommand(['--force']);
  settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'));
  claudeMd = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
});

afterAll(() => {
  process.chdir(savedCwd);
  vi.restoreAllMocks();
});

describe('init settings.json', () => {
  it('pins hooks and the MCP server to the installed version', () => {
    const json = JSON.stringify(settings);
    expect(json).not.toContain('@alpha');
    const hookCommands = Object.values(settings.hooks)
      .flat()
      .flatMap((entry: any) => entry.hooks.map((h: any) => h.command));
    expect(hookCommands.length).toBeGreaterThan(0);
    for (const command of hookCommands) {
      expect(command).toMatch(new RegExp(`^npx agentic-flow@${version.replace(/\./g, '\\.')} `));
    }
    expect(settings.mcpServers['agentic-flow'].args).toEqual([`agentic-flow@${version}`, 'mcp', 'start']);
  });

  it('registers the server as agentic-flow, not claude-flow', () => {
    expect(Object.keys(settings.mcpServers)).toEqual(['agentic-flow']);
  });

  it('does not pre-approve npx, npm run or whole MCP servers', () => {
    const allow: string[] = settings.permissions.allow;
    for (const entry of ['Bash(npx:*)', 'Bash(npm run:*)', 'mcp__agentic-flow', 'mcp__claude-flow', 'mcp__ruv-swarm']) {
      expect(allow).not.toContain(entry);
    }
  });

  it('pins the commands shown in the generated CLAUDE.md', () => {
    expect(claudeMd).not.toContain('agentic-flow@alpha');
    expect(claudeMd).toContain(`npx agentic-flow@${version} mcp start`);
  });
});
