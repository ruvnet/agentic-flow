# agentic-flow plugin for Claude Code

The [agentic-flow](https://github.com/ruvnet/agentic-flow) MCP server, ReasoningBank learning, multi-provider routing, and a guard on agent spawning, as one Claude Code plugin.

## Install

```text
/plugin marketplace add ruvnet/agentic-flow
/plugin install agentic-flow@agentic-flow
```

From a terminal: `claude plugin marketplace add ruvnet/agentic-flow` then `claude plugin install agentic-flow@agentic-flow`.

Requires Node.js 20+ (the server runs with `npx`) and Claude Code 2.1.287 or newer for the mod.

## What it adds

| Part | What |
|---|---|
| MCP server `agentic-flow` | `npx -y agentic-flow@3.1.0 mcp start`, pinned to the plugin's version |
| Agents | `reasoningbank-learner`, `model-router` |
| Skills | `reasoningbank-learning`, `multi-provider-routing`, `autopilot-learning` |
| Command | `/agentic-flow-status` |
| Mod | a guard on `agentic_flow_agent` and a status-line entry |

## Settings

Change them with `/plugin` → agentic-flow → configure.

| Setting | Default | Sets | Meaning |
|---|---|---|---|
| `mcp_profile` | `readonly` | `AGENTIC_FLOW_MCP_PROFILE` | `readonly`, `retrieval`, `learning`, `admin`. Only `learning` and `admin` register `agentic_flow_agent` (spawns an agent) and `agentdb_pattern_store`. |
| `provider` | `anthropic` | `PROVIDER` | default provider for spawned agents |
| `model` | empty | `COMPLETION_MODEL` | default model; empty uses the provider's |
| `openrouter_api_key` | empty | `OPENROUTER_API_KEY` | sensitive, kept in secure storage |
| `gemini_api_key` | empty | `GOOGLE_GEMINI_API_KEY` | sensitive, kept in secure storage |
| `allow_bypass_permissions` | off | `AGENTIC_FLOW_ALLOW_BYPASS_PERMISSIONS` | **dangerous**, see below |
| `guardMode` | `enforce` | (mod only) | `enforce`, `notify`, `off` |

A key set in the plugin replaces the same variable from your shell for the MCP server, and an empty one arrives as an empty value (Claude Code passes unset options as `""`), so set the key here if you use that provider through the plugin. `ANTHROPIC_API_KEY` is not a setting: the server inherits it, or your Claude login, from the environment.

## Security

- **Nothing is pre-approved.** The plugin ships no `allowed-tools` or permission rules for agentic-flow tools; Claude Code asks before each call.
- **Read-only by default.** Under the default `readonly` profile the server does not register `agentic_flow_agent` at all.
- **Spawned agents get read-only tools** (Read, Glob, Grep, TodoWrite) unless you turn on `allow_bypass_permissions`. With it on, every agent `agentic_flow_agent` spawns runs with `bypassPermissions` and may use Bash, Write, Edit, WebFetch and WebSearch with no confirmation, driven by task text the calling model wrote, which can carry instructions injected from files or web pages it read. Use it only inside a disposable sandbox.
- **The guard** (`hooks/`) refuses `agentic_flow_agent` calls whose task matches destructive patterns (recursive delete of `/` or home, `mkfs`, `dd` to a disk, fork bomb, `DROP DATABASE`, force-push to main) or exfiltration patterns (`curl | sh`, reading `~/.ssh`, cloud credentials or `/etc/shadow`, sending secrets or `.env` with curl/nc), and calls that pass `anthropicApiKey` or `openrouterApiKey` as arguments (they would land in the transcript). It fails closed if the check itself errors. **It is a short pattern list, not a sandbox**: the same intent in other words gets through. The boundary is the read-only default above.
- **Proxies** (`npx agentic-flow proxy`) bind `127.0.0.1` and accept only the per-run token they print on start. Use that token as `ANTHROPIC_API_KEY`; never a placeholder.

## Development

```bash
bash plugins/agentic-flow/scripts/smoke.sh       # structural contract (no network, no credentials)
claude plugin validate plugins/agentic-flow
claude plugin test plugins/agentic-flow          # guard and mod tests
claude --plugin-dir plugins/agentic-flow         # try it in a session
```

`tsc -p plugins/agentic-flow` type-checks the mod once Claude Code has written its declarations to `.claude-plugin/types/` (gitignored).

The plugin lives at the repository root, outside the `agentic-flow/` npm package, so it is not published to npm. Its version and the `.mcp.json` pin move together with the package version.

## License

MIT
