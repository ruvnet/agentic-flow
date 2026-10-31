/**
 * ReasoningBank embeddings, exercised through the built package (dist/) in a
 * child process, the way `import('agentic-flow/reasoningbank')` runs for users.
 *
 * - The process must exit promptly after embedding (no keep-alive timers).
 * - stdout carries only the caller's output; library logs go to stderr.
 * - An npx-like environment must still get semantic embeddings, and callers
 *   can tell semantic vectors from the hash fallback.
 *
 * Requires `npm run build` first.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const pkgRoot = fileURLToPath(new URL('../..', import.meta.url));
const distIndex = join(pkgRoot, 'dist', 'reasoningbank', 'index.js');
const distEmbeddings = join(pkgRoot, 'dist', 'reasoningbank', 'utils', 'embeddings.js');

const RESULT_PREFIX = 'RESULT ';
const KILL_AFTER_MS = 20_000;

interface ChildRun {
  stdout: string;
  stderr: string;
  code: number | null;
  killed: boolean;
  exitLagMs: number | null; // ms from the result line to process exit
}

function runChild(script: string, env: NodeJS.ProcessEnv = {}): Promise<ChildRun> {
  const dir = mkdtempSync(join(tmpdir(), 'rb-embed-'));
  const file = join(dir, 'probe.mjs');
  writeFileSync(file, script);

  return new Promise(resolve => {
    const child = spawn(process.execPath, [file], {
      cwd: dir,
      env: { ...process.env, ...env, CLAUDE_FLOW_DB_PATH: join(dir, 'memory.db') },
    });
    let stdout = '';
    let stderr = '';
    let resultAt: number | null = null;
    let killed = false;

    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (resultAt === null && stdout.includes(RESULT_PREFIX)) resultAt = Date.now();
    });
    child.stderr.on('data', chunk => (stderr += chunk));
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, KILL_AFTER_MS);

    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code,
        killed,
        exitLagMs: resultAt === null ? null : Date.now() - resultAt,
      });
    });
  });
}

function parseResult(run: ChildRun): any {
  const line = run.stdout.split('\n').find(l => l.startsWith(RESULT_PREFIX));
  if (!line) throw new Error(`no result line; stdout=${run.stdout} stderr=${run.stderr}`);
  return JSON.parse(line.slice(RESULT_PREFIX.length));
}

const embedOnceScript = `
const rb = await import(${JSON.stringify(pathToFileURL(distIndex).href)});
const e = await rb.computeEmbedding('a');
const cat = await rb.computeEmbedding('the cat sat on the mat');
const kitten = await rb.computeEmbedding('a kitten rested on the rug');
const tax = await rb.computeEmbedding('quarterly corporate tax filing deadline');
const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
process.stdout.write(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify({
  len: e.length,
  hasProbe: typeof rb.isSemanticEmbedding === 'function',
  semantic: typeof rb.isSemanticEmbedding === 'function' ? rb.isSemanticEmbedding() : null,
  related: cos(cat, kitten),
  unrelated: cos(cat, tax),
}) + '\\n');
`;

describe('ReasoningBank embeddings (built package, child process)', () => {
  beforeAll(() => {
    if (!existsSync(distIndex)) {
      throw new Error(`${distIndex} missing: run \`npm run build\` before this suite`);
    }
  });

  it('exits promptly after embedding and keeps stdout clean', async () => {
    const run = await runChild(embedOnceScript);

    expect(run.killed, `child still alive ${KILL_AFTER_MS}ms in; stderr=${run.stderr}`).toBe(false);
    expect(run.code).toBe(0);
    expect(run.exitLagMs).not.toBeNull();
    expect(run.exitLagMs!).toBeLessThan(3000);

    // Nothing but the caller's own line on stdout: [Embeddings]/[INFO] logs go to stderr.
    const lines = run.stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith(RESULT_PREFIX)).toBe(true);
    expect(parseResult(run).len).toBe(384);
  }, 60_000);

  it('uses semantic embeddings under npx and reports which kind it produced', async () => {
    const run = await runChild(embedOnceScript, {
      npm_lifecycle_event: 'npx',
      npm_execpath: '/usr/lib/node_modules/npm/bin/npx-cli.js',
      FORCE_TRANSFORMERS: '',
    });
    const result = parseResult(run);

    expect(result.hasProbe).toBe(true);
    expect(result.semantic).toBe(true);
    // Hash vectors carry no meaning; a real model ranks the paraphrase far higher.
    expect(result.related - result.unrelated).toBeGreaterThan(0.2);
  }, 60_000);

  it('batch embedding keeps each row aligned with its own text', async () => {
    const { computeEmbedding, computeEmbeddingBatch, clearEmbeddingCache } = await import(
      pathToFileURL(distEmbeddings).href
    );
    const texts = Array.from(
      { length: 40 },
      (_, i) => `ticket ${i}: ${['fix flaky router stream', 'tune sqlite pruning', 'add sona fallback', 'cache embeddings'][i % 4]} in module ${i}`,
    );
    texts.push(texts[3]); // duplicate input must map to the same vector

    clearEmbeddingCache();
    const batch: Float32Array[] = await computeEmbeddingBatch(texts);
    expect(batch).toHaveLength(texts.length);
    expect(batch[texts.length - 1]).toEqual(batch[3]);

    const cos = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
    for (const i of [0, 1, 2, 3, 17, 39]) {
      clearEmbeddingCache();
      const single: Float32Array = await computeEmbedding(texts[i]);
      expect(batch[i]).toHaveLength(384);
      // q8 dynamic quantization makes a batched vector depend slightly on its
      // batch-mates (~0.99 cosine); a misaligned row would score far lower.
      const own = cos(single, batch[i]);
      expect(own).toBeGreaterThan(0.95);
      expect(own).toBeGreaterThan(cos(single, batch[(i + 1) % 40]));
    }
  }, 120_000);
});
