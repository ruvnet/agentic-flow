---
name: agentic-flow-status
description: Show the agentic-flow plugin's state - MCP server connection, capability profile and the tools it registered, provider defaults, the guard's mode, and ReasoningBank stats
---

Report the agentic-flow plugin's status. Read only; change nothing.

1. **MCP server**: check whether tools named `mcp__plugin_agentic-flow_agentic-flow__*` are available. If none are, say the `agentic-flow` server is not connected and suggest `/mcp` to see why (the first start downloads the package with `npx`, which can take a while).
2. **Profile**: from the tools present, name the profile: `agentic_flow_agent` present means `learning` or `admin`; otherwise `readonly` or `retrieval`. Say that `agentic_flow_agent` spawns an agent and that the plugin pre-approves no tool.
3. **Agents**: call `agentic_flow_list_agents` and give the count and a few names.
4. **ReasoningBank**: call `agentdb_stats` and quote what it returns.
5. **Settings**: state the plugin settings that matter (`mcp_profile`, `provider`, `model`, `guardMode`, `allow_bypass_permissions`) and where to change them (`/plugin`, then configure agentic-flow). Never print an API key; say only whether one is set if the user tells you.
6. **Guard**: the status line shows `agentic-flow: guard <mode> · <n> checked · <n> blocked`. Quote it if it is visible.

Keep the report under 15 lines.
