---
name: hooks-automation
description: Configure Claude Code hooks for automated coordination and learning
version: 1.0.0
invocable: true
author: agentic-flow
capabilities:
  - pre_edit_hooks
  - post_edit_hooks
  - session_management
  - metrics_tracking
---

# Hooks Automation Skill

Configure intelligent hooks for automated coordination, formatting, and learning.

## Available Hooks

### PreToolUse Hooks
Triggered before Claude Code tools execute.

```json
{
  "PreToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [{
        "type": "command",
        "command": "npx agentic-flow@3.1.0 hooks pre-edit \"$TOOL_INPUT_file_path\""
      }]
    },
    {
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "npx agentic-flow@3.1.0 hooks pre-command \"$TOOL_INPUT_command\""
      }]
    }
  ]
}
```

### PostToolUse Hooks
Triggered after successful tool execution.

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [{
        "type": "command",
        "command": "npx agentic-flow@3.1.0 hooks post-edit \"$TOOL_INPUT_file_path\" --success"
      }]
    }
  ]
}
```

### Session Hooks
Triggered at session start/end.

```json
{
  "SessionStart": [{
    "hooks": [{
      "type": "command",
      "command": "npx agentic-flow@3.1.0 hooks intelligence stats --json"
    }]
  }],
  "SessionEnd": [{
    "hooks": [{
      "type": "command",
      "command": "npx agentic-flow@3.1.0 hooks metrics --session --json"
    }]
  }]
}
```

## Hook Commands

```bash
# Pre-edit: Check for patterns, validate
npx agentic-flow@3.1.0 hooks pre-edit "src/api.ts"

# Post-edit: Format, learn pattern
npx agentic-flow@3.1.0 hooks post-edit "src/api.ts" --success

# Pre-command: Validate safety
npx agentic-flow@3.1.0 hooks pre-command "npm install"

# Post-command: Track result
npx agentic-flow@3.1.0 hooks post-command "npm install"

# Intelligence routing
npx agentic-flow@3.1.0 hooks route "implement OAuth"

# Session metrics
npx agentic-flow@3.1.0 hooks metrics --session
```

## Automation Features

### Auto-Agent Assignment
Hooks automatically assign specialized agents based on file type:
- `.ts`, `.tsx` → TypeScript agent
- `.py` → Python agent
- `.md` → Documentation agent
- `test.*` → Testing agent

### Command Validation
Pre-command hooks validate for:
- Dangerous patterns (rm -rf, force push)
- Permission requirements
- Resource limits

### Pattern Learning
Post-edit hooks learn:
- Code patterns
- Successful solutions
- Error recovery strategies

### Metrics Tracking
Session hooks track:
- Token usage
- Tool invocations
- Success rates
- Performance metrics

## Configuration

Full hook configuration in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [...],
    "PostToolUse": [...],
    "PostToolUseFailure": [...],
    "SessionStart": [...],
    "SessionEnd": [...],
    "UserPromptSubmit": [...],
    "Stop": [...]
  }
}
```

## Best Practices

1. **Keep hooks fast**: <100ms for interactive experience
2. **Use timeout**: Prevent hanging hooks
3. **Handle failures gracefully**: Use `|| true` for optional hooks
4. **Log metrics**: Track for optimization
5. **Test hooks**: Verify before deployment
