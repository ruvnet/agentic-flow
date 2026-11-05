/**
 * @ruvector/router integration: SemanticRouter builds a native HNSW index
 * and ranks by similarity (the native index returns cosine distance).
 */
import { describe, expect, it } from 'vitest';
import { SemanticRouter } from '../../src/routing/SemanticRouter.js';

// Deterministic bag-of-words embedder over a tiny vocabulary.
const VOCAB = ['test', 'unit', 'coverage', 'security', 'audit', 'vulnerability', 'deploy', 'docker', 'release'];
const embedder: any = {
  embed: async (text: string) => {
    const words = text.toLowerCase().split(/\W+/);
    const v = new Float32Array(VOCAB.length);
    VOCAB.forEach((w, i) => (v[i] = words.filter((x) => x.startsWith(w)).length));
    return v;
  },
};

const intents = [
  { agentType: 'tester', description: 'unit test coverage', examples: ['write unit tests'], tags: ['test'] },
  { agentType: 'security-auditor', description: 'security audit', examples: ['find vulnerability'], tags: ['security'] },
  { agentType: 'devops', description: 'deploy docker release', examples: ['ship release'], tags: ['deploy'] },
];

async function routerWith(native: boolean) {
  const r = new SemanticRouter(embedder, { native });
  await r.registerAgents(intents);
  r.buildIndex();
  return r;
}

describe('SemanticRouter with @ruvector/router', () => {
  it('uses the native HNSW index when installed', async () => {
    expect((await routerWith(true)).getIndexBackend()).toBe('ruvector-router');
  });

  it('routes to the most similar agent, highest similarity first', async () => {
    const r = await routerWith(true);
    const res = await r.route('run a security audit for vulnerability reports', 2);
    expect(res.primaryAgent).toBe('security-auditor');
    expect(res.confidence).toBeGreaterThan(0.5);
    expect(res.confidence).toBeGreaterThanOrEqual(res.alternatives[0].confidence);
  });

  it('agrees with the brute-force fallback', async () => {
    const native = await routerWith(true);
    const brute = await routerWith(false);
    expect(brute.getIndexBackend()).toBe('brute-force');
    for (const task of ['add unit test coverage', 'deploy the docker release', 'security audit']) {
      const a = await native.route(task, 2);
      const b = await brute.route(task, 2);
      expect(a.primaryAgent).toBe(b.primaryAgent);
      expect(a.confidence).toBeCloseTo(b.confidence, 4);
    }
  });
});
