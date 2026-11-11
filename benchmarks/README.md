# Synthetic micro-benchmarks

The suites in `src/` time **self-contained reference implementations defined
inside each bench file** (`MockAgent`, `MemoryStore`, `TaskOrchestrator`,
`AttentionMechanism`, `GNN`). They do not import or exercise agentic-flow,
AgentDB or any `@ruvector/*` package. Use them to check that the timing
harness (`utils/benchmark.ts`) works. Do not quote their numbers as
agentic-flow performance.

The per-suite "Target P50 / PASS / FAIL" lines are each suite's own
thresholds for its in-file implementation. They are not comparisons against
any earlier agentic-flow release. This directory has no measured v1.0
baseline.

## Run

```bash
cd benchmarks
npm install
npm run typecheck                     # strict tsc over src/ and utils/
npm run benchmark                     # agent, memory and task suites (about 1s each)
npm run benchmark:attention           # slower: pure-JS attention over 512 tokens
npm run benchmark:gnn                 # slower: pure-JS GNN forward passes
```

Results print to stdout only. No results file, HTML report or regression
check is produced.

## CI

`.github/workflows/benchmarks.yml` type-checks the suite and runs the fast
suites on changes under `benchmarks/`. A compile or runtime failure fails the
job.

## Measured agentic-flow benchmarks

Benchmarks that measure the shipped package live with the code they measure,
for example the cost-optimal router benchmark referenced in
`agentic-flow/README.md`.
