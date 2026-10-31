# ADR-079: 3.0.0 — one stable line, secure defaults, learning that consumes outcomes

**Status:** Accepted
**Date:** 2026-10-31
**Related:** ADR-076 (meta-harness positioning), ADR-078 (release consolidation), ruflo ADR-513/515 (ecosystem convergence)

## Context

Two `agentic-flow` lines had diverged.

- **main**: 2.1.5, October 2026, the code in this repository.
- **3.0.0-alpha.1/.2**: March 2026. These were built from commit `0d7a9cf4` plus files that were never committed. `dist/coordination/autopilot-learning.js` existed only in the tarball.

ruflo depended on `^3.0.0-alpha.1`, so its users ran the March alpha. That alpha pulled `@xenova/transformers` → `onnxruntime-web@1.14` → `onnx-proto` → `protobufjs@6`, which carries a critical advisory. It also pulled `agentdb@1.6.1` beside ruflo's own AgentDB.

A four-part review of main (security, plus integration and self-learning) found the following.

**Security, reproduced or traced end to end:**
- The OpenRouter, Gemini and Requesty proxies listened on all interfaces with no auth, so anyone on the LAN could spend the user's provider key.
- The `agentic_flow_agent` MCP tool ran a `bypassPermissions` agent with Bash. `init` auto-approved that server, so a prompt injection could reach a shell with no prompt.
- An upward `.env` walk and cwd router configs let a cloned repo redirect API keys.
- `statusline.sh` (copied by `init`) executed code from repo data. This was reproduced.
- Path traversal existed in the agent and command creation tools.
- The `init` template ran `npx agentic-flow@alpha` on every hook.

**Learning:**
- ReasoningBank rewarded memories for being retrieved; verdicts never moved their confidence.
- agent-booster counted every cache hit as a success before any outcome was known, and returned another file's cached edit as a success.
- `computeEmbedding` kept processes alive for up to an hour, and silently returned hash vectors under `npx`.

**Packaging:**
- `@huggingface/transformers@3.8` pinned `onnxruntime-node@1.21`, whose install script fails on CUDA 13 hosts, so `npm install agentic-flow@2.1.5` failed outright there.
- The locked `fastmcp@3.21` crashed every MCP session with SDK 1.30.

## Decision

Ship main, with the review fixes, as **3.0.0**:

1. **Major, not 2.2.0.** Agents not bypassing permissions, token-required proxies and the server rename break existing users. A minor would deliver that unannounced to everyone on `^2.1`. 3.0.0 also gives the 3.x line a stable head, so installs on `^3.0.0-alpha.1` (including every ruflo 3.66.x) resolve to it and leave the March alpha behind.
2. **No alpha dist-tag.** Publish to `latest` only and deprecate `3.0.0-alpha.1`/`.2` with a pointer to 3.0.0. The existing `alpha` tag is left where it is.
3. **Secure by default, opt-in to the old behaviour.** Bind loopback and require tokens; bypassing permissions takes `AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS=1`. Endpoint keys are honoured only from the real environment or an explicit `--env-file`.
4. **Learning consumes outcomes.** The verdict moves the confidence of the memories it used; cache hits are not successes.
5. **Restore AutopilotLearning from its source map.** The 3.0.0-alpha.2 tarball's source map embeds the original TypeScript, which is restored verbatim. Its services were ported to load the real `agentdb` package: alpha.2's relative `packages/agentdb/src` imports never resolved once installed, so it always ran on an in-memory fallback.

## Consequences

- Every ruflo 3.66.x install picks up 3.0.0 on its next fresh install. Before publishing, it was installed under `ruflo@3.66.2` through a root `overrides` and checked: `ruflo --version`, `ruflo doctor`, memory store/search and autopilot.
- With no model cache and no network, `computeEmbedding` falls back to hash vectors in about 150 ms and `isSemanticEmbedding()` returns false. Removing the npx heuristic therefore cannot break an offline install; online installs download about 23 MB of MiniLM on first use.
- Test status: all new tests pass; 122 run in `npm run test:security`. Three ReasoningBank suites (`advanced-memory`, `hybrid-backend`, `integration`) fail 68 tests both on the base commit and after these changes; that predates this release.
- **Not done:**
  - Gemini and Requesty streaming have the same chunk-split bug that was fixed in OpenRouter.
  - The http2, http3 and websocket proxies were not audited.
  - The ONNX proxy has no token; it holds no upstream key.
  - zod 3 → 4 is not done.
  - Upgrading the major dependencies (`@anthropic-ai/sdk` 1.x, `@google/genai` 2.x, `@ruvector/attention` 2.x) needs its own review.
