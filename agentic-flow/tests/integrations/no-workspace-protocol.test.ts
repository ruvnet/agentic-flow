/**
 * npm cannot resolve `workspace:*` for users, so no publishable manifest in
 * the repo may carry it (examples that use it must be `private`).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'target', 'pkg']);

function manifests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) manifests(join(dir, entry.name), out);
    } else if (entry.name === 'package.json') {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('package manifests', () => {
  it('no publishable package.json uses the workspace: protocol', () => {
    const offenders: string[] = [];
    for (const file of manifests(repoRoot)) {
      let pkg: any;
      try {
        pkg = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      if (pkg.private === true) continue;
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
        for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
          if (typeof spec === 'string' && spec.startsWith('workspace:')) {
            offenders.push(`${relative(repoRoot, file)} ${field}.${name}=${spec}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
