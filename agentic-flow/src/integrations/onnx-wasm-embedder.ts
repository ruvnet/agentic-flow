/**
 * Real text embeddings through `ruvector-onnx-embeddings-wasm` (all-MiniLM-L6-v2, 384-d).
 *
 * Packaging note: ruvector-onnx-embeddings-wasm 0.1.0-0.1.2 declares
 * `"type": "module"` but ships wasm-bindgen's CommonJS (nodejs target) glue,
 * which assigns `module.exports`. `import()` therefore throws
 * "module is not defined in ES module scope", and `require()` fails the same
 * way because Node treats the file as ESM. We compile the glue explicitly as
 * CommonJS. If a future release ships real ESM, plain `import()` is used.
 *
 * Model: the WASM runtime cannot load the quantized ONNX graph agentic-flow's
 * OptimizedEmbedder uses by default (it fails on an Unsqueeze node), so this
 * uses the full-precision Xenova/all-MiniLM-L6-v2 model (~91 MB) plus its
 * tokenizer.json. Both live in the same model directory OptimizedEmbedder uses
 * (`~/.agentic-flow/models`, override with `AGENTIC_FLOW_MODEL_DIR`); the ONNX
 * file name matches OptimizedEmbedder's `all-MiniLM-L6-v2-full` registry entry,
 * so either component can reuse the other's download.
 *
 * Downloads happen on first use unless any of these is set:
 * `AGENTIC_FLOW_OFFLINE=1`, `HF_HUB_OFFLINE=1`, `AGENTIC_FLOW_EMBEDDINGS_DOWNLOAD=0`.
 * Nothing here writes to stdout (the MCP stdio server owns it).
 */

import Module from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveOptional } from './optional.js';

export const ONNX_WASM_PACKAGE = 'ruvector-onnx-embeddings-wasm';
export const ONNX_WASM_DIMENSION = 384;

const MODEL_FILE = 'all-MiniLM-L6-v2-full.onnx';
const TOKENIZER_FILE = 'all-MiniLM-L6-v2.tokenizer.json';
const MODEL_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';
const TOKENIZER_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json';

interface WasmEmbedderHandle {
  embedOne(text: string): Float32Array;
  dimension(): number;
}
export interface OnnxWasmModule {
  WasmEmbedder: new (modelBytes: Uint8Array, tokenizerJson: string) => WasmEmbedderHandle;
  cosineSimilarity(a: Float32Array, b: Float32Array): number;
  version(): string;
}

let modulePromise: Promise<OnnxWasmModule | null> | null = null;

/** Load the WASM glue (see the packaging note above), or null when absent. */
export function loadOnnxWasmModule(): Promise<OnnxWasmModule | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const entry = resolveOptional(ONNX_WASM_PACKAGE);
      if (!entry) return null;
      try {
        const source = readFileSync(entry, 'utf8');
        if (/\bmodule\.exports\b/.test(source)) {
          const M = Module as any;
          const mod = new M(entry, null);
          mod.filename = entry;
          mod.paths = M._nodeModulePaths(dirname(entry));
          mod._compile(source, entry);
          return mod.exports as OnnxWasmModule;
        }
        return (await import(ONNX_WASM_PACKAGE)) as unknown as OnnxWasmModule;
      } catch {
        return null;
      }
    })();
  }
  return modulePromise;
}

export function onnxWasmModelDir(): string {
  return process.env.AGENTIC_FLOW_MODEL_DIR || join(homedir(), '.agentic-flow', 'models');
}

export function onnxWasmDownloadAllowed(): boolean {
  const off = (v: string | undefined) => v === '1' || v === 'true';
  return !(
    off(process.env.AGENTIC_FLOW_OFFLINE) ||
    off(process.env.HF_HUB_OFFLINE) ||
    process.env.AGENTIC_FLOW_EMBEDDINGS_DOWNLOAD === '0' ||
    process.env.AGENTIC_FLOW_EMBEDDINGS_DOWNLOAD === 'false'
  );
}

/** Whether model + tokenizer are already on disk (no network needed). */
export function onnxWasmModelCached(dir = onnxWasmModelDir()): boolean {
  return existsSync(join(dir, MODEL_FILE)) && existsSync(join(dir, TOKENIZER_FILE));
}

async function download(url: string, target: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} ${res.statusText}: ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tmp = `${target}.${process.pid}.part`;
  writeFileSync(tmp, bytes, { mode: 0o600 });
  renameSync(tmp, target);
}

async function ensureModelFiles(dir: string): Promise<boolean> {
  if (onnxWasmModelCached(dir)) return true;
  if (!onnxWasmDownloadAllowed()) return false;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  process.stderr.write(`[agentic-flow] downloading all-MiniLM-L6-v2 (~91 MB) to ${dir}\n`);
  if (!existsSync(join(dir, TOKENIZER_FILE))) await download(TOKENIZER_URL, join(dir, TOKENIZER_FILE));
  if (!existsSync(join(dir, MODEL_FILE))) await download(MODEL_URL, join(dir, MODEL_FILE));
  return true;
}

/** A loaded all-MiniLM-L6-v2 embedder. `embed` is async to match other embedders. */
export class OnnxWasmTextEmbedder {
  readonly dimension: number;
  readonly source = 'onnx-wasm' as const;

  private constructor(private readonly handle: WasmEmbedderHandle) {
    this.dimension = handle.dimension();
  }

  /** Build an embedder, or null when the package or the model is unavailable. */
  static async create(options: { modelDir?: string } = {}): Promise<OnnxWasmTextEmbedder | null> {
    const mod = await loadOnnxWasmModule();
    if (!mod) return null;
    const dir = options.modelDir ?? onnxWasmModelDir();
    try {
      if (!(await ensureModelFiles(dir))) return null;
      const handle = new mod.WasmEmbedder(
        new Uint8Array(readFileSync(join(dir, MODEL_FILE))),
        readFileSync(join(dir, TOKENIZER_FILE), 'utf8'),
      );
      return new OnnxWasmTextEmbedder(handle);
    } catch (err: any) {
      process.stderr.write(`[agentic-flow] ONNX WASM embedder unavailable: ${err?.message ?? err}\n`);
      return null;
    }
  }

  embedSync(text: string): Float32Array {
    return this.handle.embedOne(text);
  }

  async embed(text: string): Promise<Float32Array> {
    return this.handle.embedOne(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.handle.embedOne(t));
  }
}

let shared: Promise<OnnxWasmTextEmbedder | null> | null = null;

/** Process-wide embedder (loaded once), or null. */
export function getOnnxWasmEmbedder(): Promise<OnnxWasmTextEmbedder | null> {
  if (!shared) shared = OnnxWasmTextEmbedder.create();
  return shared;
}

/** Test hook. */
export function _resetOnnxWasmForTests(): void {
  shared = null;
  modulePromise = null;
}
