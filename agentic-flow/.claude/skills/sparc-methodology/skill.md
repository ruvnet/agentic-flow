---
name: sparc-methodology
description: SPARC development methodology for systematic test-driven development
version: 1.0.0
invocable: true
author: agentic-flow
capabilities:
  - specification
  - pseudocode
  - architecture
  - refinement
  - completion
---

# SPARC Methodology Skill

Systematic Test-Driven Development using SPARC (Specification, Pseudocode, Architecture, Refinement, Completion).

## Quick Commands

```bash
# Run complete TDD workflow
npx agentic-flow@3.1.0 sparc tdd "implement user authentication"

# Run specific phase
npx agentic-flow@3.1.0 sparc run specification "auth system"
npx agentic-flow@3.1.0 sparc run pseudocode "auth system"
npx agentic-flow@3.1.0 sparc run architect "auth system"
npx agentic-flow@3.1.0 sparc run refinement "auth system"
npx agentic-flow@3.1.0 sparc run completion "auth system"

# Batch execution
npx agentic-flow@3.1.0 sparc batch "spec-pseudocode,architect" "feature X"
```

## SPARC Phases

### 1. Specification (spec)
Define requirements and acceptance criteria.

**Agent**: `specification`
**Output**: Requirements doc, test cases
**Command**:
```bash
npx agentic-flow@3.1.0 sparc run spec "user login feature"
```

### 2. Pseudocode (pseudo)
Design algorithms and logic flow.

**Agent**: `pseudocode`
**Output**: Algorithm design, flow diagrams
**Command**:
```bash
npx agentic-flow@3.1.0 sparc run pseudo "auth flow"
```

### 3. Architecture (arch)
System design and component structure.

**Agent**: `architecture`
**Output**: Component diagram, API design
**Command**:
```bash
npx agentic-flow@3.1.0 sparc run arch "microservices layout"
```

### 4. Refinement (refine)
Iterative TDD implementation.

**Agent**: `refinement`
**Output**: Tests + Implementation
**Command**:
```bash
npx agentic-flow@3.1.0 sparc run refine "auth module"
```

### 5. Completion (complete)
Integration and deployment.

**Agent**: `completion`
**Output**: Integrated system, docs
**Command**:
```bash
npx agentic-flow@3.1.0 sparc run complete "auth system"
```

## SPARC Modes

Additional specialized modes:

| Mode | Description |
|------|-------------|
| `dev` | General development |
| `api` | API design |
| `ui` | UI/UX development |
| `test` | Testing focus |
| `refactor` | Code improvement |
| `debug` | Bug investigation |
| `security` | Security review |
| `devops` | CI/CD setup |

## TDD Workflow

```bash
# Full TDD cycle
npx agentic-flow@3.1.0 sparc tdd "implement OAuth2"

# This runs:
# 1. Specification: Define requirements
# 2. Pseudocode: Design algorithm
# 3. Architecture: Plan structure
# 4. Refinement: Write tests first, then implement
# 5. Completion: Integrate and document
```

## Agent Integration

SPARC uses specialized agents:

```javascript
// Via Claude Code Task tool
Task("Specification agent", "Define requirements for OAuth", "specification")
Task("Architecture agent", "Design OAuth architecture", "architecture")
Task("Coder agent", "Implement OAuth with TDD", "sparc-coder")
Task("Tester agent", "Verify OAuth implementation", "tester")
Task("Reviewer agent", "Review OAuth code quality", "reviewer")
```

## Best Practices

1. **Start with specification**: Clear requirements first
2. **Write tests first**: TDD in refinement phase
3. **Iterate small**: Small increments
4. **Document as you go**: Keep docs updated
5. **Review at each phase**: Quality gates
6. **Use parallel execution**: Multiple agents
