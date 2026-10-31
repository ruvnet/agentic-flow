/**
 * The SONA services must import as ES modules from the built package, with or
 * without the optional @ruvector/sona dependency. Without it, using an engine
 * throws a clear "not available" error instead of failing at import time.
 *
 * Each case runs in a child node process against dist/. "Not installed" is
 * simulated with a module resolve hook that rejects @ruvector/sona.
 * Requires `npm run build` first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const pkgRoot = fileURLToPath(new URL('../..', import.meta.url));
const dist = (rel: string) => pathToFileURL(join(pkgRoot, 'dist', rel)).href;

const MODULES = [
  'services/sona-service.js',
  'services/sona-agent-training.js',
  'services/sona-agentdb-integration.js',
  'mcp/tools/sona-tools.js',
];

const probe = `
const out = { imported: [], errors: {} };
const urls = ${JSON.stringify(Object.fromEntries(MODULES.map(rel => [rel, dist(rel)])))};
for (const [rel, url] of Object.entries(urls)) {
  try {
    await import(url);
    out.imported.push(rel);
  } catch (e) {
    out.errors[rel] = e.message;
  }
}
const svc = await import(${JSON.stringify(dist('services/sona-service.js'))}).catch(() => null);
if (svc) {
  try {
    const stats = svc.sonaService.getStats();
    out.stats = { totalTrajectories: stats.totalTrajectories };
    out.singleton = svc.sonaServices.balanced === svc.sonaServices.balanced;
    out.isInstance = svc.sonaService instanceof svc.SONAService;
  } catch (e) {
    out.useError = { name: e.name, message: e.message };
  }
}
process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n');
`;

const resolveHook = `
export async function resolve(specifier, context, next) {
  if (specifier === '@ruvector/sona' || specifier.startsWith('@ruvector/sona/')) {
    const error = new Error("Cannot find package '" + specifier + "'");
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  }
  return next(specifier, context);
}
`;

function run(withoutSona: boolean): any {
  const dir = mkdtempSync(join(tmpdir(), 'sona-import-'));
  writeFileSync(join(dir, 'probe.mjs'), probe);
  writeFileSync(join(dir, 'hooks.mjs'), resolveHook);
  writeFileSync(
    join(dir, 'register.mjs'),
    `import { register } from 'node:module';\nregister('./hooks.mjs', import.meta.url);\n`,
  );

  const args = withoutSona ? ['--import', './register.mjs', 'probe.mjs'] : ['probe.mjs'];
  const child = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const line = child.stdout.split('\n').find(l => l.startsWith('RESULT '));
  if (!line) throw new Error(`no result; status=${child.status} stderr=${child.stderr}`);
  return JSON.parse(line.slice('RESULT '.length));
}

describe('SONA services import as ES modules', () => {
  beforeAll(() => {
    for (const rel of MODULES) {
      if (!existsSync(join(pkgRoot, 'dist', rel))) {
        throw new Error(`dist/${rel} missing: run \`npm run build\` before this suite`);
      }
    }
  });

  it('imports without @ruvector/sona and fails clearly only on use', () => {
    const result = run(true);

    expect(result.errors).toEqual({});
    expect(result.imported).toEqual(MODULES);
    expect(result.useError?.name).toBe('SonaUnavailableError');
    expect(result.useError?.message).toMatch(/@ruvector\/sona is not available/);
  }, 90_000);

  it('works with @ruvector/sona installed, creating engines lazily', () => {
    const result = run(false);

    expect(result.errors).toEqual({});
    expect(result.useError).toBeUndefined();
    expect(result.stats).toEqual({ totalTrajectories: 0 });
    expect(result.singleton).toBe(true);
    expect(result.isInstance).toBe(true);
  }, 90_000);
});
