/**
 * The integrations skill reaches Claude Code (.claude/skills) and Codex
 * (.agents/skills) through `agentic-flow init`, and both ship in the package.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ECOSYSTEM_TOOL_NAMES } from '../../src/mcp/tools/ecosystem-tools.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
let cwd: string;
let savedCwd: string;

beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'af-skills-'));
  savedCwd = process.cwd();
  process.chdir(cwd);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const { handleInitCommand } = await import('../../src/cli/commands/init.js');
  await handleInitCommand(['--force']);
});
afterAll(() => {
  process.chdir(savedCwd);
  vi.restoreAllMocks();
});

describe('ecosystem skills', () => {
  it('init installs the Claude Code and Codex skills', () => {
    expect(existsSync(join(cwd, '.claude', 'skills', 'agentic-flow-ecosystem', 'skill.md'))).toBe(true);
    expect(existsSync(join(cwd, '.agents', 'skills', 'agentic-flow-ecosystem', 'SKILL.md'))).toBe(true);
  });

  it('the Codex skill has name/description frontmatter and names every ecosystem tool', () => {
    const md = readFileSync(join(cwd, '.agents', 'skills', 'agentic-flow-ecosystem', 'SKILL.md'), 'utf8');
    expect(md).toMatch(/^---\nname: agentic-flow-ecosystem\ndescription: .+\n---\n/);
    for (const name of ECOSYSTEM_TOOL_NAMES) expect(md).toContain(name);
  });

  it('ships .agents/skills in the npm package', () => {
    expect(pkg.files).toContain('.agents/skills');
  });
});
