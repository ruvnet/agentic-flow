/**
 * Regression tests for the shell/Node helpers that `agentic-flow init` copies
 * into a project's .claude/ directory.
 *   - statusline.sh interpolated values from .agentic-flow/intelligence.json
 *     into awk program text, so a repo-supplied file ran code via system().
 *   - helpers/github-safe.js built a gh command line with execSync and
 *     template strings, so shell metacharacters in arguments ran commands.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const PKG = resolve(__dirname, '../..');
const STATUSLINE = join(PKG, '.claude/statusline.sh');
const GITHUB_SAFE = join(PKG, '.claude/helpers/github-safe.js');
const hasJq = spawnSync('jq', ['--version']).status === 0;

describe('statusline.sh', () => {
  it.skipIf(!hasJq)('does not execute awk code from intelligence.json', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'af-sl-'));
    const marker = join(cwd, 'pwned');
    mkdirSync(join(cwd, '.agentic-flow'));
    writeFileSync(
      join(cwd, '.agentic-flow', 'intelligence.json'),
      JSON.stringify({
        config: {
          learningRate: `0; system("touch ${marker}")`,
          epsilon: `1) + system("touch ${marker}") + (1`,
        },
      }),
    );
    const out = execFileSync('bash', [STATUSLINE], { cwd, encoding: 'utf8' });
    expect(existsSync(marker)).toBe(false);
    // Invalid values fall back to the 0.1 default
    expect(out).toContain('lr:10%');
    expect(out).toContain('ε:10%');
  });

  it.skipIf(!hasJq)('still renders numeric values', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'af-sl-'));
    mkdirSync(join(cwd, '.agentic-flow'));
    writeFileSync(
      join(cwd, '.agentic-flow', 'intelligence.json'),
      JSON.stringify({ config: { learningRate: 0.25, epsilon: 0.05 } }),
    );
    const out = execFileSync('bash', [STATUSLINE], { cwd, encoding: 'utf8' });
    expect(out).toContain('lr:25%');
    expect(out).toContain('ε:5%');
  });
});

describe('github-safe.js', () => {
  function fakeGh() {
    const bin = mkdtempSync(join(tmpdir(), 'af-gh-'));
    const gh = join(bin, 'gh');
    // Prints each argument on its own line so the test sees exactly what gh got
    writeFileSync(gh, '#!/bin/sh\nfor a in "$@"; do printf "ARG:%s\\n" "$a"; done\n');
    chmodSync(gh, 0o755);
    return bin;
  }

  function run(args: string[]) {
    const bin = fakeGh();
    return spawnSync(process.execPath, [GITHUB_SAFE, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  }

  it('passes shell metacharacters to gh verbatim on the generic path', () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'af-gh-out-')), 'pwned');
    const evil = `1; touch ${marker}`;
    const res = run(['issue', 'view', evil]);
    expect(existsSync(marker)).toBe(false);
    expect(res.stdout).toContain(`ARG:${evil}`);
  });

  it('passes shell metacharacters verbatim on the --body-file path', () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'af-gh-out-')), 'pwned');
    const evilTitle = `$(touch ${marker})`;
    const res = run(['issue', 'create', '--title', evilTitle, '--body', 'hello']);
    expect(existsSync(marker)).toBe(false);
    expect(res.stdout).toContain(`ARG:${evilTitle}`);
    expect(res.stdout).toContain('ARG:--body-file');
  });
});
