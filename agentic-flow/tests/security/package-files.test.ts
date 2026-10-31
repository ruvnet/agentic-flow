/**
 * Regression test: package.json `files` listed "certs", so any TLS key or
 * certificate left in agentic-flow/certs/ would be published to npm.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('published files', () => {
  it('does not ship a certs/ directory', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.files.some((entry: string) => /^!?certs(\/|$)/.test(entry) && !entry.startsWith('!'))).toBe(false);
  });
});
