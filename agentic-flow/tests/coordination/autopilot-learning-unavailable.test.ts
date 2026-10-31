/**
 * AutopilotLearning when the agentdb package cannot be imported: it must
 * report unavailable and every method must return its empty default.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentDBService } from '../../src/services/agentdb-service.js';
import { SonaRvfService } from '../../src/services/sona-rvf-service.js';
import { AutopilotLearning } from '../../src/coordination/autopilot-learning.js';

vi.mock('agentdb', () => {
  throw new Error('Cannot find package agentdb');
});

describe('AutopilotLearning without AgentDB', () => {
  let learning: AutopilotLearning;

  beforeEach(async () => {
    AgentDBService.resetInstance();
    SonaRvfService.resetInstance();
    learning = new AutopilotLearning();
  });

  it('initialize() returns false and isAvailable() is false', async () => {
    expect(await learning.initialize()).toBe(false);
    expect(learning.isAvailable()).toBe(false);
    expect((await AgentDBService.getInstance()).getBackendName()).toBe('in-memory');
  });

  it('every method returns its empty default without throwing', async () => {
    await learning.initialize();
    const episode = { taskId: 't', subject: 's', status: 'completed', iterations: 1, durationMs: 10 };

    await expect(learning.recordTaskCompletion(episode)).resolves.toBeUndefined();
    await expect(learning.recordTaskFailure({ ...episode, status: 'failed' })).resolves.toBeUndefined();
    expect(await learning.recallSimilarTasks('anything')).toEqual([]);
    expect(await learning.discoverSuccessPatterns()).toEqual([]);
    expect(await learning.predictNextAction({ completed: 0 })).toEqual({
      action: 'continue', confidence: 0, alternatives: [],
    });
    expect(await learning.getReEngagementContext([{ subject: 's', status: 'pending' }])).toEqual({
      pastFailures: [], pastSuccesses: [], patterns: [], recommendations: [], confidence: 0,
    });

    const metrics = await learning.getMetrics();
    expect(metrics.available).toBe(false);
    expect(metrics.episodes).toBe(0);
    expect(metrics.patterns).toBe(0);
  });

  it('methods are safe to call before initialize()', async () => {
    expect(learning.isAvailable()).toBe(false);
    expect(await learning.recallSimilarTasks('x')).toEqual([]);
    expect((await learning.getMetrics()).available).toBe(false);
  });
});
