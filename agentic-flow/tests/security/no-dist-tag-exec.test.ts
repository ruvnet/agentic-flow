/**
 * Regression test: shipped files that run agentic-flow must name an exact
 * version, never a dist-tag. `.claude/statusline.mjs` ran
 * `npx agentic-flow@alpha mcp status` on every refresh, which is the
 * deprecated March 3.0.0-alpha line; `hooks init` wrote unversioned
 * `npx agentic-flow` hooks, which resolve to whatever @latest is that day.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = fileURLToPath(new URL('../../', import.meta.url));
const { files: published } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

// Code that runs, plus the instructions that agents follow in .claude/.
const EXECUTED = /\.(m?[jt]s|cjs|sh|json)$|Dockerfile$/;
const isExecuted = (rel: string) =>
  EXECUTED.test(rel) || (rel.startsWith('.claude/') && rel.endsWith('.md'));

// Shipped roots that can hold executed files; dist is built from src.
const ROOTS = ['.claude', 'scripts', 'validation', 'wasm', 'docs', 'src'].filter((r) =>
  published.some((p: string) => p === r || p === 'dist') || r === 'src',
);
const SKIP = new Set(['node_modules', 'archived', 'archive']);
const IGNORED = new Set(['.claude/settings.json', '.claude/settings-backup.json', '.claude/settings-optimized.json',
  '.claude/settings-simple.json', '.claude/settings.local.json', '.claude/mcp.json']); // excluded from the package

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(pkgDir, full));
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(pkgDir, r))).filter((f) => isExecuted(f) && !IGNORED.has(f));

const DIST_TAG = /agentic-flow@(alpha|latest|beta|next|v3alpha)\b/;
// `npx agentic-flow <cmd>` / `npx -y agentic-flow` with no version.
const UNVERSIONED_NPX = /npx\s+(?:-y\s+|--yes\s+)?agentic-flow(?=\s|['"`]|$)/m;

describe('executed files pin agentic-flow to a version', () => {
  it('scans a meaningful set of files', () => {
    expect(files).toContain('.claude/statusline.mjs');
    expect(files).toContain('src/cli/commands/hooks.ts');
    expect(files.length).toBeGreaterThan(100);
  });

  it('no executed file runs agentic-flow through a dist-tag', () => {
    const hits = files.filter((f) => DIST_TAG.test(readFileSync(join(pkgDir, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('statusline, scripts, .claude instructions and hook templates never npx an unversioned agentic-flow', () => {
    const hits = files
      .filter((f) => !f.startsWith('src/') || f === 'src/cli/commands/hooks.ts')
      .filter((f) => UNVERSIONED_NPX.test(readFileSync(join(pkgDir, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('hooks init writes hook commands pinned to the installed version', () => {
    const src = readFileSync(join(pkgDir, 'src/cli/commands/hooks.ts'), 'utf8');
    const commands = [...src.matchAll(/command: [`'"](npx [^`'"]+)/g)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(5);
    for (const c of commands) expect(c).toMatch(/^npx \$\{spec\} /);
  });
});
