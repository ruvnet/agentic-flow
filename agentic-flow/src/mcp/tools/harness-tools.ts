/**
 * Harness MCP tools (ADR-075, Track A): expose Darwin harness evolution/repair
 * and provenance over MCP, mirroring the orchestration-side `metaharness_*` tools
 * already present in claude-flow.
 *
 * Each tool validates its own args with its zod schema (so `execute` can be
 * unit-tested by calling it with a plain object), and returns a JSON string —
 * the FastMCP content convention used elsewhere in this server.
 *
 * @see docs/adr/ADR-075-metaharness-harness-evolution-and-provenance.md
 */

import { z } from 'zod';
import { repair } from '../../repair/darwin-repair.js';
import { buildManifest, verifySignedManifest, type SignedManifest } from '../../harness/provenance.js';
import { getMetaHarnessCapabilities } from '../../harness/metaharness.js';

/** Minimal FastMCP-compatible tool descriptor (subset we use + test). */
export interface HarnessTool {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown) => Promise<string>;
}

const repairParams = z.object({
  repoRoot: z.string().describe('Path to the repo to evolve/repair'),
  generations: z.number().int().positive().optional().describe('Generations to run (default 3)'),
  children: z.number().int().positive().optional().describe('Children per parent per generation (default 4)'),
  seed: z.number().int().optional().describe('Deterministic seed (default 0)'),
  sandboxMode: z
    .enum(['real', 'mock', 'agent'])
    .optional()
    .describe("Evaluation substrate: 'real' (test-driven, default), 'mock' (deterministic/Docker-free), 'agent'"),
});

export const harnessRepairTool: HarnessTool = {
  name: 'harness_repair',
  description:
    'Evolve/repair a repo with Darwin Mode (ADR-074): freeze the model, evolve the harness; keep only variants that measurably improve under a frozen scorer + safety gate. Default sandbox "real" gates on the repo tests; "mock" is deterministic and Docker-free.',
  parameters: repairParams,
  execute: async (raw: unknown): Promise<string> => {
    const a = repairParams.parse(raw);
    const res = await repair({
      repoRoot: a.repoRoot,
      generations: a.generations,
      childrenPerGeneration: a.children,
      seed: a.seed,
      sandboxMode: a.sandboxMode,
    });
    return JSON.stringify(
      {
        improved: res.improved,
        winnerId: res.winnerId,
        winnerLineage: res.winnerLineage,
        baselineScore: res.baselineScore,
        winnerScore: res.winnerScore,
        deltaOverBaseline: res.deltaOverBaseline,
        generations: res.generations,
        variantsEvaluated: res.variantsEvaluated,
      },
      null,
      2,
    );
  },
};

const manifestParams = z.object({
  files: z.array(z.string()).min(1).describe('Files to include in the provenance manifest'),
  createdAt: z.string().optional().describe('Optional ISO timestamp to embed in the manifest'),
});

export const harnessManifestTool: HarnessTool = {
  name: 'harness_manifest',
  description:
    'Build a provenance manifest (sha256 per file) over harness/agent config files (ADR-075). Sign it locally with the agentic-flow/harness provenance API to produce an Ed25519 witness.',
  parameters: manifestParams,
  execute: async (raw: unknown): Promise<string> => {
    const a = manifestParams.parse(raw);
    return JSON.stringify(buildManifest(a.files, { createdAt: a.createdAt }), null, 2);
  },
};

const signedManifestSchema = z.object({
  manifest: z.object({
    version: z.literal(1),
    createdAt: z.string().optional(),
    entries: z.array(z.object({ path: z.string(), sha256: z.string() })),
  }),
  signature: z.string(),
  publicKey: z.string(),
});

const verifyParams = z.object({
  signed: signedManifestSchema.describe('A signed manifest bundle { manifest, signature, publicKey }'),
});

export const harnessVerifyTool: HarnessTool = {
  name: 'harness_verify',
  description:
    'Verify a signed harness manifest (Ed25519) and report on-disk drift vs the signed digests (ADR-075). Returns { signatureValid, filesIntact, drift }.',
  parameters: verifyParams,
  execute: async (raw: unknown): Promise<string> => {
    const a = verifyParams.parse(raw);
    return JSON.stringify(verifySignedManifest(a.signed as SignedManifest), null, 2);
  },
};

export const harnessCapabilitiesTool: HarnessTool = {
  name: 'harness_capabilities',
  description: 'Report the pinned ruvector MetaHarness capabilities and whether each lazy runtime is available.',
  parameters: z.object({}),
  execute: async (): Promise<string> => JSON.stringify(await getMetaHarnessCapabilities(), null, 2),
};

export const HARNESS_TOOLS: readonly HarnessTool[] = [
  harnessCapabilitiesTool,
  harnessRepairTool,
  harnessManifestTool,
  harnessVerifyTool,
];

/** Register all harness tools on a FastMCP-compatible server. */
export function registerHarnessTools(server: { addTool: (tool: HarnessTool) => void }): void {
  for (const tool of HARNESS_TOOLS) server.addTool(tool);
}
