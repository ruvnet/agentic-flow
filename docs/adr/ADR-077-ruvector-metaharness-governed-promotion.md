# ADR-077: Ruvector MetaHarness Facade and Governed Promotion

**Status:** Accepted  
**Date:** 2026-07-29  
**Related:** ADR-073, ADR-074, ADR-075

## Context

Agentic-flow directly loaded Darwin and exposed repair over MCP. Evaluation and
promotion were one trust domain, and benchmark identity was not cryptographically
bound to the candidate. This permits stale evidence, benchmark substitution, or
an untrusted candidate job to become its own approver.

## Decision

1. Use `ruvector@0.2.40` as the lazy integration facade for the pinned
   MetaHarness stack: Darwin 0.8.0 and Flywheel 0.1.7.
2. Bind each evaluation to a project-local benchmark anchor containing corpus,
   embedding-space, real index-topology, and evaluator hashes.
3. Emit a deterministic evaluation receipt and proposal. Candidate jobs have no
   promotion credential.
4. Promotion requires a commit-scoped, expiring Ed25519 authorization from a
   trusted key and an atomic compare-and-swap against the evaluated baseline
   generation.
5. Retain proposal, authorization, and promotion record as a replay bundle.
6. MCP defaults to `readonly`. Profiles are `readonly`, `retrieval`, `learning`,
   and `admin`; denied tools are omitted from discovery and dispatch. Darwin is
   available only when both the `admin` profile and
   `AGENTIC_FLOW_MCP_ENABLE_DARWIN=true` are selected.
7. SDK/CLI Darwin calls still require the facade's explicit `{ execute: true }`.
8. Replace abandoned `@xenova/transformers` with
   `@huggingface/transformers` 3.x. Release validation must import it with remote
   model loading disabled so packaging is checked without network access.
9. The package currently ships Claude settings, not a Codex hook manifest. In
   response to upstream issue #2855, any future Codex hook manifest is rejected
   from release packaging until it passes Codex's strict manifest schema; unknown
   compatibility fields must not be emitted.

## Consequences

Research infrastructure remains lazy. An evaluation cannot silently promote
itself, anchor drift changes receipt identity, stale promotions fail the store
CAS, and replay can validate signer, receipt, and lineage. Node.js 20 becomes the
minimum supported runtime, matching ruvector.

## Acceptance

- Changing only embedding-space identity changes the anchor and receipt hashes.
- Tampered or expired authorization cannot promote.
- Two proposals racing from one baseline allow at most one CAS.
- Default MCP discovery contains no mutation or Darwin execution tool.
- Darwin 0.8 and Flywheel 0.1.7 are reported through the ruvector facade.
