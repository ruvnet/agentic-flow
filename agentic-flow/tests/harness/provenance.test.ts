/**
 * Tests for harness provenance + harness MCP tools (ADR-075).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateKeyPairPem,
  buildManifest,
  signManifest,
  verifyManifest,
  signFiles,
  verifySignedManifest,
  sha256Hex,
} from '../../src/harness/provenance.js';
import { harnessManifestTool, harnessVerifyTool, HARNESS_TOOLS, registerHarnessTools } from '../../src/mcp/tools/harness-tools.js';

let dir: string;
let fileA: string;
let fileB: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-prov-'));
  fileA = join(dir, 'a.txt');
  fileB = join(dir, 'b.txt');
  writeFileSync(fileA, 'alpha');
  writeFileSync(fileB, 'beta');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('harness provenance — Ed25519 witness manifest', () => {
  it('sha256Hex is stable and content-addressed', () => {
    expect(sha256Hex('alpha')).toBe(sha256Hex(Buffer.from('alpha')));
    expect(sha256Hex('alpha')).not.toBe(sha256Hex('beta'));
  });

  it('builds a manifest sorted by path (canonical, order-independent)', () => {
    const m1 = buildManifest([fileB, fileA]);
    const m2 = buildManifest([fileA, fileB]);
    expect(m1.entries.map((e) => e.path)).toEqual([fileA, fileB]);
    expect(m1).toEqual(m2); // input order does not affect the manifest
  });

  it('signs and verifies a manifest round-trip', () => {
    const { publicKey, privateKey } = generateKeyPairPem();
    const manifest = buildManifest([fileA, fileB], { createdAt: '2026-06-23T00:00:00Z' });
    const sig = signManifest(manifest, privateKey);
    expect(verifyManifest(manifest, sig, publicKey)).toBe(true);
  });

  it('rejects a tampered manifest or a wrong key', () => {
    const { publicKey, privateKey } = generateKeyPairPem();
    const other = generateKeyPairPem();
    const manifest = buildManifest([fileA, fileB]);
    const sig = signManifest(manifest, privateKey);

    const tampered = { ...manifest, entries: [{ path: fileA, sha256: 'deadbeef' }, manifest.entries[1]] };
    expect(verifyManifest(tampered, sig, publicKey)).toBe(false);
    expect(verifyManifest(manifest, sig, other.publicKey)).toBe(false);
    expect(verifyManifest(manifest, 'not-base64-sig', publicKey)).toBe(false);
  });

  it('verifySignedManifest detects on-disk drift after signing', () => {
    const { publicKey, privateKey } = generateKeyPairPem();
    const signed = signFiles([fileA, fileB], privateKey, publicKey, { createdAt: '2026-06-23T00:00:00Z' });

    const clean = verifySignedManifest(signed);
    expect(clean.signatureValid).toBe(true);
    expect(clean.filesIntact).toBe(true);
    expect(clean.drift).toHaveLength(0);

    writeFileSync(fileA, 'alpha-modified'); // tamper on disk
    const drifted = verifySignedManifest(signed);
    expect(drifted.signatureValid).toBe(true); // signature still valid over the original digests
    expect(drifted.filesIntact).toBe(false); // but disk no longer matches
    expect(drifted.drift.map((d) => d.path)).toEqual([fileA]);
    writeFileSync(fileA, 'alpha'); // restore for other tests
  });
});

describe('harness MCP tools (ADR-075)', () => {
  it('registers capability inspection plus the three harness tools', () => {
    const names: string[] = [];
    registerHarnessTools({ addTool: (t) => names.push(t.name) });
    expect(names).toEqual(['harness_capabilities', 'harness_repair', 'harness_manifest', 'harness_verify']);
    expect(HARNESS_TOOLS).toHaveLength(4);
  });

  it('harness_manifest builds digests for the given files', async () => {
    const out = JSON.parse(await harnessManifestTool.execute({ files: [fileA, fileB] }));
    expect(out.version).toBe(1);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0].sha256).toBe(sha256Hex('alpha'));
  });

  it('harness_verify reports a valid, intact signed manifest', async () => {
    const { publicKey, privateKey } = generateKeyPairPem();
    const signed = signFiles([fileA, fileB], privateKey, publicKey);
    const report = JSON.parse(await harnessVerifyTool.execute({ signed }));
    expect(report.signatureValid).toBe(true);
    expect(report.filesIntact).toBe(true);
  });
});
