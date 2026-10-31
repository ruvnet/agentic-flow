/**
 * Regression test: `.claude/statusline.mjs` called `context.model.replace`,
 * which throws when Claude Code passes `model` as `{ id, display_name }`.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped .mjs helper shipped in .claude/
import statusline from '../../.claude/statusline.mjs';

describe('.claude/statusline.mjs model field', () => {
  it('accepts a string model', () => {
    expect(statusline({ model: 'claude-sonnet-4-20250514' })).toContain('S4');
  });

  it('accepts { id, display_name } and prefers display_name', () => {
    const out = statusline({ model: { id: 'claude-opus-4-1', display_name: 'Opus 4.1' } });
    expect(out).toContain('Opus 4.1');
    expect(out).not.toContain('claude-opus-4-1');
  });

  it('falls back to id when display_name is missing', () => {
    expect(statusline({ model: { id: 'claude-opus-4-1' } })).toContain('O4');
  });

  it('ignores a missing or malformed model', () => {
    expect(() => statusline({})).not.toThrow();
    expect(() => statusline({ model: {} })).not.toThrow();
  });
});
