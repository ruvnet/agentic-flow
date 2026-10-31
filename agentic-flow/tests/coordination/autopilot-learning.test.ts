/**
 * AutopilotLearning against a real AgentDB (agentdb must be installed).
 *
 * ruflo imports dist/coordination/autopilot-learning.js by file URL, so the
 * built file is checked as well as the source.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { AGENTDB_DIR_ENV, AgentDBService } from '../../src/services/agentdb-service.js';
import { SonaRvfService } from '../../src/services/sona-rvf-service.js';
import { AutopilotLearning } from '../../src/coordination/autopilot-learning.js';

const DIST_FILE = resolve(__dirname, '../../dist/coordination/autopilot-learning.js');

describe('built autopilot-learning module', () => {
  it('ships dist/coordination/autopilot-learning.js exporting AutopilotLearning', async () => {
    expect(existsSync(DIST_FILE), `${DIST_FILE} missing — run npm run build`).toBe(true);
    const mod = await import(pathToFileURL(DIST_FILE).href);
    expect(typeof mod.AutopilotLearning).toBe('function');
    const instance = new mod.AutopilotLearning();
    for (const method of [
      'initialize', 'isAvailable', 'getMetrics', 'discoverSuccessPatterns',
      'recallSimilarTasks', 'predictNextAction', 'recordTaskCompletion', 'recordTaskFailure',
    ]) {
      expect(typeof instance[method], method).toBe('function');
    }
  });
});

describe('AutopilotLearning with AgentDB available', () => {
  let dir: string;
  let previousDir: string | undefined;
  let learning: AutopilotLearning;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'af-autopilot-'));
    previousDir = process.env[AGENTDB_DIR_ENV];
    process.env[AGENTDB_DIR_ENV] = dir;
    AgentDBService.resetInstance();
    SonaRvfService.resetInstance();
    learning = new AutopilotLearning();
  }, 120_000);

  afterAll(async () => {
    const service = await AgentDBService.getInstance();
    await service.shutdown();
    AgentDBService.resetInstance();
    SonaRvfService.resetInstance();
    if (previousDir === undefined) delete process.env[AGENTDB_DIR_ENV];
    else process.env[AGENTDB_DIR_ENV] = previousDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('initializes on the real AgentDB backend in the configured directory', async () => {
    expect(await learning.initialize()).toBe(true);
    expect(learning.isAvailable()).toBe(true);
    const service = await AgentDBService.getInstance();
    expect(service.getBackendName()).toBe('agentdb');
  }, 120_000);

  it('records a completion and recalls it', async () => {
    await learning.recordTaskCompletion({
      taskId: 't-1',
      subject: 'implement the login page form validation',
      status: 'completed',
      iterations: 2,
      durationMs: 60_000,
    });
    await learning.recordTaskFailure({
      taskId: 't-2',
      subject: 'migrate the billing database schema',
      status: 'failed',
      iterations: 5,
      durationMs: 120_000,
      critique: 'missing rollback script',
    });

    const recalled = await learning.recallSimilarTasks('login page validation', 5);
    expect(recalled.length).toBeGreaterThanOrEqual(1);
    expect(recalled.some((ep: any) => ep.task.includes('login page'))).toBe(true);
  }, 60_000);

  it('reports persisted episodes in metrics', async () => {
    const metrics = await learning.getMetrics();
    expect(metrics.available).toBe(true);
    expect(metrics.episodes).toBeGreaterThanOrEqual(1);
    expect(metrics.sonaStats).not.toBeNull();
  });

  it('predicts a next action with a confidence', async () => {
    const prediction = await learning.predictNextAction({ completed: 1, total: 3 });
    expect(typeof prediction.action).toBe('string');
    expect(typeof prediction.confidence).toBe('number');
  });

  it('stores a swarm-completion pattern from a SONA trajectory and discovers it', async () => {
    await learning.beginSwarmTrajectory('session-1');
    await learning.recordIterationStep({ completed: 1, total: 2, iterations: 1, progress: 50 }, []);
    await learning.recordIterationStep({ completed: 2, total: 2, iterations: 2, progress: 100 }, []);
    await learning.endSwarmTrajectory({ completed: 2, total: 2 });

    const patterns = await learning.discoverSuccessPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect((await learning.getMetrics()).patterns).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('persistence across processes (built module, as ruflo loads it)', () => {
  // Each step runs in its own node process, the way ruflo's MCP server does.
  const runStep = (dir: string, body: string): string => execFileSync(process.execPath, [
    '--input-type=module', '-e',
    `const { AutopilotLearning } = await import(${JSON.stringify(pathToFileURL(DIST_FILE).href)});
     const learning = new AutopilotLearning();
     if (!(await learning.initialize())) throw new Error('AgentDB unavailable');
     ${body}
     process.exit(0);`,
  ], { env: { ...process.env, [AGENTDB_DIR_ENV]: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  it('recalls in a second process an episode recorded by the first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-autopilot-proc-'));
    try {
      runStep(dir, `await learning.recordTaskCompletion({ taskId: 'p-1', subject: 'write the 2.2.0 release notes', status: 'completed', iterations: 1, durationMs: 1000 });`);
      expect(existsSync(join(dir, 'agentdb.sqlite'))).toBe(true);
      const out = runStep(dir, `console.log('RECALL=' + JSON.stringify((await learning.recallSimilarTasks('release notes', 5)).map((e) => e.task)));`);
      const line = out.split('\n').find((l) => l.startsWith('RECALL='));
      expect(line, out).toBeDefined();
      expect(JSON.parse(line!.slice('RECALL='.length))).toContain('[COMPLETED] write the 2.2.0 release notes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
