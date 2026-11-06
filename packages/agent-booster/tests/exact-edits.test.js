#!/usr/bin/env node
/**
 * Regression test: the four exact-edit cases agent-booster 0.2.2 passed.
 *
 * Runs against the BUILT package (wasm/ from wasm-pack + dist/ from tsc), through
 * both the JS API and the CLI, because the 0.2.2 -> HEAD regression lived at the
 * JS <-> WASM boundary: dist/index.js passed the language as a string into the
 * numeric WasmLanguage enum, newer wasm-bindgen glue rejected it, and apply()
 * returned the input unchanged with success:false.
 *
 * Usage: node --test tests/exact-edits.test.js   (after `npm run build`)
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { AgentBooster } = require(path.join(root, 'dist', 'index.js'));
const cli = path.join(root, 'dist', 'cli.js');

const cases = [
  {
    name: 'var -> const',
    code: 'var x = 1;',
    edit: 'const x = 1;',
    language: 'javascript',
    minConfidence: 0.5,
  },
  {
    name: 'add type annotations',
    code: 'function add(a, b) { return a + b; }',
    edit: 'function add(a: number, b: number): number { return a + b; }',
    language: 'typescript',
    minConfidence: 0.5,
  },
  {
    name: 'add error handling',
    code: 'function divide(a, b) { return a / b; }',
    edit: 'function divide(a, b) { if (b === 0) throw new Error("Division by zero"); return a / b; }',
    language: 'javascript',
    minConfidence: 0.6,
  },
  {
    name: 'add async/await',
    code: 'function fetchData() { return fetch("/api"); }',
    edit: 'async function fetchData() { return await fetch("/api"); }',
    language: 'javascript',
    minConfidence: 0.6,
  },
];

for (const c of cases) {
  test(`API: ${c.name}`, async () => {
    const r = await new AgentBooster().apply({ code: c.code, edit: c.edit, language: c.language });
    assert.equal(r.success, true, `success should be true, got ${JSON.stringify(r)}`);
    assert.equal(r.output, c.edit, 'output should be exactly the edit');
    assert.notEqual(r.strategy, 'failed');
    assert.ok(r.confidence >= c.minConfidence, `confidence ${r.confidence} < ${c.minConfidence}`);
  });

  test(`CLI: ${c.name}`, () => {
    const p = spawnSync(process.execPath, [cli, 'apply', '--language', c.language], {
      input: JSON.stringify({ code: c.code, edit: c.edit }),
      encoding: 'utf-8',
      timeout: 30000,
    });
    assert.equal(p.status, 0, `CLI exited ${p.status}: ${p.stdout}${p.stderr}`);
    const r = JSON.parse(p.stdout);
    assert.equal(r.success, true);
    assert.equal(r.output, c.edit);
    assert.ok(r.confidence >= c.minConfidence, `confidence ${r.confidence} < ${c.minConfidence}`);
  });
}

test('vague instruction is still rejected and leaves code unchanged', async () => {
  const r = await new AgentBooster().apply({ code: 'var x = 1;', edit: 'improve this code', language: 'javascript' });
  assert.equal(r.success, false);
  assert.equal(r.output, 'var x = 1;');
});

test('unknown language falls back to JavaScript instead of failing', async () => {
  const r = await new AgentBooster().apply({ code: 'var x = 1;', edit: 'const x = 1;', language: 'jsx' });
  assert.equal(r.success, true);
  assert.equal(r.output, 'const x = 1;');
});
