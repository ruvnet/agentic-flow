/**
 * Regression test: after 3.0.0 made the translation proxies require a per-run
 * token, the proxy guides still told users to send a dummy key that "any
 * value" satisfied, and the READMEs and shipped skills still ran
 * `npx agentic-flow@alpha`, which resolves to the March 3.0.0-alpha line.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkgDir = new URL('../../', import.meta.url);
const repoDir = new URL('../../../', import.meta.url);
const read = (base: URL, path: string) => readFileSync(new URL(path, base), 'utf8');

const PROXY_GUIDES = ['STANDALONE_PROXY_GUIDE.md', 'CLAUDE-CODE-INTEGRATION.md', 'PROXY-ARCHITECTURE-AND-EXTENSION.md'];
// A literal key passed to a token-checking proxy; `<token printed by the proxy>` is fine.
const DUMMY_KEY = /ANTHROPIC_API_KEY\s*=\s*['"]?(sk-ant-proxy-dummy|dummy)|x-api-key: sk-ant-proxy-dummy|Any value works/;

describe('proxy docs match the token-required proxies', () => {
  for (const base of [pkgDir, repoDir]) {
    for (const guide of PROXY_GUIDES) {
      it(`${base === pkgDir ? 'agentic-flow/' : ''}docs/guides/${guide} sends the proxy token, not a dummy key`, () => {
        const text = read(base, `docs/guides/${guide}`);
        expect(text).not.toMatch(DUMMY_KEY);
      });
    }
  }

  it('the standalone guide explains AGENTIC_FLOW_PROXY_TOKEN', () => {
    expect(read(pkgDir, 'docs/guides/STANDALONE_PROXY_GUIDE.md')).toContain('AGENTIC_FLOW_PROXY_TOKEN');
  });

  it('the Requesty migration guide sends the proxy token', () => {
    expect(read(pkgDir, 'docs/plans/requesty/05-migration-guide.md')).not.toMatch(DUMMY_KEY);
  });
});

describe('docs pin agentic-flow instead of @alpha', () => {
  const skillsDir = new URL('.claude/skills/', pkgDir);
  const files = [
    ['README.md', pkgDir],
    ['README.md', repoDir],
    ...readdirSync(skillsDir).map((d) => [`.claude/skills/${d}/skill.md`, pkgDir]),
  ] as Array<[string, URL]>;

  for (const [path, base] of files) {
    it(`${base === pkgDir ? 'agentic-flow/' : ''}${path}`, () => {
      let text: string;
      try { text = read(base, path); } catch { return; } // skill dir without skill.md
      expect(text).not.toContain('agentic-flow@alpha');
    });
  }
});
