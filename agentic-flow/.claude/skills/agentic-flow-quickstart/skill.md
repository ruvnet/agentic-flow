---
name: agentic-flow-quickstart
description: Quick start guide for agentic-flow - initialize, configure, and run
version: 1.0.0
invocable: true
author: agentic-flow
capabilities:
  - initialization
  - configuration
  - mcp_integration
---

# Agentic Flow Quickstart

Initialize and configure agentic-flow for optimal Claude Code integration.

## Quick Commands

```bash
# Initialize new project with agentic-flow
npx agentic-flow@3.1.0 init

# Start MCP server for Claude Code
npx agentic-flow@3.1.0 mcp start

# List available agents
npx agentic-flow@3.1.0 --list

# Run a specific agent
npx agentic-flow@3.1.0 --agent coder --task "implement feature X"
```

## Features

### 🤖 54+ Specialized Agents
- Core: `coder`, `reviewer`, `tester`, `planner`, `researcher`
- Swarm: `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`
- GitHub: `pr-manager`, `code-review-swarm`, `issue-tracker`
- SPARC: `specification`, `pseudocode`, `architecture`, `refinement`

### 🧠 ReasoningBank Learning Memory
- Pattern recognition with 84.8% SWE-Bench solve rate
- 150x faster vector search with HNSW
- Cross-session memory persistence

### ⚡ SONA Micro-LoRA Optimization
- 0.05ms inference latency
- 32.3% token reduction
- Real-time learning adaptation

### 🔗 MCP Integration
- 213+ MCP tools available
- Swarm coordination via claude-flow
- GitHub integration via ruv-swarm

## Configuration

Settings are stored in `.claude/settings.json`:
- Hooks for pre/post operations
- Agent definitions
- MCP server configuration
- Statusline customization

## Next Steps

1. Run `npx agentic-flow@3.1.0 init` to set up project
2. Start MCP server with `npx agentic-flow@3.1.0 mcp start`
3. Use Claude Code's Task tool to spawn agents
4. Monitor via statusline and metrics
