# Changelog

All notable changes to this project will be documented in this file.

## [2.1.5] - 2026-10-26

### Security

- `FederationHubServer` now verifies the agent token (HMAC JWT, secret from `jwtSecret` or `JWT_SECRET`) and takes agent and tenant identity from it; it used to accept any non-empty token. The hub also listens on `127.0.0.1` unless `host` is set. **Breaking for hub users:** agents need a token signed with the hub's secret, so set `JWT_SECRET` on both sides (#242).

## [2.1.0] - 2026-06-23

### Added

- **Cost-optimal model routing (ADR-073).** New `CostOptimalRouter`
  (`src/router/cost-optimal-router.ts`) wrapping
  [`@metaharness/router`](https://www.npmjs.com/package/@metaharness/router):
  routes each query to the _cheapest model predicted to clear a quality bar_,
  learned from eval logs via k-NN / kernel-ridge (optional native FastGRNN via
  the already-bundled `@ruvector/tiny-dancer`). Build from a flat
  `(embedding → per-model quality)` dataset or explicit candidates; resolves
  `"<provider>/<model>"` ids to concrete provider/model bindings.
- **`ModelRouter.enableCostOptimalRouting({ router, embed })`** adds a new
  `'cost-optimal'` routing mode that embeds the query, picks the cost-optimal
  model, and steers `params.model` — with a graceful fallback to the existing
  cost heuristic when unconfigured or on error (routing never hard-fails). The
  previous rule-based `'cost-optimized'` mode is unchanged.
- Bounded LRU embedding cache on the cost-optimal hot path (embedding dominates
  latency vs the µs-scale k-NN; recurring prompts are common).
- Benchmark (`benchmarks/cost-optimal-router-benchmark.mjs`) and tests
  (`tests/router/cost-optimal-router.test.ts`). Measured on a 3-tier lineup
  (1000-query held-out test, bar=0.8): **28.5% cheaper than always-opus** while
  holding **98.1%** of queries at/above the bar; routing latency **p50 73µs /
  p99 125µs**.
- **Autonomous repair via Darwin Mode (ADR-074).** New `repair()` wrapper
  (`src/repair/darwin-repair.ts`) and `agentic-flow-repair` CLI over
  [`@metaharness/darwin`](https://www.npmjs.com/package/@metaharness/darwin):
  freeze the model and evolve the harness (planner/context/reviewer/retry/tool/
  memory/score policy), keeping only variants that measurably improve under a
  frozen scorer + safety gate. Defaults to Test-Driven Repair (`'real'` sandbox —
  the repo's own tests gate promotion, run shell-free with a scrubbed env);
  `'mock'` is a deterministic, Docker-free substrate for hermetic tests. The full
  SWE-bench-Lite TDR product (Docker grading) is run via Darwin's own CLI — see
  ADR-074. New exports `agentic-flow/repair` and `agentic-flow/router/cost-optimal`.
- **Harness evolution MCP tools + provenance (ADR-075).** New `harness_repair`,
  `harness_manifest`, and `harness_verify` MCP tools (`src/mcp/tools/harness-tools.ts`,
  registered in the stdio server), mirroring claude-flow's `metaharness_*`. Plus an
  Ed25519 **witness manifest** module (`src/harness/provenance.ts`, exported as
  `agentic-flow/harness/provenance`): sign a sha256 manifest over harness/agent
  config files and verify it + on-disk drift — built on Node's `crypto`, no deps.
- **Repositioned as the agentic meta-harness (ADR-076)** — README hero +
  four-pillar framing (route / evolve / orchestrate / verify), `package.json`
  description and keywords. Docs/positioning only; no behavior change.
- ADR-073/074/075/076 documenting the metaharness integration (all implemented).

### Dependencies

- Added `@metaharness/router` and `@metaharness/darwin` (both dependency-free;
  optional `@ruvector/tiny-dancer` peer already present).

## [2.0.15] - 2026-06-23

### Fixed

- **#167 — `agentic-flow/agent-booster` subpath export pointed at a missing file.**
  The `./agent-booster` export resolved to `dist/agent-booster/index.js`, which
  was never emitted (the booster code lives under `intelligence/` and
  `optimizations/`), so `import 'agentic-flow/agent-booster'` failed with
  `ERR_MODULE_NOT_FOUND`. Added the missing barrel entrypoint
  (`src/agent-booster/index.ts`) which re-exports the booster API and provides
  the documented `AgentBooster` name (alias of `EnhancedAgentBooster`).
- **#162 — WebSocket fallback transport: stale-route `EHOSTUNREACH` after idle
  on a direct point-to-point link.** `WebSocketFallbackTransport` now reuses an
  already-open inbound (server-accepted) socket for replies before dialing a
  fresh outbound connection — the full-duplex inbound direction stays healthy
  when a new outbound dial would hit a per-process stale scoped route. Added a
  liveness ping/pong heartbeat that terminates stale sockets, driven by
  `maxIdleTimeoutMs` (previously accepted but unused — ping cadence is 1/6 of
  it, default 30000ms → 5000ms).

### Notes

- **#146 (Ollama provider in config-wizard)** was already resolved in the 2.0.x
  line: `OLLAMA_API_KEY`, `OLLAMA_BASE_URL`, and `'ollama'` are accepted by the
  config wizard. The remaining asks in that issue (agentdb controller
  prerequisites) are tracked in the `agentdb` package.

## [2.0.1-alpha.4] - 2025-12-03

### Added

- **SONA v0.1.4 Federated Learning Integration**: Complete integration with AgentDB
  - Updated AgentDB dependency to 2.0.0-alpha.2.16
  - Full support for `EphemeralLearningAgent`, `FederatedLearningCoordinator`, and `FederatedLearningManager`
  - Quality-based filtering and weighted aggregation
  - Large-scale federation (50+ agents with configurable limits)

### Changed

- **Dependencies Updated**:
  - `agentdb`: 2.0.0-alpha.2.15 → 2.0.0-alpha.2.16 (SONA v0.1.4 federated learning)

### Documentation

- Comprehensive federated learning guide available in AgentDB package
- 5 detailed use cases for distributed learning
- API documentation and performance tuning recommendations

### Tested

- ✅ Complete federated learning workflow with 50+ agents
- ✅ Quality filtering and weighted consolidation
- ✅ Multi-agent coordination and automatic aggregation
- ✅ All test suites passing

---

## [1.10.2] - 2025-01-10

### Fixed

- **Critical Bug**: Fixed ANTHROPIC_API_KEY overriding `--provider` CLI argument ([#60](https://github.com/ruvnet/agentic-flow/issues/60))
  - CLI arguments (`--provider`, `--openrouter-key`, `--anthropic-key`, `--model`) now properly propagate to environment variables
  - Removed silent fallback to `ANTHROPIC_API_KEY` for non-Anthropic providers (OpenRouter, Gemini, Requesty)
  - Added proper validation requiring provider-specific API keys with helpful error messages
  - CLI arguments now correctly override environment variables as expected

### Added

- Comprehensive test suite for provider CLI argument handling
- Clear error messages when provider-specific API keys are missing
- Logging for provider selection from CLI arguments

### Changed

- **Breaking Change**: Providers now require their specific API keys (no fallback to ANTHROPIC_API_KEY)
  - OpenRouter requires `OPENROUTER_API_KEY` or `--openrouter-key`
  - Gemini requires `GOOGLE_GEMINI_API_KEY`
  - Requesty requires `REQUESTY_API_KEY`
  - Anthropic continues to require `ANTHROPIC_API_KEY` or `--anthropic-key`

### Migration Guide

If you were relying on the fallback behavior:

```bash
# Before (relied on ANTHROPIC_API_KEY fallback)
export ANTHROPIC_API_KEY=sk-ant-...
npx agentic-flow --provider openrouter --task "test"

# After (requires provider-specific key)
export OPENROUTER_API_KEY=sk-or-...
npx agentic-flow --provider openrouter --task "test"

# Or use CLI argument
npx agentic-flow --provider openrouter --openrouter-key sk-or-... --task "test"
```

## [1.10.0] - Previous Release

- See git history for previous changes
