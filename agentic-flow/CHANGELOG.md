# Changelog

All notable changes to this project will be documented in this file.

## [3.5.5] - 2026-11-11

### Fixed
- **`hooks intelligence route|pattern-search|stats` and the matching MCP tools no longer claim HNSW.** The intelligence bridge builds the layer with HNSW off (published `ruvector` has no `HnswIndex`), so agent and pattern search is an exact cosine scan. Up to 3.5.4 the route tool always reported `engine: 'ruvector-sona-moe-hnsw'` and `features: [..., 'hnsw-search', 'moe-attention']`, stats reported `hnsw.enabled: true` and `speedup: '150x vs brute-force'`, and the command and tool descriptions said "HNSW (150x faster)". None of that was measured or true. `features` now lists only what ran (`cosine-search` or `hnsw-search`, plus `sona-microlora` and `moe-attention` when they were used), `engine` is derived from it, stats reports `hnsw.search: 'exact cosine scan'` in place of `speedup`, and pattern tools report `cosine`. Test: `tests/integrations/intelligence-route-claims.test.ts`, which fails on 3.5.4.
- `TinyDancerRouter` docs no longer describe a circuit breaker, hot-reload or latency figures it does not provide. The class is not reachable from any export or call path, and its native path targets an unpublished `@ruvector/tiny-dancer` API, so it always uses cosine routing.

### Repository
- `benchmarks/`: removed the fabricated v1.0 baseline (round timestamp, no samples), the vs-v1 "150x / 125x / 10x / 5x" targets and the regression, report and trend pipeline built on it, plus the vector-search bench written against an AgentDB API that no longer exists. The remaining suites are labelled synthetic (they time in-file reference classes), compile under strict `tsc`, and run in CI without `continue-on-error`. Not part of the npm package.
- Root `package.json`: removed `bench:quic`, `profile` (both ran a missing `benchmarks/quic-transport.bench.js`) and `bench:report` (missing `scripts/generate-benchmark-report.js`), plus the orphan `benchmarks/quic-transport.bench.ts`, which imported an undeclared `@fails-components/webtransport` and did not exercise agentic-flow's QUIC.
- `agentic-flow init` no longer writes "HNSW 150x faster" into the generated CLAUDE.md.

## [3.5.4] - 2026-11-10

### Security
- **Rebuilt `wasm/quic/agentic_flow_quic_bg.wasm` against `bytes` 1.12.1.** The QUIC wasm shipped in 3.5.3 was compiled with `bytes` 1.10.1, which is affected by RUSTSEC-2026-0007 (integer overflow in `BytesMut::reserve`). It is rebuilt from `crates/agentic-flow-quic` with `wasm-pack build --target nodejs --release -- --features wasm`; the exported API (`WasmQuicClient`, `createQuicMessage`, `defaultConfig`) is unchanged and `validation/test-quic-wasm.ts` passes. The bundled `wasm/reasoningbank` build contains no crate with an open advisory.
- Example lockfiles (`examples/crispr-cas13-pipeline`, `../examples/rights-preserving-platform`) no longer resolve crates with open RUSTSEC advisories. These examples are not part of the npm package.

## [3.5.3] - 2026-11-10

### Changed
- **Native attention on Raspberry Pi 4 again.** `@ruvector/attention` 2.3.1 ships a linux-arm64 binary built without RCPC (0 LDAPR instructions, needs GLIBC_2.34), so the floor is now `^2.3.1` (optional). The CPU check from 3.5.2 stays as defence in depth: on linux-arm64 the native binary loads when the CPU has `lrcpc` **or** the installed `@ruvector/attention-linux-arm64-gnu` is >= 2.3.1 (read from its package.json, without loading it). An older binary on a CPU without RCPC still uses the JS fallback. Under `qemu-aarch64 -cpu cortex-a72` with attention 2.3.1 installed: 3.5.2 fell back to JS ("@ruvector/attention not available"); 3.5.3 loads native attention and `hooks intelligence route` exits 0.
- `tests/integrations/native-cpu.test.ts`: Pi 4 + binary 2.3.1/2.4.0 loads native, 2.3.0/2.2.3/unknown fall back, numeric version comparison, and the resolved attention is >= 2.3.1 (red against the 3.5.2 check).

## [3.5.2] - 2026-11-09

### Fixed
- **Raspberry Pi 4 (Cortex-A72) no longer crashes on `hooks intelligence`.** The @ruvector/attention linux-arm64 binaries (2.2.3 and 2.3.0) contain LDAPR instructions (ARMv8.3 RCPC; 305 and 312 of them per `aarch64-linux-gnu-objdump -d`), which a Pi 4 does not have. Loading the binary killed the process with SIGILL before any `try/catch` could fall back to JS: on 3.5.1, `agentic-flow hooks intelligence stats` and `... route` died under `qemu-aarch64 -cpu cortex-a72`. `src/utils/native-cpu.ts` now reads the `Features` line of `/proc/cpuinfo` on linux-arm64 and skips the native load when `lrcpc` is missing (`RuVectorIntelligence`, `core/attention-native`, `core/attention-fallbacks`), so the JS attention paths are used. Other platforms are unaffected. Set `AGENTIC_FLOW_NATIVE_ATTENTION=1` to force the native load or `=0` to skip it.
- **A child process killed by a signal is no longer reported as success.** The `hooks`, `workers`, `mcp`, `mcp-manager`, `claude-code` and QUIC launchers in `cli-proxy` forwarded `code || 0`, so the SIGILL above exited 0. They now exit with 128 + the signal number (`src/utils/child-exit.ts`).

### Changed
- `@ruvector/router` `^0.1.30` → `0.1.34` and `@ruvector/sona` `^0.1.11` → `0.1.13` (exact). router 0.1.32/0.1.33 and sona 0.1.11/0.1.12 shipped linux-arm64 binaries with LDAPR (226/229 and 34/34 instructions) that SIGILL on a Cortex-A72 at `require`; 0.1.34 and 0.1.13 have none and load there. The lockfile held 0.1.32 and 0.1.11. `@ruvector/router` moves to `optionalDependencies`: `SemanticRouter` already loads it lazily with a brute-force fallback.
- `tests/integrations/native-cpu.test.ts`: the CPU check (Pi 4 and Pi 5 `Features` lines, overrides), the JS fallback when native attention is skipped, the router/sona floors against the real packages (red on 0.1.32/0.1.11), and `childExitCode`.

## [3.5.1] - 2026-11-09

### Fixed
- **MCP servers report the real version.** `serverInfo.version` of the stdio server that `agentic-flow mcp` starts was a hard-coded `1.0.8`; the in-process SDK server and the FastMCP stdio/HTTP servers said `1.0.0`/`1.1.12`. All now read the installed package version (`mcpServerVersion()` in `src/utils/package-version.ts`). `tests/mcp/server-version.test.ts` starts the stdio server and checks the initialize response (red on 3.5.0: `1.0.8`, `1.0.0`).
- **`src/core/attention-native.ts` runs on @ruvector/attention 2.x.** Every class failed on 2.x: `FlashAttention(dim)`, `HyperbolicAttention(dim)` and `MoEAttention(dim)` did not construct (2.x needs a block size, a curvature and a `{ dim, numExperts, topK }` config), and `MultiHeadAttention`/`LinearAttention` passed flat arrays where 2.x takes key and value rows. The wrappers now use the 2.x shapes, accept one vector or a list of rows for keys and values, check dimensions, and honour the mask (MultiHead) and `topK` (MoE). `HyperbolicAttention.forward` returns the Poincare distance to the nearest key; `MoEAttention.forward` returns empty `expertWeights` (2.x does not expose them). `tests/integrations/attention-native-wrappers.test.ts` loads the real package and checks FlashAttention against exact softmax attention (7/8 fail on 3.5.0, 8/8 now). The live path (`RuVectorIntelligence`) was fixed in 3.3.1.

### Removed
- `src/core/agentdb-wrapper.ts` (and its README and two test files). It was not reachable through the package `exports` map and called a reflexion API agentdb never had (`controller.store` with raw vectors), so 8 of its unit tests and 15 of its 19 integration tests failed against agentdb 3.7. Use `AgentDBFast` or agentdb directly.
- `src/agentdb/tests/frontier-features.test.ts`: it tested the vendored, unshipped copy of agentdb's `CausalMemoryGraph`/`ExplainableRecall` (excluded from the build); 7 of its tests failed on behaviour agentdb itself has since changed or fixed (for example `INSERT OR IGNORE` for provenance sources).

## [3.5.0] - 2026-11-09

### Added
- **Task-graph scheduling: `swarm_schedule_tasks` MCP tool and `scheduleTaskGraph()` in `agentic-flow/integrations`.** Given tasks with costs and `{ from, to }` dependencies, returns a dependency-respecting `order`, parallel `waves` (tasks that can go to separate agents at once), `earliestStart` per task, the cost-weighted `criticalPath` (the chain that bounds the run), `totalCost` and `parallelism` (`totalCost / criticalPath.cost`). Dependency cycles are rejected with the cycle named. Complements `swarm_partition_tasks`: partition picks the seam between two teams, scheduling orders the work inside them. Admitted under the default `readonly` MCP profile (pure computation).
- `@ruvector/rudag` `^0.1.2` as an optionalDependency (Rust/WASM topological sort and critical path, MIT OR Apache-2.0, adds `idb`; 2 packages, no install scripts). Loaded lazily with `storage: null`, so it never touches IndexedDB or the filesystem. Without it a built-in Kahn sort + longest-path DP answers with the same result (`engine: 'builtin'`); `tests/integrations/task-schedule.test.ts` checks both engines against the real package and that they agree on a 300-task random DAG.

### Changed
- Package metadata (ADR-356, folded in from #261): `homepage` is https://ruv.io, `repository.directory` is `agentic-flow`, 16 keywords, a shorter description. The README gains an animated flow diagram, a "Works with / Used by" section and a ruv.io footer.

## [3.4.4] - 2026-11-08

### Fixed
- **QUIC availability is reported honestly.** No native QUIC binding is published for agentic-flow: the quinn-based `crates/agentic-flow-quic` has no N-API build or publish pipeline, `wasm/quic` is a browser stub with no UDP, and `agentic-flow/transport/quic` is a placeholder that sends no bytes. `isQuicAvailable()` therefore stays `false`. It used to return `true` when `AGENTIC_FLOW_QUIC_NATIVE=1` was set, while `loadQuicTransport()` still returned the WebSocket transport. That variable is now ignored.

### Added
- `getQuicStatus()` (`{ available, reason, fallback: 'websocket' }`), `QUIC_UNAVAILABLE_REASON`, and `quicUnavailableReason` on `getTransportCapabilities()`, exported from `agentic-flow/transport/loader`. `agentic-flow/transport/quic` re-exports `isQuicAvailable`, `getQuicStatus` and `QUIC_UNAVAILABLE_REASON`, and its `QuicClient`/`QuicServer` log a warning on `initialize()` that they are placeholders. For a transport that moves bytes, use `loadQuicTransport()` (WebSocket fallback).

## [3.4.3] - 2026-11-08

### Changed
- Dependency floors raised: `agentdb` `^3.7.0` → `^3.7.2`, `ruvector` `^0.3.3` → `^0.3.14`, `@ruvector/attention` `^2.2.3` → `^2.3.0` (optional), `@ruvnet/sublinear-core` `^1.0.0` → `^1.0.1` (optional). Range-only; no API change. The lockfile dedupes the nested `ruvector`/`@ruvector/attention` copies agentdb used to pull. `npm audit`: 0 high / 0 critical.

## [3.4.2] - 2026-11-08

### Fixed
- **`AgentDBFast` works again on agentdb 3.x.** Every `retrieveEpisodes`, `searchPatterns` and `getStats` call threw: agentdb's vector backends are async-only for search (`search is async-only. Use searchAsync()`), and `getStats` called a `stats()` method no backend has. Searches now go through `searchAsync` with agentdb's filtered search (`src/core/agentdb-filtered-search.ts`).
- **`AgentDBFast` filters are applied.** The `type` filter was dropped whenever it was the only predicate, so `retrieveEpisodes` returned patterns and `searchPatterns` returned episodes. `minReward`/`maxReward`/`minQuality` were sent as `$gte`/`$lte`, which agentdb's `FilterBuilder` does not know and silently ignores; they are now `$ge`/`$le`/`$range`. On the rvf backend (`@ruvector/rvf` 0.4.7) equality and ranges are filtered natively by field name; ruvector filters equality only, so ranges are applied after an over-fetch. If a filtered search throws, or a post-filtered answer comes back short, the search falls back to an exhaustive search filtered locally.
- `AgentDBFast` passes `vectorDimension` to agentdb (it passed `dimensions`, which agentdb ignores, so stores other than 384-d rejected every vector).
- `AgentDBFast.storeEpisode`/`storePattern` write through `insertAsync`, so an rvf metadata type clash rejects the call with agentdb's `RvfMetadataTypeConflictError` (now re-exported from `core/agentdb-fast`) instead of being parked in the backend's rejected-writes queue. `close()` awaits `closeAsync()` where the backend has it, so queued writes are flushed and the writer lock is released before it resolves.
- `AgentDBService.recallEpisodes` hands `minReward`/`reward: {$gte}`, `success`, `onlySuccesses`/`onlyFailures` and `timeWindowDays` to `ReflexionMemory.retrieveRelevant` instead of filtering an unfiltered result in JS; other keys still go through `MetadataFilter`. The in-memory fallback applies the same filters.

### Changed
- **`agentdb` `^3.0.0` → `^3.7.0`** (lockfile 3.0.0 → 3.7.0, `@ruvector/rvf` 0.4.7). `tests/integrations/agentdb37-filtered-search.test.ts` exercises the real package on the rvf and default backends: name-based filters, ranges, `forceExact`, `RvfMetadataTypeConflictError`, `closeAsync()`, and an `AgentDBService` round trip.
- `tests/integrations/no-workspace-protocol.test.ts` fails if a publishable `package.json` in the repo uses `workspace:`. The two examples that did are now `private` with real ranges; the non-existent `@agentic-flow/consensus-router` dependency is gone.

## [3.4.1] - 2026-11-06

### Changed
- **`aidefence` `^3.0.1` → `^3.0.2`.** aidefence 3.0.2 declares `zod ^4.6.7` itself, so the `overrides.aidefence.zod` entry added in 3.4.0 is removed. The lockfile still holds a single zod copy (4.6.7), and `aidefence/dist/detection` (the prompt-injection engine) loads and runs under it. `tests/mcp/zod4-migration.test.ts` now checks that aidefence resolves to the top-level zod 4 without an override.
- The optional `agent-booster` dependency (`^0.2.2`) also resolves the fixed 0.2.3, whose edits no longer fail when its WASM is rebuilt from source (see `packages/agent-booster/CHANGELOG.md`).

## [3.4.0] - 2026-11-06

Moves the package to zod 4. MCP clients see different default validation messages; see Changed.

### Security
- **`zod` `^3.25.76` → `^4.6.7`** ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): memory exhaustion while validating oversized constrained collections; no 3.x release is fixed). To reach zod 4 everywhere, `@anthropic-ai/claude-agent-sdk` `^0.1.5` → `^0.1.77` (first release whose peer range accepts zod 4). `aidefence` 3.0.1 still declares `zod ^3.22.4`, so an `overrides` entry puts it on the top-level zod 4; its schemas and the `aidefence/dist/detection` entry point agentic-flow uses were checked under zod 4. The lockfile now holds a single zod copy, 4.6.7. (zod migration by @proffesor-for-testing, #244.)
- **`glob` `^13.0.0` → `^14.0.4`**, which also moves `minimatch` 10.2.6 → 11.0.5. This closes the glob AbortSignal cancellation bypass (`>=9.0.0 <=14.0.1`) and the minimatch globparts DoS (`>=7.0.0 <11.0.1`). glob is only loaded by the worker file scanners, through `import('glob')`; the API they use is unchanged.
- `tests/mcp/zod4-migration.test.ts` (in `test:governance`) fails if any zod 3, glob ≤ 14.0.1 or minimatch < 11.0.1 copy comes back into the lockfile.

### Changed
- **zod 4 validation behaviour seen by MCP clients.** Default error texts and issue codes differ (`Required` → `Invalid input: expected string, received undefined`, `invalid_enum_value` → `invalid_value`); custom `refine` messages are unchanged. `z.number()` rejects `Infinity`, `.int()` rejects integers outside ±2^53 and advertises safe-integer bounds, and FastMCP `tools/list` schemas no longer emit `additionalProperties: false` (unknown keys are still stripped). The in-process claude-agent-sdk server keeps every parameter description (`withPortableDescriptions`) and, with SDK 0.1.77, reports invalid `tools/call` arguments as an `isError` result instead of a JSON-RPC `-32602` error.
- `p2p_swarm_publish.payload` stays optional under zod 4.

### Fixed
- **The AgentDB runtime patch looks for `dist/src/controllers/index.js`**, where agentdb 3.x ships it, so loading agentic-flow no longer prints `[AgentDB Patch] Controller index not found`. (@MediaPushai, #133.)

## [3.3.1] - 2026-11-06

### Fixed
- **`RuVectorIntelligence` now runs the native `@ruvector/attention` kernels it is configured for.** Six call shapes did not match the 2.x API, so each threw, the error was swallowed and the work went to the JS fallback:
  - `attentionType: 'flash'`: `new FlashAttention(dim)` → `new FlashAttention(dim, 64)` (2.x requires the block size).
  - `attentionType: 'graph'`: `new GraphRoPeAttention(dim, 10000)` → `new GraphRoPeAttention({ dim, maxPosition: 10000 })`. `routeTask` also had no `'graph'` branch, so even a constructed instance was never used.
  - `attentionType: 'dual'`: positional `DualSpaceAttention(dim, c, 0.5, 0.5)` → `{ dim, curvature, euclideanWeight, hyperbolicWeight }`.
  - `computeAttentionAsync(q, k, v)` (and `'standard'`): passed `AttentionType.MultiHead`, which does not exist, where the native function takes `dim`. It is native scaled dot-product attention.
  - `computeAttentionAsync(..., 'flash')`: now passes `dim` and the block size; `'hyperbolic'` now passes `dim` before `curvature`.

  `'moe'` (the default), `'multi_head'` and `'hyperbolic'` were already correct. A new test (`tests/integrations/native-attention.test.ts`) loads the real package and asserts the native `compute` ran and the fallback did not; it failed 6 of 10 cases on 3.3.0.

  This is a correctness fix, not a speed-up. The configured algorithm now runs, but for routing-sized inputs the JS fallback (a different, cosine-weighted average) is faster: flash at dim 384 measured 19.8 µs native vs 17.1 µs JS with 20 keys, and 3.4 ms vs 0.73 ms with 1000 keys.

### Security
- **`@ruvector/sona` `^0.1.10` → `^0.1.11`.** 0.1.11 validates engine sizes (`new SonaEngine(0)` now throws instead of aborting), wraps every sync NAPI entry point in `catch_unwind` so a remaining panic surfaces as a JS `Error`, and bounds in-flight trajectories (10,000 per engine, 4,096 steps each). The lockfile now resolves 0.1.11 for every copy, including the ones under `agentdb` and `ruvector`. `sona-loader`'s LoRA length guard stays. (GHSA-c27m-v4wg-f9qj covers < 0.1.9 and was already excluded by 3.3.0's floor.)

### Removed
- `tests/agentdb/frontier-features.test.ts`, a byte-identical copy of `src/agentdb/tests/frontier-features.test.ts` whose relative imports could not resolve from `tests/`.

## [3.3.0] - 2026-11-05

Replaces the optional `sublinear-time-solver` with its zero-dependency core, `@ruvnet/sublinear-core@^1.0.0`, and drops the workarounds 3.2.0 needed for sublinear-time-solver 1.7.2.

### Added
- **`sublinear_pagerank`: personalized PageRank and forward-push top-k.** `seeds` (node ids, or `{ node: weight }`) ranks what matters to those nodes. `approximate: true` (needs `seeds`; `epsilon`, default 1e-6) runs local forward push, whose work depends on `epsilon` rather than the graph size; it returns only the nodes it reached (`top` caps them) and `residualMass`, an upper bound on the total L1 error. Results now carry `method` (`power-iteration`, `forward-push`, `gauss-seidel`) and `personalized`. `damping` is the probability of following an edge (restart probability r maps to `1 - r`).
- **`sublinear_solve`: `method`** (`auto` default — conjugate gradient for symmetric matrices with a positive diagonal, else Gauss-Seidel — or `gauss-seidel`, `conjugate-gradient`, `jacobi`, `neumann`). Results carry `method` and the real `iterations` (3.2.0 reported 0 for library answers).
- `agentic-flow/integrations` also exports `loadSublinearCore` and the `PageRankOptions`, `PageRankEdge`, `SolveMethod`, `SublinearEngine` types.

### Changed
- `engine` in `sublinear_solve` / `sublinear_pagerank` results is `sublinear-core` (was `sublinear-time-solver`); `builtin` is unchanged. `ecosystem_status` lists `@ruvnet/sublinear-core`.
- Every library answer is still verified before it is returned: solves by `max|Mx - b|` recomputed here, PageRank by convergence and scores summing to 1 (forward push: estimates plus residual mass summing to 1). A failed check falls back to the built-in Gauss-Seidel and sets `libraryRejected`, as before.

### Security
- **`@ruvector/attention` `^0.1.4` → `^2.2.3`** ([GHSA-p62c-q7fc-qmg9](https://github.com/ruvnet/ruvector/security/advisories/GHSA-p62c-q7fc-qmg9)). The old range resolved 0.1.32, where a key/query length mismatch panicked in Rust and aborted Node (SIGABRT); 2.2.3 throws a catchable error. The runtime API is unchanged (same 39 exports and methods); outputs match 0.1.32 except float rounding (hyperbolic ≤ 1.4e-3, MoE ≤ 1e-6). `agentdb` and `ruvector` still declare `^0.1.x` and keep their own nested copy until they release the same bump.
- **`@ruvector/sona` `^0.1.4` → `^0.1.10`.** The old range resolved 0.1.8 in the lockfile, where JS input could abort Node — e.g. `applyMicroLora` / `applyBaseLora` with a vector that is not `hiddenDim` long; 0.1.9+ throws. SONA engines now come only from `sona-loader` (`RuVectorIntelligence` included), which also checks those lengths and throws a `RangeError`, so the error is the same even if an older nested copy is resolved.

### Removed
- The 1.7.2 workarounds: forward-push-only method selection, the solver-instance cache and WASM-probe settling, and the console-to-stderr redirection around the import (`withStdoutToStderr`, `importOptional`'s `quietStdout` option). The core prints nothing.

### Install size
Measured with `npm install agentic-flow@<version>` in an empty directory (Linux x64, Node 22):
- 3.2.0: 1,796,535,838 bytes (1.8 GB), 600 packages. 3.3.0: 1,795,364,813 bytes (1.8 GB), 597 packages — 1.2 MB and 3 packages (`sublinear-time-solver`, its `commander`, `temporal-lead-solver`) fewer.
- On its own, `sublinear-time-solver` installs 122 MB in 170 packages; `@ruvnet/sublinear-core` installs 220 kB in 1. In agentic-flow's tree nearly all of sublinear-time-solver's dependencies are shared with agentic-flow's own, so the "~115 MB" in the 3.2.0 notes below was its standalone cost, not what it added to an agentic-flow install.

## [3.2.0] - 2026-11-05

Wires in six optional ruvnet packages that were missing, undeclared or listed but unused. Each is an `optionalDependency` (installed by default), loaded lazily, with a built-in fallback, and each result reports which engine answered.

### Added
- **Prompt-injection screening (`aidefence`).** `InputValidator.validateTaskDescription` (run on every task by `RuvLLMOrchestrator.selectAgent` and `CircuitBreakerRouter`) claimed prompt-injection protection but only matched XSS/SQL/path patterns. It now scans with aidefence's detection engine (built-in patterns without it). Critical findings throw `PromptInjectionError`; high and below emit one `AGENTIC_FLOW_PROMPT_INJECTION` warning. `AGENTIC_FLOW_PROMPT_INJECTION=block|strict|warn|off` (default `block`; `strict` also rejects high).
- **MCP tools** (stdio server, available under the default `readonly` profile — pure computations):
  - `swarm_partition_tasks`: exact global min cut of a task-dependency graph (`@ruvector/mincut-wasm`, which requires Node >= 22; Stoer-Wagner fallback on Node 20).
  - `sublinear_solve`, `sublinear_pagerank`: `sublinear-time-solver` forward-push, every answer verified by its residual, Gauss-Seidel fallback. Its console banners go to stderr so they cannot corrupt the stdio protocol. The bundled `sublinear/*` agents can use these instead of a separate server.
  - `prompt_injection_scan`, `ecosystem_status`.
- **`agentic-flow/integrations` subpath export**: `scanPromptInjection`, `partitionTaskGraph`, `solveLinearSystem`, `pageRank`, `applyAgentBoosterEdit`, `getOnnxWasmEmbedder`, `isOptionalInstalled`.
- **Skills**: `.claude/skills/agentic-flow-ecosystem` (copied by `init`), `.agents/skills/agentic-flow-ecosystem` for Codex (also copied by `init`, shipped in the package), and the plugin skill `ecosystem-integrations`.

### Changed
- **`agent-booster` is declared.** `agent_booster_edit_file` in `agent-booster-tools.ts` and the Claude Agent SDK server imported it without declaring it, so they failed on a default install. The stdio server's edit tools now run it in-process and fall back to `npx agent-booster@0.2.2` only when it is absent.
- **`SemanticRouter` uses `@ruvector/router`'s native HNSW index** (cosine distance converted to similarity) instead of the simulated index; brute force remains the fallback. `getIndexBackend()` reports which.
- **`AgentDBFast` embeds with all-MiniLM-L6-v2** via `ruvector-onnx-embeddings-wasm` instead of hash vectors when `vectorDimensions` is 384 (`embeddings: 'auto' | 'onnx-wasm' | 'hash'`). The model (~91 MB, full precision — the WASM runtime rejects the quantized graph) downloads to `~/.agentic-flow/models` on first use unless `AGENTIC_FLOW_OFFLINE=1`, `HF_HUB_OFFLINE=1` or `AGENTIC_FLOW_EMBEDDINGS_DOWNLOAD=0`.
- Removed the unused direct dependencies `@ruvector/core` and `@ruvector/ruvllm` (both still arrive through `ruvector`/`agentdb`).

### Fixed
- `getCachedOnnxEmbedder()` and `src/wasm/onnx-embeddings-wasm.ts` never produced embeddings: ruvector-onnx-embeddings-wasm 0.1.2 is `type: module` with CommonJS glue (so `import()` throws) and does not export the `OnnxEmbeddings` class they looked for. Both use the new shared loader.

### Install size
- The optional packages add about 125 MB to `node_modules` (`sublinear-time-solver` and its dependencies are ~115 MB of that). `npm install --omit=optional` skips them; every feature above falls back.

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
