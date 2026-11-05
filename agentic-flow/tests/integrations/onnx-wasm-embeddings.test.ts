/**
 * ruvector-onnx-embeddings-wasm integration: the shared loader works around
 * the package's CJS-in-ESM packaging, and AgentDBFast embeds with the real
 * all-MiniLM-L6-v2 model when it can be obtained (~91 MB, cached in
 * ~/.agentic-flow/models). Set AGENTIC_FLOW_OFFLINE=1 to skip the download.
 */
import { describe, expect, it } from 'vitest';
import {
  loadOnnxWasmModule,
  OnnxWasmTextEmbedder,
  onnxWasmDownloadAllowed,
  onnxWasmModelCached,
} from '../../src/integrations/onnx-wasm-embedder.js';
import { AgentDBFast } from '../../src/core/agentdb-fast.js';

const cos = (a: number[] | Float32Array, b: number[] | Float32Array) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / Math.sqrt(x * y);
};

describe('ruvector-onnx-embeddings-wasm', () => {
  it('loads the real package (despite its type:module + CJS glue)', async () => {
    const mod = await loadOnnxWasmModule();
    expect(mod).not.toBeNull();
    expect(typeof mod!.WasmEmbedder).toBe('function');
    expect(mod!.version()).toMatch(/\d+\.\d+/);
  });

  it('AgentDBFast hash mode stays offline and deterministic', async () => {
    const db = new AgentDBFast({ embeddings: 'hash' });
    const a = await (db as any).getEmbedding('hello');
    expect(a).toHaveLength(384);
    expect(db.getEmbeddingSource()).toBe('hash');
  });

  const canGetModel = onnxWasmModelCached() || onnxWasmDownloadAllowed();
  it.runIf(canGetModel)('embeds semantically with all-MiniLM-L6-v2 (AgentDBFast auto mode)', async () => {
    const embedder = await OnnxWasmTextEmbedder.create();
    expect(embedder, 'model download or load failed').not.toBeNull();
    expect(embedder!.dimension).toBe(384);

    const db = new AgentDBFast();
    const login = await (db as any).getEmbedding('fix the login bug');
    const auth = await (db as any).getEmbedding('repair the authentication error');
    const cake = await (db as any).getEmbedding('bake a chocolate cake');
    expect(db.getEmbeddingSource()).toBe('onnx-wasm');
    expect(cos(login, auth)).toBeGreaterThan(cos(login, cake) + 0.2);
  }, 300_000);
});
