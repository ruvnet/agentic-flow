/**
 * Darwin Repair — autonomous harness evolution / Test-Driven Repair (ADR-074).
 *
 * A typed wrapper over `@metaharness/darwin`'s `evolve()`: freeze the model and
 * evolve the harness around it (planner / context / reviewer / retry / tool /
 * memory / score policy), keeping only variants that *measurably* improve under
 * a frozen, reproducible scorer + safety gate.
 *
 * Modes (via `sandboxMode`):
 *   - 'real'  (default) — Test-Driven Repair: the repo's own test command is the
 *               oracle, run in Darwin's shell-free, env-scrubbed sandbox.
 *   - 'mock'  — deterministic, surface-driven loop. No repo test, no Docker,
 *               no network — used for hermetic smoke tests of the pipeline.
 *   - 'agent' — runs the variant's real surface code (Node ≥ 22).
 *
 * NOTE: the headline SWE-bench-Lite TDR *product* (≈68.3% with-test) additionally
 * needs the official `swebench` Docker harness for issue checkout + grading — see
 * ADR-074 for that deployment path. This wrapper exposes the runnable `evolve()`
 * core that does not require Docker.
 *
 * @see docs/adr/ADR-074-metaharness-darwin-test-driven-repair.md
 */

import { resolve } from 'node:path';
import { runMetaHarnessDarwin } from '../harness/metaharness.js';

interface ArchiveRecord {
  score?: { finalScore?: number };
}

interface EvolutionResult {
  baseline: ArchiveRecord | null;
  winner: ArchiveRecord | null;
  winnerLineage: string[];
  generations: number;
  records: ArchiveRecord[];
}

export type SandboxMode = 'real' | 'mock' | 'agent';

export interface RepairOptions {
  /** Path to the repo to repair/evolve. */
  repoRoot: string;
  /** Work tree for Darwin artifacts. Default `<repoRoot>/.metaharness`. */
  workRoot?: string;
  /** Generations to run. Default 3. */
  generations?: number;
  /** Children produced per parent per generation. Default 4. */
  childrenPerGeneration?: number;
  /** Max variants evaluated concurrently. Default 4. */
  concurrency?: number;
  /** Minimum finalScore margin a child must beat its parent by. Default 0.05. */
  promotionDelta?: number;
  /** Deterministic seed. Default 0. */
  seed?: number;
  /** Fixed scoring tasks (the variant cannot edit these). Defaults to REPAIR_TASKS. */
  tasks?: string[];
  /** Evaluation substrate. Default 'real' (Test-Driven Repair). */
  sandboxMode?: SandboxMode;
  /** Per-variant test-command wall-clock budget (ms). Default Darwin's 120000. */
  taskTimeoutMs?: number;
}

export interface RepairResult {
  /** True iff a child beat the baseline and was promoted. */
  improved: boolean;
  /** Winner variant id (lineage tail), or null when nothing beat the baseline. */
  winnerId: string | null;
  /** baseline → … → winner ids. */
  winnerLineage: string[];
  /** Baseline finalScore (0 if unevaluated). */
  baselineScore: number;
  /** Winner finalScore, or null. */
  winnerScore: number | null;
  /** winnerScore − baselineScore. */
  deltaOverBaseline: number;
  generations: number;
  /** Total variants in the archive (baseline + descendants). */
  variantsEvaluated: number;
  /** Full Darwin result for callers that need the archive/traces. */
  raw: EvolutionResult;
}

/** Default scoring tasks for a repair run. */
export const REPAIR_TASKS: readonly string[] = [
  'run repository test suite',
  'verify generated harness safety',
  'check trace quality',
];

function finalScoreOf(record: ArchiveRecord | null): number | null {
  return record?.score?.finalScore ?? null;
}

/**
 * Run an autonomous repair/evolution pass over a repo and return a friendly
 * summary. Defaults to Test-Driven Repair ('real' sandbox): the repo's own
 * tests gate every promotion.
 */
export async function repair(opts: RepairOptions): Promise<RepairResult> {
  const repoRoot = resolve(opts.repoRoot);
  const config = {
    repoRoot,
    workRoot: opts.workRoot ? resolve(opts.workRoot) : resolve(repoRoot, '.metaharness'),
    generations: opts.generations ?? 3,
    childrenPerGeneration: opts.childrenPerGeneration ?? 4,
    tasks: opts.tasks ? [...opts.tasks] : [...REPAIR_TASKS],
    promotionDelta: opts.promotionDelta ?? 0.05,
    concurrency: opts.concurrency ?? 4,
    seed: opts.seed ?? 0,
    sandboxMode: opts.sandboxMode ?? 'real',
    ...(opts.taskTimeoutMs ? { taskTimeoutMs: opts.taskTimeoutMs } : {}),
  };

  const result = await runMetaHarnessDarwin(config, { execute: true }) as EvolutionResult;

  const baselineScore = finalScoreOf(result.baseline) ?? 0;
  const winnerScore = finalScoreOf(result.winner);
  const delta = (winnerScore ?? baselineScore) - baselineScore;
  // winnerLineage is baseline → … → winner, so the tail is the winner id.
  const winnerId = result.winner ? result.winnerLineage[result.winnerLineage.length - 1] ?? null : null;

  return {
    improved: result.winner != null && delta > 0,
    winnerId,
    winnerLineage: result.winnerLineage,
    baselineScore,
    winnerScore,
    deltaOverBaseline: delta,
    generations: result.generations,
    variantsEvaluated: result.records.length,
    raw: result,
  };
}

/** Reusable repair runner with bound defaults (e.g. a fixed sandbox mode). */
export class DarwinRepair {
  constructor(private readonly defaults: Partial<RepairOptions> = {}) {}

  repair(opts: RepairOptions): Promise<RepairResult> {
    return repair({ ...this.defaults, ...opts });
  }
}
