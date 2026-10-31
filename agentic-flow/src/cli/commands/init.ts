#!/usr/bin/env node
/**
 * CLI Init Command
 * Creates .claude/ folder structure and configuration files for Claude Code integration
 * Copies all agents, commands, skills, and helpers from the package
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The installed package version, so generated hooks and the MCP server run
 * exactly this release instead of whatever the @alpha tag points at later.
 */
export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'));
    if (typeof pkg.version === 'string' && /^\d+\.\d+\.\d+[\w.+-]*$/.test(pkg.version)) return pkg.version;
  } catch {
    // fall through
  }
  return 'latest';
}

const PACKAGE_SPEC = `agentic-flow@${readPackageVersion()}`;

const CLAUDE_MD_TEMPLATE = `# Claude Code Configuration - Agentic Flow

## 🚨 CRITICAL: CONCURRENT EXECUTION & FILE MANAGEMENT

**ABSOLUTE RULES**:
1. ALL operations MUST be concurrent/parallel in a single message
2. **NEVER save working files, text/mds and tests to the root folder**
3. ALWAYS organize files in appropriate subdirectories
4. **USE CLAUDE CODE'S TASK TOOL** for spawning agents concurrently, not just MCP

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**MANDATORY PATTERNS:**
- **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
- **Task tool (Claude Code)**: ALWAYS spawn ALL agents in ONE message with full instructions
- **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
- **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
- **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### 🎯 CRITICAL: Claude Code Task Tool for Agent Execution

**Claude Code's Task tool is the PRIMARY way to spawn agents:**
\`\`\`javascript
// ✅ CORRECT: Use Claude Code's Task tool for parallel agent execution
[Single Message]:
  Task("Research agent", "Analyze requirements and patterns...", "researcher")
  Task("Coder agent", "Implement core features...", "coder")
  Task("Tester agent", "Create comprehensive tests...", "tester")
  Task("Reviewer agent", "Review code quality...", "reviewer")
  Task("Architect agent", "Design system architecture...", "system-architect")
\`\`\`

**MCP tools are ONLY for coordination setup:**
- \`mcp__claude-flow__swarm_init\` - Initialize coordination topology
- \`mcp__claude-flow__agent_spawn\` - Define agent types for coordination
- \`mcp__claude-flow__task_orchestrate\` - Orchestrate high-level workflows

### 📁 File Organization Rules

**NEVER save to root folder. Use these directories:**
- \`/src\` - Source code files
- \`/tests\` - Test files
- \`/docs\` - Documentation and markdown files
- \`/config\` - Configuration files
- \`/scripts\` - Utility scripts
- \`/examples\` - Example code

## 🚀 Quick Start

\`\`\`bash
# Start MCP server for Claude Code integration
npx ${PACKAGE_SPEC} mcp start

# Run an agent directly
npx ${PACKAGE_SPEC} --agent coder --task "Your task here"

# List available agents
npx ${PACKAGE_SPEC} --list
\`\`\`

## 🚀 Available Agents (54 Total)

### Core Development
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### Swarm Coordination
\`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`, \`collective-intelligence-coordinator\`, \`swarm-memory-manager\`

### Consensus & Distributed
\`byzantine-coordinator\`, \`raft-manager\`, \`gossip-coordinator\`, \`consensus-builder\`, \`crdt-synchronizer\`, \`quorum-manager\`, \`security-manager\`

### Performance & Optimization
\`perf-analyzer\`, \`performance-benchmarker\`, \`task-orchestrator\`, \`memory-coordinator\`, \`smart-agent\`

### GitHub & Repository
\`github-modes\`, \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`, \`workflow-automation\`, \`project-board-sync\`, \`repo-architect\`, \`multi-repo-swarm\`

### SPARC Methodology
\`sparc-coord\`, \`sparc-coder\`, \`specification\`, \`pseudocode\`, \`architecture\`, \`refinement\`

### Specialized Development
\`backend-dev\`, \`mobile-dev\`, \`ml-developer\`, \`cicd-engineer\`, \`api-docs\`, \`system-architect\`, \`code-analyzer\`, \`base-template-generator\`

## 🎯 Claude Code vs MCP Tools

### Claude Code Handles ALL EXECUTION:
- **Task tool**: Spawn and run agents concurrently for actual work
- File operations (Read, Write, Edit, MultiEdit, Glob, Grep)
- Code generation and programming
- Bash commands and system operations
- Implementation work
- Project navigation and analysis
- TodoWrite and task management
- Git operations
- Package management
- Testing and debugging

### MCP Tools ONLY COORDINATE:
- Swarm initialization (topology setup)
- Agent type definitions (coordination patterns)
- Task orchestration (high-level planning)
- Memory management
- Neural features
- Performance tracking
- GitHub integration

**KEY**: MCP coordinates the strategy, Claude Code's Task tool executes with real agents.

## MCP Tool Categories

### Coordination
\`swarm_init\`, \`agent_spawn\`, \`task_orchestrate\`

### Monitoring
\`swarm_status\`, \`agent_list\`, \`agent_metrics\`, \`task_status\`, \`task_results\`

### Memory & Neural
\`memory_usage\`, \`neural_status\`, \`neural_train\`, \`neural_patterns\`

### GitHub Integration
\`github_swarm\`, \`repo_analyze\`, \`pr_enhance\`, \`issue_triage\`, \`code_review\`

## 🧠 Self-Learning Hooks System

### Available Hooks Commands:
\`\`\`bash
# Before editing - get context and agent suggestions
npx ${PACKAGE_SPEC} hooks pre-edit <filePath>

# After editing - record outcome for learning
npx ${PACKAGE_SPEC} hooks post-edit <filePath> --success true

# Before commands - assess risk
npx ${PACKAGE_SPEC} hooks pre-command "<command>"

# After commands - record outcome
npx ${PACKAGE_SPEC} hooks post-command "<command>" --success true

# Route task to optimal agent using learned patterns
npx ${PACKAGE_SPEC} hooks route "<task description>"

# Explain routing decision with transparency
npx ${PACKAGE_SPEC} hooks explain "<task description>"

# Bootstrap intelligence from repository
npx ${PACKAGE_SPEC} hooks pretrain

# Generate optimized agent configs from pretrain data
npx ${PACKAGE_SPEC} hooks build-agents

# View learning metrics dashboard
npx ${PACKAGE_SPEC} hooks metrics

# Transfer patterns from another project
npx ${PACKAGE_SPEC} hooks transfer <sourceProject>

# RuVector intelligence (SONA, MoE, HNSW 150x faster)
npx ${PACKAGE_SPEC} hooks intelligence
\`\`\`

### Pretraining System (4-Step Pipeline):
1. **RETRIEVE** - Top-k memory injection with MMR diversity
2. **JUDGE** - LLM-as-judge trajectory evaluation
3. **DISTILL** - Extract strategy memories from trajectories
4. **CONSOLIDATE** - Dedup, detect contradictions, prune old patterns

## Performance Benefits

- **84.8% SWE-Bench solve rate**
- **32.3% token reduction**
- **2.8-4.4x speed improvement**
- **27+ neural models**

## Advanced Features (v2.0.0)

- 🚀 Automatic Topology Selection
- ⚡ Parallel Execution (2.8-4.4x speed)
- 🧠 Neural Training
- 📊 Bottleneck Analysis
- 🤖 Smart Auto-Spawning
- 🛡️ Self-Healing Workflows
- 💾 Cross-Session Memory
- 🔗 GitHub Integration

## Code Style & Best Practices

- **Modular Design**: Files under 500 lines
- **Environment Safety**: Never hardcode secrets
- **Test-First**: Write tests before implementation
- **Clean Architecture**: Separate concerns
- **Documentation**: Keep updated

## Support

- Documentation: https://github.com/ruvnet/agentic-flow
- Issues: https://github.com/ruvnet/agentic-flow/issues

---

Remember: **Agentic Flow coordinates, Claude Code creates!**

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
Never save working files, text/mds and tests to the root folder.
`;

/**
 * settings.json written by `init`. Hooks and the MCP server are pinned to
 * `version`. Permissions do not pre-approve npx/npm or whole MCP servers:
 * those would let any package or tool run without a prompt.
 */
export function buildSettingsTemplate(version: string = readPackageVersion()) {
  const spec = `agentic-flow@${version}`;
  return {
    model: "claude-sonnet-4-20250514",
    customInstructions: "Follow the project's CLAUDE.md guidelines. Use concurrent execution for all operations.",
    env: {
      AGENTIC_FLOW_INTELLIGENCE: "true",
      AGENTIC_FLOW_LEARNING_RATE: "0.1",
      AGENTIC_FLOW_EPSILON: "0.1",
      AGENTIC_FLOW_MEMORY_BACKEND: "agentdb"
    },
    permissions: {
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "WebFetch", "WebSearch", "TodoWrite", "LSP", "NotebookEdit"],
      deniedTools: [],
      allow: [
        "Bash(agentic-flow:*)",
        "mcp__ruv-swarm"
      ]
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: `npx ${spec} hooks pre-edit "$TOOL_INPUT_file_path"` }]
        },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `npx ${spec} hooks pre-command "$TOOL_INPUT_command"` }]
        }
      ],
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: `npx ${spec} hooks post-edit "$TOOL_INPUT_file_path" --success` }]
        },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `npx ${spec} hooks post-command "$TOOL_INPUT_command"` }]
        }
      ],
      PostToolUseFailure: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: `npx ${spec} hooks post-edit "$TOOL_INPUT_file_path" --fail --error "$ERROR_MESSAGE"` }]
        }
      ],
      SessionStart: [
        {
          hooks: [{ type: "command", command: `npx ${spec} hooks intelligence stats --json 2>/dev/null || true` }]
        }
      ],
      SessionEnd: [
        {
          hooks: [{ type: "command", command: `npx ${spec} hooks metrics --session --json 2>/dev/null || true` }]
        }
      ],
      UserPromptSubmit: [
        {
          hooks: [
            { type: "command", timeout: 3000, command: `npx ${spec} hooks route "$USER_PROMPT" --json 2>/dev/null || true` }
          ]
        }
      ],
      Stop: [
        {
          matcher: ".*",
          hooks: [{ type: "command", command: `npx ${spec} hooks metrics --session 2>/dev/null || true` }]
        }
      ]
    },
    agents: {
      source: ".claude/agents",
      customAgents: []
    },
    skills: {
      source: ".claude/commands",
      enabled: true
    },
    statusLine: {
      type: "command",
      command: ".claude/statusline.sh"
    },
    mcpServers: {
      "agentic-flow": {
        command: "npx",
        args: [spec, "mcp", "start"]
      }
    }
  };
}

interface InitOptions {
  force?: boolean;
  minimal?: boolean;
  verbose?: boolean;
}

/**
 * Recursively copy a directory
 */
function copyDirRecursive(src: string, dest: string, verbose: boolean = false): number {
  let fileCount = 0;

  if (!fs.existsSync(src)) {
    return fileCount;
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fileCount += copyDirRecursive(srcPath, destPath, verbose);
    } else {
      fs.copyFileSync(srcPath, destPath);
      fileCount++;
      if (verbose) {
        console.log(`   📄 ${path.relative(dest, destPath)}`);
      }
    }
  }

  return fileCount;
}

/**
 * Find the package's .claude directory
 */
function findPackageClaudeDir(): string | null {
  // Try multiple potential locations
  const potentialPaths = [
    // When running from dist/
    path.resolve(__dirname, '..', '..', '..', '.claude'),
    // When running from src/
    path.resolve(__dirname, '..', '..', '.claude'),
    // When installed as package
    path.resolve(__dirname, '..', '.claude'),
    // Fallback to package root
    path.resolve(process.cwd(), 'node_modules', 'agentic-flow', '.claude'),
  ];

  for (const p of potentialPaths) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      return p;
    }
  }

  return null;
}

export async function handleInitCommand(args: string[]): Promise<void> {
  const options: InitOptions = {
    force: args.includes('--force') || args.includes('-f'),
    minimal: args.includes('--minimal') || args.includes('-m'),
    verbose: args.includes('--verbose') || args.includes('-v')
  };

  if (args.includes('--help') || args.includes('-h')) {
    printInitHelp();
    return;
  }

  const cwd = process.cwd();
  const claudeDir = path.join(cwd, '.claude');
  const claudeMdFile = path.join(cwd, 'CLAUDE.md');

  console.log(`
╔═══════════════════════════════════════════════════════╗
║       Agentic Flow - Project Initialization           ║
╚═══════════════════════════════════════════════════════╝
`);

  // Check if already initialized
  if (fs.existsSync(claudeDir) && !options.force) {
    console.log('⚠️  .claude/ directory already exists.');
    console.log('   Use --force to overwrite existing configuration.\n');
    return;
  }

  try {
    // Find the package's .claude directory
    const packageClaudeDir = findPackageClaudeDir();

    if (packageClaudeDir && !options.minimal) {
      console.log('📦 Copying full .claude/ structure from agentic-flow package...\n');

      // Copy entire .claude directory structure
      const directories = ['agents', 'commands', 'skills', 'helpers'];
      let totalFiles = 0;

      for (const dir of directories) {
        const srcDir = path.join(packageClaudeDir, dir);
        const destDir = path.join(claudeDir, dir);

        if (fs.existsSync(srcDir)) {
          const count = copyDirRecursive(srcDir, destDir, options.verbose);
          totalFiles += count;
          console.log(`✅ Copied .claude/${dir}/ (${count} files)`);
        }
      }

      // Copy individual files (settings.json is generated fresh with our template).
      // mcp.json is not copied: the packaged one pointed at a developer-machine
      // path (/workspaces/flow-cloud/...), so every initialized project got a
      // flow-nexus MCP server entry that could not start.
      const individualFiles = ['statusline.sh'];
      for (const file of individualFiles) {
        const srcFile = path.join(packageClaudeDir, file);
        const destFile = path.join(claudeDir, file);
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, destFile);
          console.log(`✅ Copied .claude/${file}`);
          totalFiles++;
        }
      }

      console.log(`\n📊 Total: ${totalFiles} files copied`);
    } else {
      // Minimal mode: create basic structure
      console.log('📦 Creating minimal .claude/ structure...\n');

      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      const dirs = ['agents', 'commands', 'skills', 'helpers'];
      for (const dir of dirs) {
        const dirPath = path.join(claudeDir, dir);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
          console.log(`✅ Created .claude/${dir}/`);
        }
      }
    }

    // Always generate fresh settings.json with our template
    const settingsFile = path.join(claudeDir, 'settings.json');
    if (!fs.existsSync(settingsFile) || options.force) {
      fs.writeFileSync(settingsFile, JSON.stringify(buildSettingsTemplate(), null, 2));
      console.log('✅ Created .claude/settings.json (with hooks, agents, skills, statusline)');
    }

    // Create CLAUDE.md in project root (unless minimal mode)
    if (!options.minimal) {
      if (!fs.existsSync(claudeMdFile) || options.force) {
        fs.writeFileSync(claudeMdFile, CLAUDE_MD_TEMPLATE);
        console.log('✅ Created CLAUDE.md');
      } else {
        console.log('ℹ️  CLAUDE.md already exists (skipped)');
      }
    }

    console.log(`
╔═══════════════════════════════════════════════════════╗
║                 Initialization Complete!               ║
╚═══════════════════════════════════════════════════════╝

📁 Created structure:
   .claude/
   ├── settings.json      # Claude Code settings (hooks, agents, skills, statusline)
   ├── statusline.sh      # Custom statusline (model, tokens, cost, swarm status)
   ├── agents/            # 80+ agent definitions (coder, tester, reviewer, etc.)
   ├── commands/          # 100+ slash commands (swarm, github, sparc, etc.)
   ├── skills/            # Custom skills and workflows
   └── helpers/           # Helper utilities
   CLAUDE.md              # Project instructions

🚀 Next steps:
   1. Start the MCP server:
      npx ${PACKAGE_SPEC} mcp start

   2. Run Claude Code:
      claude

   3. Or run agents directly:
      npx ${PACKAGE_SPEC} --agent coder --task "Your task"

📖 Documentation:
   https://github.com/ruvnet/agentic-flow
`);

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
}

function printInitHelp(): void {
  console.log(`
Agentic Flow - Project Initialization

USAGE:
  npx ${PACKAGE_SPEC} init [OPTIONS]

OPTIONS:
  --force, -f     Overwrite existing configuration
  --minimal, -m   Create minimal setup (empty directories only)
  --verbose, -v   Show detailed file copy output
  --help, -h      Show this help

EXAMPLES:
  npx ${PACKAGE_SPEC} init               # Initialize with full agent/command library
  npx ${PACKAGE_SPEC} init --force       # Reinitialize (overwrite existing)
  npx ${PACKAGE_SPEC} init --minimal     # Minimal setup (empty directories)
  npx ${PACKAGE_SPEC} init --verbose     # Show all files being copied

CREATED FILES:
  .claude/                  Claude Code configuration directory
  .claude/settings.json     Settings with hooks, agents, skills, statusline, MCP servers
  .claude/agents/           80+ agent definitions (coder, tester, reviewer, sparc, etc.)
  .claude/commands/         100+ slash commands (swarm, github, sparc, etc.)
  .claude/skills/           Custom skills and workflows
  .claude/helpers/          Helper utilities
  CLAUDE.md                 Project instructions for Claude
`);
}

// Run if executed directly
if (process.argv[1]?.endsWith('init.js') || process.argv[1]?.endsWith('init.ts')) {
  const args = process.argv.slice(2);
  handleInitCommand(args);
}
