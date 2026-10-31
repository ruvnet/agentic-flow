/**
 * agentic-flow depends on ruvector ^0.3.3: 0.3.x fixes RVF string-id data loss
 * (ruvector#980) and dropped writes (ruvector#992). This pins the declared
 * range and the ruvector API surface agentic-flow calls, so a ruvector upgrade
 * that removes one of them fails here instead of at a guarded call site.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

function parse(version: string): [number, number, number] {
  const [major, minor, patch] = version.replace(/^[^\d]*/, '').split(/[.-]/).map(Number);
  return [major, minor, patch];
}

function atLeast(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

// Exports used by intelligence/, workers/, utils/model-cache, harness/metaharness
// and the MCP intelligence bridge.
const EXPORTS = [
  'createIntelligenceEngine', 'IntelligenceEngine', 'differentiableSearch', 'isGnnAvailable',
  'TensorCompress', 'VectorDb', 'SonaEngine', 'ExtendedWorkerPool', 'parallelAttentionCompute',
  'embed', 'embedBatch', 'similarity', 'cosineSimilarity', 'getStats', 'shutdown',
  'isOnnxAvailable', 'getDefaultEmbeddingService', 'toFloat32Array',
  'METAHARNESS_VERSIONS', 'assertMetaHarnessSafePayload', 'evaluateMetaHarnessPromotion',
  'getMetaHarnessCapabilities', 'runMetaHarnessDarwin', 'runMetaHarnessFlywheel',
  'scanMetaHarnessRewardHacks', 'verifyMetaHarnessReplay',
];

const INTELLIGENCE_ENGINE_METHODS = ['embedAsync', 'recordEpisode', 'export', 'import', 'tick', 'getStats'];

describe('ruvector dependency', () => {
  it('declares ruvector ^0.3.3 or later', () => {
    const range: string = pkg.dependencies.ruvector;
    expect(range.startsWith('^')).toBe(true);
    expect(atLeast(parse(range), [0, 3, 3])).toBe(true);
  });

  it('resolves an installed ruvector inside the declared range', () => {
    const installed = parse(require('ruvector/package.json').version);
    const min = parse(pkg.dependencies.ruvector);
    expect(atLeast(installed, min)).toBe(true);
    // ^0.x.y allows patch updates only within the same minor.
    expect(installed.slice(0, 2)).toEqual(min.slice(0, 2));
  });

  it('exposes every API agentic-flow calls', () => {
    const ruvector = require('ruvector');
    const missing = EXPORTS.filter(name => ruvector[name] === undefined);
    expect(missing).toEqual([]);

    const proto = ruvector.IntelligenceEngine.prototype;
    expect(INTELLIGENCE_ENGINE_METHODS.filter(m => typeof proto[m] !== 'function')).toEqual([]);
  });
});
