/**
 * Regression tests: MCP tools and the agent CLI joined caller-supplied names,
 * categories and file paths into filesystem paths without validation.
 *   - agent/command creation (standalone-stdio, stdio-full, http-sse,
 *     fastmcp agent_add, `agentic-flow agent create`) accepted `../` in the
 *     name or category and wrote outside .claude/.
 *   - agent_booster_edit_file / batch_edit / parse_markdown read and wrote
 *     any path, including outside the working directory.
 *
 * The MCP servers start at import, so fastmcp is replaced by a stub that
 * records the registered tools; each tool's execute() is then called directly.
 * `npx` is a fake on PATH that reports a successful booster edit.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertCategoryPath, resolveInsideCwd, toAgentSlug } from '../../src/utils/path-safety.js';

const servers = vi.hoisted(() => new Map<string, Map<string, any>>());
vi.mock('fastmcp', () => ({
  FastMCP: class {
    tools = new Map<string, any>();
    constructor(opts: { name: string }) {
      servers.set(opts.name, this.tools);
    }
    addTool(tool: any) {
      this.tools.set(tool.name, tool);
    }
    start() {
      return Promise.resolve();
    }
    stop() {
      return Promise.resolve();
    }
  },
}));

const root = mkdtempSync(join(tmpdir(), 'af-trav-'));
const ws = join(root, 'workspace');
const bin = join(root, 'bin');
const npxLog = join(root, 'npx.log');
let savedCwd: string;
let savedPath: string | undefined;
let savedProfile: string | undefined;

function tool(server: string, name: string) {
  const t = servers.get(server)?.get(name);
  if (!t) throw new Error(`tool ${name} not registered on ${server}`);
  return t;
}

async function call(server: string, name: string, args: Record<string, unknown>) {
  try {
    return await tool(server, name).execute(args, {});
  } catch (error) {
    return error;
  }
}

function outside(name: string, content = 'ORIGINAL') {
  const p = join(root, name);
  writeFileSync(p, content);
  return p;
}

beforeAll(async () => {
  mkdirSync(ws);
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'npx'),
    `#!/bin/sh\necho "$@" >> '${npxLog}'\ncat >/dev/null\necho '{"success":true,"confidence":1,"output":"PWNED","latency":1}'\n`,
  );
  chmodSync(join(bin, 'npx'), 0o755);
  savedCwd = process.cwd();
  savedPath = process.env.PATH;
  savedProfile = process.env.AGENTIC_FLOW_MCP_PROFILE;
  process.chdir(ws);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.AGENTIC_FLOW_MCP_PROFILE = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await import('../../src/mcp/standalone-stdio.js');
  await import('../../src/mcp/fastmcp/servers/stdio-full.js');
  await import('../../src/mcp/fastmcp/servers/http-sse.js');
});

afterAll(() => {
  process.chdir(savedCwd);
  process.env.PATH = savedPath;
  if (savedProfile === undefined) delete process.env.AGENTIC_FLOW_MCP_PROFILE;
  else process.env.AGENTIC_FLOW_MCP_PROFILE = savedProfile;
  vi.restoreAllMocks();
});

describe('agent booster tools stay inside the working directory', () => {
  it('agent_booster_edit_file refuses ../ paths', async () => {
    const target = outside('edit.txt');
    await call('agentic-flow', 'agent_booster_edit_file', {
      target_filepath: '../edit.txt', instructions: 'x', code_edit: 'y',
    });
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL');
  });

  it('agent_booster_edit_file refuses absolute paths outside cwd', async () => {
    const target = outside('abs.txt');
    await call('agentic-flow', 'agent_booster_edit_file', {
      target_filepath: target, instructions: 'x', code_edit: 'y',
    });
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL');
  });

  it('agent_booster_batch_edit writes nothing when any path escapes', async () => {
    const target = outside('batch.txt');
    writeFileSync(join(ws, 'inside.txt'), 'ORIGINAL');
    await call('agentic-flow', 'agent_booster_batch_edit', {
      edits: [
        { target_filepath: 'inside.txt', instructions: 'x', code_edit: 'y' },
        { target_filepath: '../batch.txt', instructions: 'x', code_edit: 'y' },
      ],
    });
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(ws, 'inside.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it('agent_booster_parse_markdown refuses paths outside cwd', async () => {
    const target = outside('md.txt');
    await call('agentic-flow', 'agent_booster_parse_markdown', {
      markdown: '```js filepath=../md.txt instruction=overwrite\nconst a = 1;\n```',
    });
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL');
  });

  it('still edits a file inside cwd', async () => {
    writeFileSync(join(ws, 'ok.js'), 'const a = 0;');
    await call('agentic-flow', 'agent_booster_edit_file', {
      target_filepath: 'ok.js', instructions: 'x', code_edit: 'y',
    });
    expect(readFileSync(join(ws, 'ok.js'), 'utf8')).toBe('PWNED'); // fake booster output
  });
});

describe('agent and command creation stays under .claude/', () => {
  const escaped = () => existsSync(join(root, 'evil')) || existsSync(join(root, 'evil.md'));

  it('standalone agentic_flow_create_agent rejects a traversing category before running the CLI', async () => {
    writeFileSync(npxLog, '');
    const result = await call('agentic-flow', 'agentic_flow_create_agent', {
      name: 'x', description: 'd', systemPrompt: 'p', category: '../../../evil',
    });
    expect(result).toBeInstanceOf(Error);
    expect(readFileSync(npxLog, 'utf8')).not.toContain('agent create');
  });

  it('http-sse agentic_flow_create_agent rejects ../ in name and category', async () => {
    await call('agentic-flow-http', 'agentic_flow_create_agent', {
      name: '../../../evil', description: 'd', systemPrompt: 'p',
    });
    await call('agentic-flow-http', 'agentic_flow_create_agent', {
      name: 'x', description: 'd', systemPrompt: 'p', category: '../../../evil',
    });
    expect(escaped()).toBe(false);
  });

  it('stdio-full agent_add rejects ../ in name and category', async () => {
    await call('fastmcp-stdio-full', 'agent_add', {
      name: '../../../evil', description: 'd', systemPrompt: 'p',
    });
    await call('fastmcp-stdio-full', 'agent_add', {
      name: 'x', description: 'd', systemPrompt: 'p', category: '../../../evil',
    });
    expect(escaped()).toBe(false);
  });

  it('stdio-full command_add rejects ../ in the name', async () => {
    await call('fastmcp-stdio-full', 'command_add', {
      name: '../../evil', description: 'd', usage: 'u',
    });
    expect(escaped()).toBe(false);
  });

  it('fastmcp agent_add tool rejects a traversing category', async () => {
    const { addAgentTool } = await import('../../src/mcp/fastmcp/tools/agent/add-agent.js');
    await addAgentTool.execute(
      { name: 'x', description: 'd', systemPrompt: 'p', category: '../../../evil' } as any,
      {} as any,
    ).catch(() => undefined);
    expect(escaped()).toBe(false);
  });

  it('AgentManager.create rejects a traversing category', async () => {
    const { AgentManager } = await import('../../src/cli/agent-manager.js');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await new AgentManager()
      .create({ name: 'x', description: 'd', systemPrompt: 'p', category: '../../../evil' })
      .catch(() => undefined);
    expect(escaped()).toBe(false);
  });

  it('valid nested categories still work', async () => {
    await call('fastmcp-stdio-full', 'agent_add', {
      name: 'good-agent', description: 'd', systemPrompt: 'p', category: 'team/backend',
    });
    expect(existsSync(join(ws, '.claude/agents/team/backend/good-agent.md'))).toBe(true);
  });
});

describe('path-safety helpers', () => {
  it('validates categories segment by segment', () => {
    expect(assertCategoryPath('team/backend')).toEqual(['team', 'backend']);
    for (const bad of ['..', 'a/../b', '/abs', 'a//b', 'A', 'a\\b', '']) {
      expect(() => assertCategoryPath(bad)).toThrow();
    }
  });

  it('normalises agent names and rejects separators', () => {
    expect(toAgentSlug('My Agent')).toBe('my-agent');
    expect(() => toAgentSlug('../x')).toThrow();
    expect(() => toAgentSlug('a/b')).toThrow();
  });

  it('follows symlinks when checking containment', async () => {
    const { symlinkSync } = await import('fs');
    const base = mkdtempSync(join(tmpdir(), 'af-link-'));
    const out = mkdtempSync(join(tmpdir(), 'af-out-'));
    symlinkSync(out, join(base, 'link'));
    expect(() => resolveInsideCwd('link/file.txt', base)).toThrow(/outside/);
    expect(resolveInsideCwd('sub/new.txt', base)).toContain(base.split('/').pop()!);
  });
});
