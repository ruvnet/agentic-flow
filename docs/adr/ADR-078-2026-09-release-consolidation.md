# ADR-078: September 2026 Release Consolidation — PR Triage and Windows ONNX Fix

**Status:** Accepted
**Date:** 2026-09-16
**Related:** ADR-071 through ADR-077

## Context

By mid-September 2026, `agentic-flow` had accumulated 20 open pull requests
spanning from November 2025 to August 2026 — a mix of real, still-live bug
fixes; PRs that had been independently superseded by later work on `main`
without anyone closing them; two accidental cross-fork PRs unrelated to this
project's purpose; and one draft Windows fix whose core change was correct
but had drifted out of sync with a dependency migration that happened after
it was opened. None of this had been triaged in months, and the actual bug
each PR targeted was not tracked anywhere once the PR itself went stale.

Reviewed systematically (five parallel review passes, each verifying its
PRs against current `main` rather than trusting the PR description alone —
running test suites, checking `git merge-tree` for real conflicts, and in
one case reproducing an author's account/PR history to confirm a spam
pattern):

## Decision

**Merged as-is (6):**
- #78 — ESM `__dirname` polyfill in `agentdb-cli.ts` (real runtime bug on
  `"type": "module"`, zero conflicts).
- #174 — migrate `agentic-jujutsu`'s branch operations to `jj bookmark`
  for jj ≥0.21 (bundled jj is 0.35.0); empirically confirmed the test
  suite goes from 5 failing to 0 failing.
- #160 — add the missing `darwin-arm64` optional dependency entry for
  `agentic-jujutsu` (confirmed still absent from `package.json` on `main`).
- #228 — fix the fully-local (no API key) path: `PROXY_PORT` threading,
  `--provider ollama` exclusion from cloud-provider checks, ONNX model
  path centralization on `MODEL_ROOT`/`PHI4_MODEL_PATH`.
- #166 — add `SECURITY.md` (template stub; content still needs filling in
  as a follow-up).
- #62 — add 32 example applications (self-contained, isolated to
  `docs/`/`examples/`/`packages/integrations/`).

**Rebased and merged (1, new PR #230):**
- #155's core fix (lazy-load `onnxruntime-node` instead of loading it at
  module-import time, which crashes on Windows environments where the
  native binding can't load — even for consumers like `reasoningbank` that
  never touch the ONNX router at all) was still correct and still needed.
  Its `@xenova/transformers` half no longer applied: `main` had since
  migrated fully to `@huggingface/transformers` (superseding #154). Rebased
  onto current `main` as PR #230, preserving the `PHI4_MODEL_PATH`
  centralization #228 introduced, and verified empirically with a stub
  module that records when `onnxruntime-node` actually loads — confirmed
  the bug reproduces pre-fix (loads on bare `import()`) and is fixed
  post-fix (loads only when a session is actually initialized).

**Closed as superseded (5):**
- #154 (`@xenova/transformers` → optional) — moot, `main` migrated off it
  entirely.
- #115 (RuVectorBackend string-ID mapping) — `packages/agentdb` was
  extracted into its own `ruvnet/agentdb` repository; the touched file no
  longer exists here. Bug may still be live there; not re-filed as part of
  this ADR.
- #121 (`SonaTrajectoryService` native API) — the target class no longer
  exists; the same concern is independently addressed by
  `SonaLearningBackend.js`, verified to call the correct native API.
- #126 (agentdb v2→v3 bump) — `main` is already past the proposed version.
- #163 (WebSocket socket reuse) — `main` fixed the identical bug
  independently in commit `7903f6e`.

**Closed as out of scope (1):**
- #67 ("Agentic Jujutsu updates") — despite the title, a 27,637-line
  speculative CI/CD orchestration subsystem with a diverged version
  lineage; needs a from-scratch design review, not a merge.

**Closed as spam/noise (3):**
- #222 — a link-domain swap whose stated justification (the original
  endpoint is broken) was verified false by testing it live; author
  account matches a bulk-PR-spam pattern.
- #165, #164 — personal-fork development artifacts (benchmark dumps, and
  in one case an entire unrelated sports-betting dashboard) opened against
  upstream by mistake; a few small legitimate fixes buried in #164 were
  called out for the author to resubmit cleanly.

**Left open, not merged (1):**
- #134 (ADR-071 addition) — content is legitimate but the branch is 768
  files stale/conflicting against current `main`, including accidentally
  committed build artifacts; commented asking for a rebase down to just
  the doc.

## Consequences

- The Windows-crash bug (module-import-time `onnxruntime-node` load) is
  fixed for real, not just documented as "known" — verified with a
  reproducible before/after test, not by reading the diff and assuming it
  works.
- Five PRs' worth of already-fixed concerns (agentdb v2→v3, SonaTrajectoryService,
  xenova migration, WebSocket reuse) no longer sit open, misleading future
  contributors into thinking those bugs are still unaddressed.
- Two real, unresolved concerns surfaced during this pass are tracked, not
  silently dropped: `RuVectorBackend`'s possible string-ID mapping issue
  (now `ruvnet/agentdb`'s to inherit) and a reproducible npm/arborist
  crash blocking `npm audit fix` and lockfile-free installs (filed as
  issue #231) — the latter currently blocks roughly 20 non-breaking
  dependency-vulnerability fixes that `npm audit` reports as available but
  which no local tooling can currently apply.
- What this ADR does **not** do: fix `agentic-flow`'s broader dependency
  security posture (2 critical/26 high/29 moderate findings per `npm
  audit`, most transitive) — that remediation is blocked on issue #231
  and is out of scope for a PR-triage pass. It also does not address
  `#958`'s (RuVector) OAuth connector work, which remains a draft pending
  a `redirect_uri` allowlist fix.
