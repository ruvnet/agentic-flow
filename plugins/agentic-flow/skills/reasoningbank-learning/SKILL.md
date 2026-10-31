---
name: reasoningbank-learning
description: Use agentic-flow's ReasoningBank to learn from past work - search similar episodes before a task, record reward, success and critique after it, and read trends. Use when the user wants agents to remember what worked, or asks about ReasoningBank, pattern store/search, or self-learning.
---

# ReasoningBank learning with agentic-flow

ReasoningBank stores one episode per finished task (task text, reward, success, critique) in AgentDB and finds similar episodes by vector search. The loop is **retrieve, act, judge, store**.

## Which tools exist depends on the MCP profile

The plugin's `mcp_profile` setting (default `readonly`) decides what the `agentic-flow` server registers:

| Profile | Search and stats | Store an episode | Spawn an agent |
|---|---|---|---|
| `readonly` | yes | no | no |
| `retrieval` | yes | no | no |
| `learning` | yes | yes | yes (`agentic_flow_agent`) |
| `admin` | yes | yes | yes |

Tools appear as `mcp__plugin_agentic-flow_agentic-flow__<tool>`. Claude Code asks before each call; the plugin pre-approves none.

## 1. Retrieve

Call `agentdb_pattern_search` with:

- `task`: the new task in one sentence
- `k`: 3 to 5
- `onlySuccesses: true` for approaches to reuse; `onlyFailures: true` for mistakes to avoid

Read the critiques, not just the rewards.

## 2. Act

Do the task. Keep the retrieved critique in mind.

## 3. Judge

Score honestly: `reward` 0 to 1 and `success` true or false. A test suite that passes is evidence; "it looks right" is not.

## 4. Store (learning or admin profile)

Call `agentdb_pattern_store` with `sessionId`, `task`, `reward`, `success`, and a two or three sentence `critique`. Leave out secrets, keys and personal data.

## Trends

`agentdb_pattern_stats` (by task) and `agentdb_stats` (database) report what is stored. Quote their numbers; do not extrapolate them.

## From a terminal

`npx agentic-flow reasoningbank status`, `list`, `consolidate` and `help` work outside Claude Code too.
