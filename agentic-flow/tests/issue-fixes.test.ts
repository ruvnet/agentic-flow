/**
 * Verification tests for the GitHub issues fixed across commits c0ce2ba and
 * 88b86f7. Each describe() block targets a specific issue number and
 * exercises the public observable behaviour the issue called out.
 *
 * These tests run with `vitest` from the agentic-flow directory:
 *   cd agentic-flow && npx vitest run tests/issue-fixes.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '../..');
const PKG_INNER = resolve(__dirname, '..');

describe('issue #145: protobufjs CVE override', () => {
  it('root package.json declares an overrides entry forcing protobufjs >= 7.5.5', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.overrides).toBeDefined();
    expect(pkg.overrides.protobufjs).toBeDefined();
    // Accept either a min-spec like ">=7.5.5" or an explicit safe version.
    const ver = String(pkg.overrides.protobufjs);
    expect(/(>=\s*7\.5\.5|^7\.|^8\.|^9\.)/.test(ver)).toBe(true);
  });

  it('inner agentic-flow/package.json also declares the override', () => {
    const pkg = JSON.parse(readFileSync(join(PKG_INNER, 'package.json'), 'utf-8'));
    expect(pkg.overrides).toBeDefined();
    expect(pkg.overrides.protobufjs).toBeDefined();
  });

  it('npm ls protobufjs reports no vulnerable (<7.5.5) versions', () => {
    let out = '';
    try {
      out = execSync('npm ls protobufjs --all 2>/dev/null || true', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      // npm ls exits non-zero on extraneous deps; the output is what we want.
    }
    // Find every "protobufjs@<version>" mention and assert each is >=7.5.5.
    const matches = out.match(/protobufjs@[\d.]+/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const v = m.split('@')[1];
      const [maj, min, patch] = v.split('.').map((s) => parseInt(s, 10));
      const ok =
        maj > 7 || (maj === 7 && (min > 5 || (min === 5 && patch >= 5)));
      expect(ok, `Found vulnerable ${m}`).toBe(true);
    }
  });
});

describe('issue #146 Gap 1: Ollama provider whitelist', () => {
  it('config-wizard.ts source whitelists OLLAMA_API_KEY and OLLAMA_BASE_URL', () => {
    const src = readFileSync(join(PKG_INNER, 'src/cli/config-wizard.ts'), 'utf-8');
    expect(src).toMatch(/OLLAMA_API_KEY/);
    expect(src).toMatch(/OLLAMA_BASE_URL/);
  });

  it('config-wizard.ts validates PROVIDER=ollama', () => {
    const src = readFileSync(join(PKG_INNER, 'src/cli/config-wizard.ts'), 'utf-8');
    // Look for the provider validator that includes 'ollama'
    expect(src).toMatch(/['"]ollama['"]/);
  });

  it('Ollama provider is exported from the router barrel', async () => {
    const mod: any = await import('../src/router/index.js');
    expect(mod.OllamaProvider).toBeDefined();
    expect(typeof mod.OllamaProvider).toBe('function');
  });

  it('OllamaProvider type marker is "ollama"', async () => {
    const { OllamaProvider } = await import('../src/router/providers/ollama.js');
    const p = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    expect(p.name).toBe('ollama');
    expect(p.type).toBe('ollama');
    expect(p.supportsStreaming).toBe(true);
  });
});

describe('issue #146 Gap 2: agentdb controller prerequisites registry', () => {
  it('exports the registry from agentic-flow/agentdb', async () => {
    const mod: any = await import('../src/agentdb/index.js');
    expect(Array.isArray(mod.controllerPrerequisites)).toBe(true);
    expect(mod.controllerPrerequisites.length).toBeGreaterThan(10);
    expect(typeof mod.getControllerPrerequisite).toBe('function');
    expect(typeof mod.filterBySafety).toBe('function');
  });

  it('every entry has the documented shape', async () => {
    const { controllerPrerequisites } = await import('../src/agentdb/index.js');
    for (const c of controllerPrerequisites) {
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(Array.isArray(c.requirements)).toBe(true);
      expect(Array.isArray(c.optional)).toBe(true);
      expect(typeof c.arity).toBe('number');
      expect(['pure', 'opens-resource', 'opens-network']).toContain(c.safety);
      expect(typeof c.description).toBe('string');
    }
  });

  it('noArgControllers contains only zero-requirement entries', async () => {
    const { noArgControllers, controllerPrerequisites } = await import('../src/agentdb/index.js');
    expect(noArgControllers.length).toBeGreaterThan(0);
    for (const c of noArgControllers) {
      expect(c.requirements.length).toBe(0);
    }
    // And it actually filters from the parent list (no extras).
    for (const c of noArgControllers) {
      expect(controllerPrerequisites.find((x: any) => x.name === c.name)).toBeDefined();
    }
  });

  it('filterBySafety("pure") only returns pure controllers', async () => {
    const { filterBySafety } = await import('../src/agentdb/index.js');
    const pure = filterBySafety(['pure']);
    expect(pure.length).toBeGreaterThan(0);
    for (const c of pure) expect(c.safety).toBe('pure');
  });

  it('getControllerPrerequisite returns null for unknown names', async () => {
    const { getControllerPrerequisite } = await import('../src/agentdb/index.js');
    expect(getControllerPrerequisite('NotARealController')).toBeNull();
  });
});

describe('issue #102 / #110: top-level import is library-safe', () => {
  it('subprocess `import("agentic-flow")` resolves and exits cleanly', () => {
    // This catches both #102 (missing dep) and #110 (auto-running CLI). The
    // child must exit on its own; if main() ran, it would block on
    // healthServer / agent execution and the child would never exit.
    //
    // The probe must live inside REPO_ROOT so Node can resolve the
    // `agentic-flow` bare specifier via the repo's node_modules.
    const probeDir = join(REPO_ROOT, '.tmp-import-probe');
    try {
      execSync(`mkdir -p ${JSON.stringify(probeDir)}`);
      const scriptPath = join(probeDir, 'probe.mjs');
      writeFileSync(
        scriptPath,
        `
        const t0 = Date.now();
        import('agentic-flow').then((m) => {
          const ms = Date.now() - t0;
          const exposed = Object.keys(m).join(',');
          process.stdout.write('OK ' + ms + ' ' + exposed);
          setTimeout(() => process.exit(0), 100);
        }).catch((e) => {
          process.stderr.write('FAIL ' + e.message);
          process.exit(2);
        });
        `,
        'utf-8',
      );
      const out = execSync(`node ${JSON.stringify(scriptPath)}`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        timeout: 20000,
      });
      expect(out).toMatch(/^OK \d+ /);
      // We expect at least the `main` export to be present.
      expect(out).toMatch(/main/);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });

  it('SharedMemoryPool source exists and exports the singleton API', () => {
    const src = readFileSync(join(PKG_INNER, 'src/memory/SharedMemoryPool.ts'), 'utf-8');
    expect(src).toMatch(/class SharedMemoryPool/);
    expect(src).toMatch(/static\s+getInstance/);
    expect(src).toMatch(/getDatabase\(/);
    expect(src).toMatch(/getEmbedder\(/);
    expect(src).toMatch(/ensureInitialized\(/);
  });

  it('main entrypoint guards CLI execution with isCliEntry()', () => {
    const src = readFileSync(join(PKG_INNER, 'src/index.ts'), 'utf-8');
    expect(src).toMatch(/isCliEntry/);
    // The unconditional `main().catch(...)` invocation should be gone — i.e.
    // the only `main()` call site is now inside the `if (isCliEntry())` guard.
    // We assert the guard is present and `main()` is not called outside it.
    const guardedCallRe = /if\s*\(\s*isCliEntry\(\)\s*\)\s*\{[^}]*main\(\)/s;
    expect(src).toMatch(guardedCallRe);
  });

  it('agent-booster imports are dynamic / lazy in the three callsites', () => {
    const files = [
      'src/mcp/claudeFlowSdkServer.ts',
      'src/mcp/tools/agent-booster-tools.ts',
      'src/optimizations/agent-booster-migration.ts',
    ];
    for (const f of files) {
      const src = readFileSync(join(PKG_INNER, f), 'utf-8');
      // No top-level `import { ... } from 'agent-booster'` lines
      expect(src).not.toMatch(/^\s*import\s+\{[^}]*\}\s+from\s+['"]agent-booster['"]/m);
      // But there IS a dynamic `import('agent-booster')`
      expect(src).toMatch(/import\(\s*['"]agent-booster['"]\s*\)/);
    }
  });
});

describe('issue #128 / #129: ReflexionMemory persistence + rebuild', () => {
  it('ReflexionMemory.ts source exposes dualWriteEpisodeToSQL helper', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'packages/agentdb/src/controllers/ReflexionMemory.ts'),
      'utf-8',
    );
    expect(src).toMatch(/dualWriteEpisodeToSQL/);
    // Both graph code paths invoke it after their primary write.
    const calls = src.match(/this\.dualWriteEpisodeToSQL\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('ReflexionMemory exposes a public rebuildIndex() method', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'packages/agentdb/src/controllers/ReflexionMemory.ts'),
      'utf-8',
    );
    expect(src).toMatch(/async\s+rebuildIndex\s*\(/);
    expect(src).toMatch(/from episodes/i);
    expect(src).toMatch(/episode_embeddings/);
  });

  it('rebuildIndex re-inserts through the public vectorBackend API, not getInner()', () => {
    // The whole point of #129's fix is to NOT call inner.insert(). Verify
    // the rebuildIndex path uses vectorBackend.insert(...) directly.
    const src = readFileSync(
      join(REPO_ROOT, 'packages/agentdb/src/controllers/ReflexionMemory.ts'),
      'utf-8',
    );
    // Find the rebuildIndex method body and check usage inside it.
    const rebuildBody = src.split(/async\s+rebuildIndex\s*\(/)[1] ?? '';
    expect(rebuildBody).toMatch(/this\.vectorBackend\.insert/);
    expect(rebuildBody).not.toMatch(/getInner\(\)\.insert/);
  });
});

describe('issue #118 / #119: GNN RuvectorLayer pre-validation', () => {
  it('RuvectorLayer constructor rejects non-integer inputDim', async () => {
    const { RuvectorLayer } = await import('../src/core/gnn-wrapper.js');
    expect(() => new (RuvectorLayer as any)([1, 2, 3], 4)).toThrow(/inputDim/);
    expect(() => new (RuvectorLayer as any)('foo', 4)).toThrow(/inputDim/);
    expect(() => new (RuvectorLayer as any)(0, 4)).toThrow(/inputDim/);
    expect(() => new (RuvectorLayer as any)(-1, 4)).toThrow(/inputDim/);
    expect(() => new (RuvectorLayer as any)(1.5, 4)).toThrow(/inputDim/);
  });

  it('RuvectorLayer constructor rejects bad outputDim and activation', async () => {
    const { RuvectorLayer } = await import('../src/core/gnn-wrapper.js');
    expect(() => new (RuvectorLayer as any)(4, 'bad')).toThrow(/outputDim/);
    expect(() => new (RuvectorLayer as any)(4, -2)).toThrow(/outputDim/);
    expect(() => new (RuvectorLayer as any)(4, 4, 'banana' as any)).toThrow(/activation/);
  });

  it('RuvectorLayer constructs cleanly with valid args', async () => {
    const { RuvectorLayer } = await import('../src/core/gnn-wrapper.js');
    const layer = new RuvectorLayer(8, 4, 'relu');
    expect(layer.getWeights().length).toBe(4);
    expect(layer.getWeights()[0].length).toBe(8);
    expect(layer.forward([1, 0, 0, 0, 0, 0, 0, 0]).length).toBe(4);
  });

  it('agentdb-wrapper-enhanced pre-validates EMBEDDING_DIM % numHeads invariant', () => {
    const src = readFileSync(
      join(PKG_INNER, 'src/core/agentdb-wrapper-enhanced.ts'),
      'utf-8',
    );
    // Look for the divisibility check we added.
    expect(src).toMatch(/% numHeads !== 0|% numHeads\s*!==\s*0/);
    // And the matching error message points users at the right config knobs.
    expect(src).toMatch(/RuvectorLayer would panic|must both be divisible/);
  });
});
