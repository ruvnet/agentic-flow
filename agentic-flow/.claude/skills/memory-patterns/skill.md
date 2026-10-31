---
name: memory-patterns
description: Persistent memory patterns for cross-session learning and context retention
version: 1.0.0
invocable: true
author: agentic-flow
capabilities:
  - memory_store
  - memory_retrieve
  - pattern_learning
  - context_management
---

# Memory Patterns Skill

Implement persistent memory patterns for AI agents using ReasoningBank.

## Quick Commands

```bash
# Store a pattern
npx agentic-flow@3.1.0 memory store "api:auth" "OAuth2 with JWT"

# Retrieve a pattern
npx agentic-flow@3.1.0 memory get "api:auth"

# Search patterns
npx agentic-flow@3.1.0 memory search "authentication"

# List all patterns
npx agentic-flow@3.1.0 memory list --namespace project
```

## Memory Namespaces

| Namespace | Purpose | TTL |
|-----------|---------|-----|
| `session` | Current session context | Until end |
| `project` | Project-specific learnings | Permanent |
| `user` | User preferences | Permanent |
| `swarm` | Swarm coordination state | Swarm lifetime |
| `cache` | Temporary cached data | 1 hour |

## Pattern Types

### Decision Patterns
```bash
# Store decision with context
npx agentic-flow@3.1.0 memory store \
  "decisions:auth-method" \
  '{"choice": "JWT", "reason": "stateless, scalable", "date": "2024-01-01"}'
```

### Code Patterns
```bash
# Store reusable code pattern
npx agentic-flow@3.1.0 memory store \
  "patterns:error-handling" \
  "try-catch with custom error classes and logging"
```

### Learning Patterns
```bash
# Store learning from successful task
npx agentic-flow@3.1.0 memory store \
  "learnings:react-hooks" \
  "useCallback for event handlers, useMemo for expensive computations"
```

## MCP Tools

```javascript
// Store memory
mcp__claude-flow__memory_usage({
  action: "store",
  key: "project:architecture",
  value: "microservices with event-driven communication",
  namespace: "project"
})

// Retrieve memory
mcp__claude-flow__memory_usage({
  action: "retrieve",
  key: "project:architecture",
  namespace: "project"
})

// Search memories
mcp__claude-flow__memory_search({
  pattern: "auth*",
  namespace: "project",
  limit: 10
})
```

## ReasoningBank Integration

ReasoningBank provides:
- **150x faster** vector search with HNSW
- **Reflexion memory** for self-improvement
- **Skill library** for learned capabilities
- **Causal graphs** for decision tracking

## Best Practices

1. **Use namespaces**: Organize by scope
2. **Be specific**: Clear, searchable keys
3. **Include context**: Store decisions with reasoning
4. **Clean up**: Delete stale patterns
5. **Version patterns**: Track changes over time
