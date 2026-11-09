// Real-import checks on the package surface (no mocks): run with `npm run test:package`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

test('package entry imports by name and reports the manifest version', async () => {
  const mod = await import('research-swarm');
  assert.equal(mod.VERSION, pkg.version);
  for (const name of ['initDatabase', 'createResearchJob', 'listJobs', 'searchSimilarVectors']) {
    assert.equal(typeof mod[name], 'function', name);
  }
});

test('CLI --version matches the manifest', () => {
  const out = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(out, pkg.version);
});

test('agentic-flow peer range is capped below the next major', () => {
  const range = pkg.peerDependencies['agentic-flow'];
  assert.match(range, /<\s*4(\.0\.0)?\b/);
});

test('no shipped source imports through a relative node_modules path', async () => {
  // '../node_modules/<dep>/...' only resolves when the dep is nested inside
  // this package; npm hoists peers, so it breaks `import('research-swarm')`.
  const { readdirSync } = await import('node:fs');
  const offenders = [];
  for (const dir of ['lib', 'bin']) {
    const root = new URL(`../${dir}/`, import.meta.url);
    for (const f of readdirSync(root, { recursive: true })) {
      if (!String(f).endsWith('.js')) continue;
      const src = readFileSync(new URL(String(f), root), 'utf8');
      if (/(?:from\s+|import\s*\(\s*)['"](?:\.\.?\/)+node_modules\//.test(src)) offenders.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(offenders, []);
});
