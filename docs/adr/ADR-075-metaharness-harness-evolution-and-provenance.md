# ADR-075: Harness Self-Evolution (Darwin) and Agent-Config Provenance (Witness Manifest)

**Status**: Accepted, partially superseded by ADR-077. Darwin remains available
through SDK/CLI, but is no longer a default MCP capability; MCP execution now
requires the `admin` profile plus explicit Darwin opt-in.
**Date**: 2026-06-23
**Decision Makers**: RUV, Claude Flow Team
**Related**: ADR-073 (Cost-Optimal Router), ADR-074 (Darwin TDR), ADR-076 (Meta-Harness Repositioning)
**Affected packages**: `agentic-flow` (`src/harness/`, `src/mcp/tools/`)
**Implementation**: `src/harness/provenance.ts`, `src/mcp/tools/harness-tools.ts` (registered in `src/mcp/standalone-stdio.ts`), `tests/harness/provenance.test.ts`

## Context

Two lower-frequency but strategically useful capabilities from the `metaharness` ecosystem are not yet present in `agentic-flow`:

1. **Harness self-evolution** — `@metaharness/darwin`'s core loop ("freeze the model, evolve the harness") mutates one of **seven policy surfaces** (`planner`, `contextBuilder`, `reviewer`, `retryPolicy`, `toolPolicy`, `memoryPolicy`, `scorePolicy`), tests each in a sandbox, and keeps only what _measurably_ improves — building an archive (a tree, not a single best branch). Reported lifts on a frozen model (e.g. `finalScore 0.765 → 0.985`, ADR-103) come from evolving policy, not swapping models.

2. **Provenance / integrity** — the `metaharness` scaffolder ships `harness sign / verify / doctor`: an Ed25519 **witness manifest** over a harness's agent/skill/command files.

### Prior art on the orchestration side

`claude-flow` **already exposes `metaharness_*` MCP tools** (`metaharness_evolve`, `_bench`, `_score`, `_genome`, `_threat_model`, `_security_bench`, `_drift_from_history`, `_similarity`, `_mcp_scan`, `_oia_audit`, `_audit_list`, `_audit_trend`). The wiring pattern for surfacing Darwin through MCP is therefore proven; `agentic-flow` can mirror it.

`agentic-flow`'s seven Darwin surfaces map conceptually onto its existing agent prompt/policy configuration (planner, context selection, reviewer, retry/tool/memory policy), and it already has a benchmark suite (`bench/`, `benchmarks/`, `benchmark-results/`) to evolve against.

## Decision

Adopt both, in two tracks:

### Track A — Harness self-evolution as MCP tools (mirror claude-flow)

Expose Darwin's `evolve()` and scoring through `agentic-flow`'s MCP server in `src/mcp/`, mirroring claude-flow's `metaharness_*` naming. Evolve agent harness policy against the existing benchmark suite, persisting the archive under `.metaharness/` per Darwin's convention. All evolutionary mechanisms stay **opt-in and additive** (Darwin's default-path runs are byte-reproducible).

### Track B — Agent-config provenance

Adopt `harness sign / verify` to produce a signed witness manifest over agent/skill/command configs. Run `verify` in CI and optionally as a pre-publish gate, complementing the security work in PR #170 (CWE-78). `harness doctor` becomes a smoke-check for generated/edited harness configs.

## Consequences

**Positive**

- Self-improving harness: measurable gains without changing the model or paying for a bigger one.
- Provenance/integrity for agent configs — tamper-evidence and supply-chain assurance.
- Reuses a proven MCP integration pattern (claude-flow) and Darwin's reproducible, sandboxed core.

**Negative / risks**

- Evolution requires a trustworthy benchmark to score against; a weak benchmark evolves toward the wrong objective. Gate promotions on the frozen kernel scorer + safety clauses Darwin already enforces.
- MCP surface area grows; keep tools opt-in and documented.
- Signing introduces key management (Ed25519) — must define where keys live and CI verification policy.

**Neutral**

- Both tracks are opt-in; no change to default agent behavior.

## Scope note

The full `metaharness` **scaffolder + host adapters** (claude-code / codex / hermes / rvm harness emission) is **deliberately out of scope** here — it overlaps `agentic-flow`'s own `init`/agent system and is a generator, not a runtime library. Revisit only if emitting portable, host-targeted harnesses becomes a product goal. This ADR adopts only the runtime-relevant pieces: `evolve` (Track A) and `sign/verify` (Track B).
