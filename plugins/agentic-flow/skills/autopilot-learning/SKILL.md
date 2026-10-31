---
name: autopilot-learning
description: Make a long-running or looped task list learn as it goes with agentic-flow - before each task recall similar past episodes and their critiques, after each task record the outcome, and re-engage failed tasks with what was learned. Use with /loop or autopilot-style runs, or when the user asks for "self-learning" task completion.
---

# Autopilot learning

agentic-flow's autopilot learning bridge (ADR-058) records each task episode and, when a task comes back, hands the agent what earlier attempts learned. In Claude Code you get the same loop with the ReasoningBank tools on the `agentic-flow` MCP server. Recording needs the `learning` or `admin` MCP profile (plugin setting `mcp_profile`); recall works under every profile.

## Each iteration

1. **Pick** the next task (from the task list, a TODO file, or the user).
2. **Recall**: `agentdb_pattern_search` with the task text, `k: 5`. Read failures (`onlyFailures: true`) before successes when the task was attempted before.
3. **Plan** in one paragraph that cites what the recall showed, or says nothing matched.
4. **Do** the task and verify it with something checkable (tests, a build, a command's output).
5. **Record**: `agentdb_pattern_store` with `success`, an honest `reward`, the number of attempts in `critique`, and what to do differently.
6. **Re-engage** a failed task only with a changed approach; the same plan twice is a loop, not learning. After three failed attempts, stop and report.

## Guard rails

- Each agent spawned through `agentic_flow_agent` gets read-only tools unless the plugin's `allow_bypass_permissions` setting is on. Leave it off outside a disposable sandbox.
- The plugin's guard refuses `agentic_flow_agent` tasks that match destructive or exfiltration patterns. It is a pattern list, not a sandbox: do not rephrase a refused task to get past it; ask the user.
- Do not store secrets or personal data in episodes.

## Report

At the end: tasks done, tasks failed, attempts per task, and the critiques worth keeping.
