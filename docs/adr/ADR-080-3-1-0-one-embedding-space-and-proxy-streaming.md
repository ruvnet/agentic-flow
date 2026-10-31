# ADR-080: 3.1.0 — one embedding space per process, shared SSE reader for the proxies

**Status:** Accepted
**Date:** 2026-10-31
**Related:** ADR-079 (3.0.0), ruvnet/agentic-flow#246

## Context

Three problems were left after 3.0.0.

- **Mixed embedding spaces (#246).** `src/reasoningbank/utils/embeddings.ts` reset `initializationPromise` after a failed model load so that the next call could retry. When the retry succeeded, the process held hash-fallback vectors from before and model vectors from after, and compared them. The cache also mixed them: a text embedded during the outage kept its hash vector until the TTL expired. In a test where the first load fails and the second succeeds, the cosine between two embeddings of the same text was 0.03. A model error on a single text, with the model loaded, also silently returned a hash vector.
- **Gemini and Requesty streaming.** Both proxies called `decoder.decode(value)` without `{stream:true}` and split each read on `'\n'` with no carry-over. A `data:` line split across reads was dropped, and a multibyte character split across chunks was corrupted. 3.0.0 fixed this in the OpenRouter proxy only (ADR-079, first "not done" item).
- **Docs behind the code.** The proxy guides told users to send `sk-ant-proxy-dummy-key` ("any value works"), which the 3.0.0 proxies reject with 401. The READMEs and the skills shipped in `.claude/skills` ran `npx agentic-flow@alpha`, which resolves to the March 3.0.0-alpha line that ADR-079 deprecated.

## Decision

1. **The first embedding fixes the space for the life of the process.** `embeddingKind` is set to `'local'` or `'hash'` by the first vector produced and is never switched implicitly:
   - a failed load is not retried; the process stays on hash vectors;
   - a model error after model vectors were produced throws rather than returning a hash vector, because a vector from the other space would be compared as if it were comparable;
   - `resetEmbeddingBackend()` is the explicit retry: it clears the kind, the pipeline and the cache. Its doc comment says that vectors kept from before the reset must be re-embedded;
   - `isSemanticEmbedding()` reports the committed kind; `getEmbeddingKind()` exposes it.

   We chose a sticky kind over tagging every stored vector with its kind. Tagging would need a schema change in the ReasoningBank database and every comparison site to check the tag. A sticky kind keeps all vectors one process produces comparable without touching storage.
2. **One SSE reader for all three proxies.** `src/proxy/sse-lines.ts` exports `forEachSseLines(reader, onLines)`, which decodes with `{stream:true}`, holds back a partial line until its newline arrives, and flushes the tail at the end. It also exports `sseLines(text)`, which strips `\r`. The OpenRouter, Gemini and Requesty proxies all use it, so the fix cannot drift between them again.
3. **Nothing shipped runs agentic-flow through a dist-tag.** `.claude/statusline.mjs` executed `npx agentic-flow@alpha mcp status` on every refresh; it now runs only the project's local `node_modules/.bin/agentic-flow` via `execFileSync` and otherwise shows idle. `hooks init` hook commands, its printed next steps, and `swarm`'s printed `connect` line use `agentic-flow@<installed version>` from `src/utils/package-version.ts` (shared with `init`; it walks up to this package's `package.json` and throws rather than returning `latest`). `scripts/validate-providers.sh`, the versioned `docs/docker-tests` Dockerfiles and the two worker skills are pinned as well.
4. **`hooks init` grants what `init` grants.** It pre-approved `Bash(npx:*)`, `Bash(npm run:*)` and the whole `agentic-flow`, `claude-flow` and `ruv-swarm` MCP servers; it now allows only `Bash(agentic-flow:*)`, matching `init` since 3.0.0. The statusline also accepts `model` as `{ id, display_name }` (Claude Code's shape) as well as a string, instead of throwing.
5. **Docs show the 3.0.0 behaviour.** Clients pass the token the proxy prints. `AGENTIC_FLOW_PROXY_TOKEN` gives a stable token and `AGENTIC_FLOW_PROXY_HOST` sets the bind address. The extension template uses `proxy-auth`. Version references pin `agentic-flow@<current version>`, and a test checks the pin against `package.json`.
6. **Minor release.** The new exports are additive. The behaviour change (throw instead of a silent hash vector) only affects a process that had already produced model vectors and then hit a model error. Before, that process returned a wrong answer; now it raises an error.

## Tests

Each test below fails on 3.0.0 (610dc79) and passes on 3.1.0.

- `tests/reasoningbank/embeddings-space.test.ts` (3 tests, fake transformers pipeline whose first load fails). After a failed first load, the same text embedded before and after a cache clear has cosine 1 and the model is loaded once. On base the cosine is 0.03. `resetEmbeddingBackend()` loads the model and drops cached hash vectors. A model error after model vectors throws.
- `tests/security/proxy-auth.test.ts`: the streaming test now runs for each proxy, with a payload split inside the JSON of a `data:` line and inside a 4-byte emoji. On base, OpenRouter passes (fixed in 3.0.0) and Requesty and Gemini fail. All three pass after.
- `tests/security/docs-proxy-auth.test.ts` (19 tests). There is no dummy key in the three proxy guides (both copies) or the three shipped Requesty plans, and the standalone guide documents `AGENTIC_FLOW_PROXY_TOKEN`. There is no `agentic-flow@alpha` in the READMEs or shipped skills, and every `agentic-flow@x.y.z` there equals `package.json`'s version. With the base docs and version, 17 of 19 fail.
- `tests/security/no-dist-tag-exec.test.ts` (4 tests) scans shipped executed files: code, scripts, Dockerfiles, and `.claude` helpers and instructions. No `agentic-flow@alpha|latest|beta|next` may appear, there may be no unversioned `npx agentic-flow` outside `src/` help text, and the `hooks init` command template must use `${spec}`. Before the pinning commit, 3 of 4 fail, with 9 offending files.
- `tests/security/init-template.test.ts` gains a `hooks init` block: it runs the command in a temp directory and checks that there are no npx/npm or whole-server pre-approvals and that every hook command is pinned. `tests/security/statusline.test.ts` covers a string model, `{ id, display_name }`, id only, and a missing model. Against the pre-fix source, 4 of the 10 tests in these two files fail.
- Gates: `npm run build` passes. `npm run test:security` passes 153 of 153, and `npm run test:governance` and `npm test` pass. `tests/reasoningbank` fails the same 68 tests (in `advanced-memory`, `hybrid-backend` and `integration`) on base and after, compared by test name. `tests/backwards-compatibility.test.ts` fails the same 5 tests on base and after. `npm audit --omit=dev` is unchanged: zod (high), glob and minimatch (moderate).

## Not done

- CLI help text and MCP tool output in `src/` still print `npx agentic-flow <cmd>` without a version. These are printed, not executed.
- Prose docs (release notes, `docs/router`, `QUICK-START-v1.7.1`, `validation/docker/README.md`) still say `npm install agentic-flow@latest`. These are install instructions, not executed paths.
- `docs/archived/` keeps its historical dummy-key examples; `ONNX-PROXY-IMPLEMENTATION.md`'s `sk-ant-onnx-local-key` is correct, because the ONNX proxy holds no upstream key and has no token.
- Other `.md` files in the repo (root `docs/`, `.claude/agents`, release notes) still mention `@alpha`; they are not shipped in the package.
- Carried from ADR-079: the http2, http3 and websocket proxies are not audited, zod 3 → 4 is not done, and the major dependency upgrades are not done.
