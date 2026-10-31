# Changelog

All notable changes to this project will be documented in this file.

## [3.1.0] - 2026-10-31

Fixes two correctness bugs left after 3.0.0 and brings the docs in line with its proxy auth. See ADR-080.

### Changed
- **One embedding space per process (#246).** A failed model load used to be retried on the next call, so one process could hold hash-fallback vectors and model vectors side by side and compare them (cosine of the same text across the two was ~0.03). The first embedding now fixes the space:
  - a failed load is **not retried automatically**; the process stays on hash vectors and `isSemanticEmbedding()` stays false;
  - if the model fails on a text **after model vectors were produced**, `computeEmbedding`/`computeEmbeddingBatch` **throw** instead of returning a hash vector. `retrieveMemories` and `distillMemories` propagate that error;
  - new `resetEmbeddingBackend()` clears the choice and the cache so the model is tried again (re-embed anything you kept); new `getEmbeddingKind()` returns `'local'`, `'hash'` or `null`.

### Security
- **`.claude/statusline.mjs` ran `npx agentic-flow@alpha mcp status` on every refresh**, which executes the deprecated March 3.0.0-alpha line (and its critical `protobufjs` advisory). It now asks only the project's own `node_modules/.bin/agentic-flow`, without a shell, and shows the idle marker when there is none.
- **`hooks init` pre-approved `Bash(npx:*)`, `Bash(npm run:*)` and the whole `agentic-flow`, `claude-flow` and `ruv-swarm` MCP servers**, so any package or tool ran without a prompt. It now allows only `Bash(agentic-flow:*)`, as `init` has since 3.0.0. Re-run `hooks init --force` in existing projects.
- **`hooks init` wrote unversioned `npx agentic-flow …` hooks**, which resolve to whatever `@latest` is that day. They now pin the installed version, as `init` has since 3.0.0. The `swarm` commands print a pinned `swarm connect` line instead of `@alpha`, and `scripts/validate-providers.sh`, the versioned `docs/docker-tests` Dockerfiles and the worker skills pin too. The version comes from a shared `src/utils/package-version.ts`, which throws instead of falling back to a tag.

### Fixed
- `.claude/statusline.mjs` no longer crashes when Claude Code passes `model` as `{ id, display_name }`; it shows `display_name ?? id` and still accepts a string.
- The Gemini and Requesty proxies' streams no longer drop an SSE line split across reads or corrupt a multibyte character split across chunks (3.0.0 fixed only OpenRouter). All three now share `src/proxy/sse-lines.ts`; the Gemini proxy also strips CR from its CRLF lines.

### Docs
- The proxy guides (`STANDALONE_PROXY_GUIDE`, `CLAUDE-CODE-INTEGRATION`, `PROXY-ARCHITECTURE-AND-EXTENSION`, both copies) and the shipped Requesty plans sent a dummy key that the 3.0.0 proxies reject. They now use the token the proxy prints and document `AGENTIC_FLOW_PROXY_TOKEN` and `AGENTIC_FLOW_PROXY_HOST`; the extension guide's template uses the `proxy-auth` helpers.
- The READMEs and the skills in `.claude/skills` ran `npx agentic-flow@alpha`, which resolves to the March 3.0.0-alpha line. They pin `agentic-flow@3.1.0`, and a test keeps that pin equal to the package version.

## [3.0.0] - 2026-10-31

First stable 3.x. It is the main line (2.1.5) plus a security and correctness review; it supersedes 3.0.0-alpha.1/.2, which were built from a different tree. Published without an alpha dist-tag (ruflo ADR-513/515).

### Breaking
- **Agents no longer bypass permissions.** By default only Read/Glob/Grep/TodoWrite are auto-approved; Bash/Write/Edit/WebFetch are denied in headless runs, including the `agentic_flow_agent` MCP tool. The old default let a prompt injection reach an unprompted Bash agent through that tool, which `init` also auto-approved. Opt back in with `AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS=1` (logs a warning).
- **Translation proxies (OpenRouter, Gemini, Requesty, Ollama) bind `127.0.0.1` and require a per-run token** as `x-api-key` or `Authorization: Bearer`. They used to listen on every interface with no auth, so anyone on the network could spend your provider key. The CLI hands the token to the agent automatically; the standalone `proxy` command prints it. New: `AGENTIC_FLOW_PROXY_TOKEN`, `AGENTIC_FLOW_PROXY_HOST`. Code that constructs `AnthropicTo*Proxy` directly must send `getAuthToken()`. `/health` stays open.
- **The HTTP/SSE MCP server binds `127.0.0.1` and requires a token.** New: `AGENTIC_FLOW_MCP_TOKEN` (generated and printed when unset), `AGENTIC_FLOW_MCP_HOST`, `AGENTIC_FLOW_MCP_PORT`, `AGENTIC_FLOW_MCP_ALLOWED_ORIGINS` (no browser origins by default).
- **`init`** pins hooks and the MCP server to the installed version (it ran `npx agentic-flow@alpha`), no longer pre-approves `npx`, `npm run` or whole MCP servers, and registers the server as `agentic-flow` (tool ids become `mcp__agentic-flow__*`). Re-run `init --force` in existing projects. It no longer copies `.claude/mcp.json`, which pointed at a developer-machine path.
- **Only `./.env` is read**, never a parent directory's. Endpoint keys (`*_BASE_URL`, `*_PROXY_*`, `HTTP(S)/ALL_PROXY`) and `AGENTIC_FLOW_ALLOW_*`/`AGENTIC_FLOW_MCP_*` are ignored from it with a warning: a cloned repo's `.env` could otherwise send your API key to its own endpoint. Export them, or pass `--env-file <path>`.
- **Router config** is read only from an explicit path, `AGENTIC_FLOW_ROUTER_CONFIG` or `~/.agentic-flow/router.config.json`, not from the working directory.
- Agent and command names are `[a-z0-9-]`; categories are such segments joined by `/`. The agent-booster file tools only touch files inside the working directory. The `readonly` MCP profile no longer includes `agent_booster_parse_markdown`.
- QUIC/WebSocket transport defaults to `127.0.0.1`, caps frames at 1 MiB, and `receive()` no longer returns messages an `onMessage` handler already consumed.
- Embeddings under `npx` are real: the npx heuristic that silently returned hash vectors is gone, so the first use downloads the MiniLM model (~23 MB). With no network it falls back to hash vectors as before; `isSemanticEmbedding()` says which you got.

### Security
- `statusline.sh` (copied by `init`) executed code from a repo's `.agentic-flow/intelligence.json` through awk; values are now validated. `github-safe.js` passed arguments through a shell; it now uses `execFileSync`.
- Path traversal in the agent and command creation tools, and arbitrary file writes in the agent-booster edit tools, are closed.
- `certs` and `.claude/settings*.json` (which set `defaultMode: bypassPermissions`) are no longer published.

### Fixed
- **Self-learning that actually learns.** ReasoningBank moves the confidence of the memories a task used toward that task's verdict and decays them on failure; retrieval no longer counts as a reward, and pruning considers low confidence regardless of use. agent-booster counts success only from `recordOutcome`, not from cache hits, and no longer returns another file's cached edit as a success.
- **AutopilotLearning is back** (`dist/coordination/autopilot-learning.js`). It shipped in 3.0.0-alpha.2 from an uncommitted tree and was missing from main; it now loads the real `agentdb` and reports unavailable honestly when it cannot.
- `computeEmbedding` no longer keeps the process alive for up to an hour (an unref'd LRU, no per-entry timers); `computeEmbeddingBatch` batches (256 texts: ~1.3 s → ~0.5 s).
- The OpenRouter proxy's stream no longer drops a line split across reads or corrupts multibyte characters.
- The SONA service imports without `@ruvector/sona` and without crashing in ESM.
- `ModelRouter.stream()` records metrics and falls back on a provider error before the first chunk; cost-optimal routing no longer mutates the caller's params.
- ReasoningBank logs go to stderr, not stdout.

### Dependencies
- `agentdb` ^3.0.0 (stable), `@huggingface/transformers` ^4.2 (3.8 pinned onnxruntime-node 1.21, whose install script fails on CUDA 13 hosts), `ruvector` ^0.3.3, `fastmcp` ^3.35 (3.21 crashed on every session with MCP SDK 1.30), `sharp` ^0.35.5.

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
