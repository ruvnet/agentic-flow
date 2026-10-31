# Changelog

All notable changes to the agentic-flow Claude Code plugin.

## [3.1.0]

- `/agentic-flow-guard`: the mod answers with the guard's mode and counts (no model turn).

First release of the plugin, versioned with the agentic-flow package it pins.

### Added

- `.mcp.json`: the `agentic-flow` stdio MCP server, `npx -y agentic-flow@3.1.0 mcp start`.
- `userConfig`: `mcp_profile` (default `readonly`), `provider`, `model`, `openrouter_api_key` and `gemini_api_key` (sensitive), `allow_bypass_permissions` (default off), `guardMode` (default `enforce`).
- Agents: `reasoningbank-learner`, `model-router`.
- Skills: `reasoningbank-learning`, `multi-provider-routing`, `autopilot-learning`.
- Command: `/agentic-flow-status`.
- Mod (`hooks/`): a tighten-only `tool.call` guard on `agentic_flow_agent` that refuses task text matching destructive or exfiltration patterns and API keys passed as arguments, failing closed; a status-line entry.
- `scripts/smoke.sh`, `scripts/smoke-mod.sh`, `tests/`.

### Security

- No agentic-flow tool is pre-approved. The default profile does not register `agentic_flow_agent`.
- `AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS` is set only when the user turns on `allow_bypass_permissions`.
- No dummy keys anywhere; the proxy instructions use its per-run token.
