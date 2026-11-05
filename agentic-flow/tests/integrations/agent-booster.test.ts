/**
 * agent-booster integration: the in-process library backs the
 * agent_booster_edit_file handler (agent-booster-tools.ts) and the MCP stdio
 * server's edit tools (applyAgentBoosterEdit), with no npx download.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyAgentBoosterEdit, getAgentBoosterLibrary } from '../../src/integrations/agent-booster.js';
import { agentBoosterMCPHandlers } from '../../src/mcp/tools/agent-booster-tools.js';

// The handler only edits files inside the working directory.
const dir = mkdtempSync(join(process.cwd(), '.tmp-booster-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('agent-booster', () => {
  it('loads the library in-process', async () => {
    expect(await getAgentBoosterLibrary()).not.toBeNull();
  });

  it('applies an edit through the library, not npx', async () => {
    const r = await applyAgentBoosterEdit('const x = 1;', 'const x: number = 1;', 'typescript');
    expect(r.via).toBe('library');
    expect(r.success).toBe(true);
    expect(r.output).toContain('const x: number = 1;');
  });

  it('agent_booster_edit_file edits a real file', async () => {
    const file = join(dir, 'add.ts');
    writeFileSync(file, 'function add(a, b) { return a + b; }\n');
    const r: any = await agentBoosterMCPHandlers.agent_booster_edit_file({
      target_filepath: file,
      instructions: 'I will add types',
      code_edit: 'function add(a: number, b: number): number { return a + b; }',
      language: 'typescript',
    });
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('a: number, b: number');
  });
});
