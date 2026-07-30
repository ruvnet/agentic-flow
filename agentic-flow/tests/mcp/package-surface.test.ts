import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('published package surfaces', () => {
  it('ships the AgentDB CLI through the pinned AgentDB dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );

    expect(packageJson.dependencies.agentdb).toBe('3.0.0-alpha.20');
    expect(packageJson.optionalDependencies.agentdb).toBeUndefined();
    expect(packageJson.bin.agentdb).toBe('dist/cli/agentdb-proxy.js');
  });
});
