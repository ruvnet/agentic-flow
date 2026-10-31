---
name: swarm-coordination
description: Orchestrate multi-agent swarms for complex parallel task execution
version: 1.0.0
invocable: true
author: agentic-flow
capabilities:
  - swarm_init
  - agent_spawn
  - task_orchestration
  - topology_optimization
---

# Swarm Coordination Skill

Coordinate multi-agent swarms for parallel task execution with intelligent topology selection.

## Quick Start

```bash
# Initialize a mesh swarm with 5 agents
npx agentic-flow@3.1.0 swarm init --topology mesh --agents 5

# Spawn specialized agents
npx agentic-flow@3.1.0 swarm spawn --type researcher --name "Research Agent"
npx agentic-flow@3.1.0 swarm spawn --type coder --name "Code Agent"

# Orchestrate a task
npx agentic-flow@3.1.0 swarm orchestrate "Implement feature X with tests"

# Check swarm status
npx agentic-flow@3.1.0 swarm status
```

## Topologies

### Mesh (Default)
- All agents communicate directly
- Best for: Collaborative tasks, code review
- Latency: Low
- Scalability: Medium

### Hierarchical
- Tree structure with coordinator
- Best for: Large projects, delegation
- Latency: Medium
- Scalability: High

### Ring
- Sequential communication
- Best for: Pipeline processing, CI/CD
- Latency: Higher
- Scalability: Medium

### Star
- Central hub coordinates all
- Best for: Simple coordination
- Latency: Low
- Scalability: Low

## Agent Types

| Type | Description | Use Case |
|------|-------------|----------|
| researcher | Deep analysis | Requirements gathering |
| coder | Implementation | Feature development |
| tester | Quality assurance | Test creation |
| reviewer | Code quality | PR review |
| architect | System design | Architecture decisions |
| coordinator | Task routing | Complex workflows |

## MCP Tools

```javascript
// Initialize swarm
mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 8 })

// Spawn agent
mcp__claude-flow__agent_spawn({ type: "coder", name: "Feature Dev" })

// Orchestrate task
mcp__claude-flow__task_orchestrate({
  task: "Implement OAuth",
  strategy: "parallel"
})
```

## Best Practices

1. **Right-size your swarm**: Start with 3-5 agents
2. **Choose topology wisely**: Match to task structure
3. **Use Claude Code Task tool**: For actual agent spawning
4. **Monitor status**: Check for bottlenecks
5. **Clean up**: Destroy swarm when done
