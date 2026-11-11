/**
 * `hooks intelligence route` / `intelligence_route` must report the search
 * path that actually ran.
 *
 * The bridge builds the intelligence layer with `enableHnsw: false`, and
 * published `ruvector` has no `HnswIndex`, so agent and pattern search is an
 * exact cosine scan. Up to 3.5.4 the tool always reported
 * `engine: 'ruvector-sona-moe-hnsw'` and `features: [..., 'hnsw-search']`,
 * and its descriptions claimed "HNSW (150x faster)".
 */
import { describe, expect, it } from 'vitest';
import {
  intelligencePatternSearchTool,
  intelligencePatternStoreTool,
  intelligenceRouteTool,
  intelligenceStatsTool,
} from '../../src/mcp/fastmcp/tools/hooks/intelligence-tools.js';

const ctx = { onProgress: () => {} } as any;

describe('intelligence route reports the search path that ran', () => {
  it('route features and engine do not claim HNSW when it is disabled', async () => {
    const result: any = await intelligenceRouteTool.execute(
      { task: 'fix the failing typescript build', topK: 3 },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.features).toContain('cosine-search');
    expect(result.features).not.toContain('hnsw-search');
    expect(result.engine).toBe(['ruvector', ...result.features].join('+'));
    expect(result.engine).not.toMatch(/hnsw/);
  }, 60_000);

  it('stats does not report a fixed HNSW speedup', async () => {
    const result: any = await intelligenceStatsTool.execute({}, ctx);
    expect(result.success).toBe(true);
    expect(result.features.hnsw.enabled).toBe(false);
    expect(result.features.hnsw).not.toHaveProperty('speedup');
    expect(result.features.hnsw.search).toBe('exact cosine scan');
  }, 60_000);

  it('tool descriptions carry no unmeasured speedup claim', () => {
    for (const tool of [
      intelligenceRouteTool,
      intelligencePatternStoreTool,
      intelligencePatternSearchTool,
    ]) {
      expect(tool.description).not.toMatch(/150x|HNSW/);
    }
  });
});
