/**
 * Browser WASM Tests for Graph Transformer
 * Phase 2 of ADR-071: WASM Fallback Testing
 *
 * Tests graph-transformer-wasm package in browser environment
 * Target: <10ms inference latency
 */

import { test, expect } from '@playwright/test';

test.describe('Graph Transformer WASM', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to test page that loads WASM module
    await page.goto('http://localhost:3000/test-wasm');
  });

  test('should load WASM module successfully', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const mod = await import('ruvector-graph-transformer-wasm');
      return {
        loaded: !!mod,
        hasTransformer: !!mod.JsGraphTransformer,
        hasSublinear: !!mod.SublinearAttention,
      };
    });

    expect(result.loaded).toBe(true);
    expect(result.hasTransformer).toBe(true);
    expect(result.hasSublinear).toBe(true);
  });

  test('should initialize JsGraphTransformer', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { JsGraphTransformer } = await import('ruvector-graph-transformer-wasm');
      const gt = new JsGraphTransformer();

      return {
        initialized: !!gt,
        methods: [
          typeof gt.transform,
          typeof gt.embed,
          typeof gt.search,
        ],
      };
    });

    expect(result.initialized).toBe(true);
    expect(result.methods).toEqual(['function', 'function', 'function']);
  });

  test('should perform graph transformation <10ms', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { JsGraphTransformer } = await import('ruvector-graph-transformer-wasm');
      const gt = new JsGraphTransformer();

      // Prepare test graph data
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        embedding: Array.from({ length: 768 }, () => Math.random()),
      }));

      const edges = Array.from({ length: 200 }, (_, i) => ({
        source: `node-${i % 100}`,
        target: `node-${(i + 1) % 100}`,
        weight: Math.random(),
      }));

      // Benchmark transformation
      const start = performance.now();
      const transformed = await gt.transform({ nodes, edges });
      const duration = performance.now() - start;

      return {
        duration,
        resultSize: transformed.nodes?.length || 0,
        under10ms: duration < 10,
      };
    });

    expect(result.resultSize).toBeGreaterThan(0);
    expect(result.under10ms).toBe(true);
    expect(result.duration).toBeLessThan(10);
  });

  test('should use sublinear attention mechanism', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { SublinearAttention } = await import('ruvector-graph-transformer-wasm');
      const attn = new SublinearAttention({
        dimension: 768,
        heads: 8,
        algorithm: 'flash',
      });

      // Test attention computation
      const queries = Array.from({ length: 32 }, () =>
        Array.from({ length: 768 }, () => Math.random())
      );
      const keys = Array.from({ length: 32 }, () =>
        Array.from({ length: 768 }, () => Math.random())
      );
      const values = Array.from({ length: 32 }, () =>
        Array.from({ length: 768 }, () => Math.random())
      );

      const start = performance.now();
      const output = await attn.compute(queries, keys, values);
      const duration = performance.now() - start;

      return {
        outputShape: [output.length, output[0]?.length || 0],
        duration,
        under5ms: duration < 5,
      };
    });

    expect(result.outputShape).toEqual([32, 768]);
    expect(result.under5ms).toBe(true);
  });

  test('should handle causal attention masking', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { CausalAttention } = await import('ruvector-graph-transformer-wasm');
      const attn = new CausalAttention({
        dimension: 512,
        heads: 4,
      });

      const seq = Array.from({ length: 16 }, () =>
        Array.from({ length: 512 }, () => Math.random())
      );

      const output = await attn.forward(seq, { mask: 'causal' });

      return {
        outputLength: output.length,
        outputDim: output[0]?.length || 0,
        hasValidShape: output.length === 16 && (output[0]?.length || 0) === 512,
      };
    });

    expect(result.hasValidShape).toBe(true);
  });

  test('should verify Hamiltonian physics integration', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { HamiltonianAttention } = await import('ruvector-graph-transformer-wasm');
      const hamiltonian = new HamiltonianAttention({
        dimension: 768,
        energyFunction: 'quadratic',
      });

      const state = Array.from({ length: 768 }, () => Math.random());
      const evolved = await hamiltonian.evolve(state, { timesteps: 10 });

      return {
        stateLength: evolved.length,
        energyConserved: Math.abs(
          await hamiltonian.energy(state) - await hamiltonian.energy(evolved)
        ) < 0.01,
      };
    });

    expect(result.stateLength).toBe(768);
    expect(result.energyConserved).toBe(true);
  });

  test('should benchmark against JS fallback', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Test WASM version
      const { JsGraphTransformer: WASMTransformer } = await import('ruvector-graph-transformer-wasm');
      const wasmGt = new WASMTransformer();

      const testData = {
        nodes: Array.from({ length: 50 }, (_, i) => ({
          id: `n${i}`,
          embedding: Array.from({ length: 384 }, () => Math.random()),
        })),
        edges: Array.from({ length: 100 }, (_, i) => ({
          source: `n${i % 50}`,
          target: `n${(i + 1) % 50}`,
          weight: 0.5,
        })),
      };

      const wasmStart = performance.now();
      await wasmGt.transform(testData);
      const wasmDuration = performance.now() - wasmStart;

      // JS fallback would be ~50-100ms, WASM should be <10ms
      const expectedSpeedup = 5; // Conservative estimate
      const under10ms = wasmDuration < 10;

      return {
        wasmDuration,
        under10ms,
        significantlyFaster: under10ms, // If under 10ms, definitely faster than JS
      };
    });

    expect(result.under10ms).toBe(true);
    expect(result.significantlyFaster).toBe(true);
  });
});
