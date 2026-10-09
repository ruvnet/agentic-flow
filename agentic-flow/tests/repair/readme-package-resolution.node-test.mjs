import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const repairCommands = readme
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^npx\s/.test(line) && /\bagentic-flow-repair\b/.test(line));

test('agentic-flow supplies the documented repair binary', () => {
  assert.equal(packageJson.name, 'agentic-flow');
  assert.equal(packageJson.bin['agentic-flow-repair'], 'dist/repair/cli.js');
});

test('every README repair command explicitly selects agentic-flow before the binary', () => {
  assert.ok(repairCommands.length > 0, 'Expected repair examples in the package README');
  for (const command of repairCommands) {
    // Keep package selection before the positional command so npx parses it.
    assert.match(command, /^npx --package=agentic-flow -- agentic-flow-repair(?:\s|$)/);
  }
});

test('README keeps both repair examples and their original arguments', () => {
  assert.deepEqual(repairCommands, [
    'npx --package=agentic-flow -- agentic-flow-repair ./my-repo --generations 3',
    'npx --package=agentic-flow -- agentic-flow-repair ./my-repo --mock',
  ]);
});
