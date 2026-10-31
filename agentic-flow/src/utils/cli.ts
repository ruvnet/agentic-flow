// CLI argument parsing and help utilities

export interface CliOptions {
  mode: 'agent' | 'parallel' | 'list' | 'mcp' | 'mcp-manager' | 'config' | 'agent-manager' | 'proxy' | 'quic' | 'claude-code' | 'reasoningbank' | 'federation' | 'hooks' | 'workers' | 'embeddings' | 'init';
  agent?: string;
  task?: string;

  // Provider Configuration
  model?: string;
  provider?: string;

  // API Configuration
  anthropicApiKey?: string;
  openrouterApiKey?: string;

  // Agent Behavior
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;

  // Directory Configuration
  agentsDir?: string;

  // Output Options
  outputFormat?: 'text' | 'json' | 'markdown';
  verbose?: boolean;

  // Execution Control
  timeout?: number;
  retryOnError?: boolean;

  // Model Optimization
  optimize?: boolean;
  optimizePriority?: 'quality' | 'balanced' | 'cost' | 'speed' | 'privacy';
  maxCost?: number;

  // Agent Booster Integration
  claudeCode?: boolean; // Use Agent Booster for 57x faster code edits
  agentBooster?: boolean; // Enable Agent Booster pre-processing
  boosterThreshold?: number; // Confidence threshold for Agent Booster

  help?: boolean;
  version?: boolean;
  mcpCommand?: string; // start, stop, status, list
  mcpServer?: string; // claude-flow, flow-nexus, agentic-payments, all
}

export function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    mode: 'parallel'
  };

  // Check for proxy command first
  if (args[0] === 'proxy') {
    options.mode = 'proxy';
    return options;
  }

  // Check for claude-code command
  if (args[0] === 'claude-code') {
    options.mode = 'claude-code';
    return options;
  }

  // Check for quic command
  if (args[0] === 'quic') {
    options.mode = 'quic';
    return options;
  }

  // Check for MCP command
  if (args[0] === 'mcp') {
    const mcpSubcommand = args[1];

    // MCP Manager commands (CLI configuration)
    const managerCommands = ['add', 'list', 'remove', 'enable', 'disable', 'update', 'test', 'info', 'export', 'import'];

    if (managerCommands.includes(mcpSubcommand)) {
      options.mode = 'mcp-manager';
      return options;
    }

    // MCP Server commands (start/stop server)
    options.mode = 'mcp';
    options.mcpCommand = mcpSubcommand || 'start'; // default to start
    options.mcpServer = args[2] || 'all'; // default to all servers
    return options;
  }

  // Check for config command
  if (args[0] === 'config') {
    options.mode = 'config';
    return options;
  }

  // Check for agent management command
  if (args[0] === 'agent') {
    options.mode = 'agent-manager';
    return options;
  }

  // Check for federation command
  if (args[0] === 'federation') {
    options.mode = 'federation';
    return options;
  }

  // Check for reasoningbank command
  if (args[0] === 'reasoningbank') {
    options.mode = 'reasoningbank';
    return options;
  }

  // Check for hooks command
  if (args[0] === 'hooks') {
    options.mode = 'hooks';
    return options;
  }

  // Check for workers command
  if (args[0] === 'workers') {
    options.mode = 'workers';
    return options;
  }

  // Check for embeddings command
  if (args[0] === 'embeddings') {
    options.mode = 'embeddings';
    return options;
  }

  // Check for init command
  if (args[0] === 'init') {
    options.mode = 'init';
    return options;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;

      case '--version':
      case '-v':
        options.version = true;
        break;

      case '--agent':
      case '-a':
        options.mode = 'agent';
        options.agent = args[++i];
        break;

      case '--task':
      case '-t':
        options.task = args[++i];
        break;

      case '--model':
      case '-m':
        options.model = args[++i];
        break;

      case '--provider':
      case '-p':
        options.provider = args[++i];
        break;

      case '--stream':
      case '-s':
        options.stream = true;
        break;

      case '--list':
      case '-l':
        options.mode = 'list';
        break;

      // API Configuration
      case '--anthropic-key':
        options.anthropicApiKey = args[++i];
        break;

      case '--openrouter-key':
        options.openrouterApiKey = args[++i];
        break;

      // Agent Behavior
      case '--temperature':
        options.temperature = parseFloat(args[++i]);
        break;

      case '--max-tokens':
        options.maxTokens = parseInt(args[++i], 10);
        break;

      // Directory Configuration
      case '--agents-dir':
        options.agentsDir = args[++i];
        break;

      // Output Options
      case '--output':
        options.outputFormat = args[++i] as 'text' | 'json' | 'markdown';
        break;

      case '--verbose':
        options.verbose = true;
        break;

      // Execution Control
      case '--timeout':
        options.timeout = parseInt(args[++i], 10);
        break;

      case '--retry':
        options.retryOnError = true;
        break;

      // Model Optimization
      case '--optimize':
      case '-O':
        options.optimize = true;
        break;

      case '--priority':
        options.optimizePriority = args[++i] as 'quality' | 'balanced' | 'cost' | 'speed' | 'privacy';
        break;

      case '--max-cost':
        options.maxCost = parseFloat(args[++i]);
        break;

      // Agent Booster
      case '--agent-booster':
      case '--booster':
        options.agentBooster = true;
        break;

      case '--booster-threshold':
        options.boosterThreshold = parseFloat(args[++i]);
        break;
    }
  }

  // Check environment variable for Agent Booster
  if (process.env.AGENTIC_FLOW_AGENT_BOOSTER === 'true') {
    options.agentBooster = true;
  }
  if (process.env.AGENTIC_FLOW_BOOSTER_THRESHOLD) {
    options.boosterThreshold = parseFloat(process.env.AGENTIC_FLOW_BOOSTER_THRESHOLD);
  }

  return options;
}

export function printHelp(): void {
  console.log(`
🤖 Agentic Flow - AI Agent Orchestration CLI

USAGE:
  npx agentic-flow [COMMAND] [OPTIONS]

COMMANDS:
  init                    Initialize project with .claude/ folder and configuration
  reasoningbank <cmd>     Memory system that learns from experience (demo, test, init)
  claude-code [options]   Spawn Claude Code with proxy + Agent Booster (57x faster edits)
  mcp <command> [server]  Manage MCP servers (start, stop, status, list)
  config [command]        Configuration wizard (set, get, list, delete, reset)
  agent <command>         Agent management (list, create, info, conflicts)
  --list, -l              List all available agents
  --agent, -a <name>      Run specific agent mode
  (default)               Run parallel mode (3 agents)

REASONINGBANK COMMANDS:
  npx agentic-flow reasoningbank demo         Run interactive demo comparison
  npx agentic-flow reasoningbank test         Run validation tests
  npx agentic-flow reasoningbank init         Initialize database
  npx agentic-flow reasoningbank benchmark    Run performance benchmarks
  npx agentic-flow reasoningbank status       Show memory statistics

MCP COMMANDS:
  npx agentic-flow mcp start [server]    Start MCP server(s)
  npx agentic-flow mcp stop [server]     Stop MCP server(s)
  npx agentic-flow mcp status [server]   Check MCP server status
  npx agentic-flow mcp list              List all available MCP tools

  Available servers: claude-flow, flow-nexus, agentic-payments, all (default)

OPTIONS:
  --task, -t <task>           Task description for agent mode
  --model, -m <model>         Model to use (supports OpenRouter models)
  --provider, -p <name>       Provider (anthropic, openrouter, onnx)
  --stream, -s                Enable real-time streaming output

  API CONFIGURATION:
  --anthropic-key <key>       Override ANTHROPIC_API_KEY
  --openrouter-key <key>      Override OPENROUTER_API_KEY

  AGENT BEHAVIOR:
  --temperature <0.0-1.0>     Sampling temperature (creativity)
  --max-tokens <number>       Maximum response tokens

  DIRECTORY:
  --agents-dir <path>         Custom agents directory

  OUTPUT:
  --output <text|json|md>     Output format
  --verbose                   Enable verbose logging

  EXECUTION:
  --timeout <ms>              Execution timeout
  --retry                     Auto-retry on errors

  MODEL OPTIMIZATION:
  --optimize, -O              Auto-select best model for agent/task
  --priority <type>           Optimization priority (quality|balanced|cost|speed|privacy)
  --max-cost <dollars>        Maximum cost per task in dollars

  AGENT BOOSTER (200x faster code edits!):
  --agent-booster             Enable Agent Booster pre-processing
  --booster-threshold <0-1>   Confidence threshold (default: 0.7)

  --help, -h                  Show this help message

EXAMPLES:
  # ReasoningBank (Learn from agent experience!)
  npx agentic-flow reasoningbank demo       # See 0% → 100% success transformation
  npx agentic-flow reasoningbank test       # Run 27 validation tests
  npx agentic-flow reasoningbank init       # Setup memory database
  export ANTHROPIC_API_KEY=sk-ant-...      # Enable LLM-based learning

  # Agent Booster Integration (200x faster code edits!)
  npx agentic-flow --agent coder --task "Convert var to const in utils.js" --agent-booster
  npx agentic-flow --agent coder --task "Add types to api.ts" --agent-booster --provider openrouter
  export AGENTIC_FLOW_AGENT_BOOSTER=true  # Enable for all tasks

  # Claude Code with Agent Booster
  npx agentic-flow claude-code --provider openrouter --agent-booster
  npx agentic-flow claude-code --provider gemini "Write a REST API"
  npx agentic-flow claude-code --help     # See all claude-code options

  # Agent Management
  npx agentic-flow agent list             # List all agents with sources
  npx agentic-flow agent create           # Interactive agent creator
  npx agentic-flow agent info coder       # Get agent details
  npx agentic-flow agent conflicts        # Check for conflicts

  # Configuration
  npx agentic-flow config                 # Interactive config wizard
  npx agentic-flow config set PROVIDER openrouter
  npx agentic-flow config list            # View all settings

  # MCP Server Management
  npx agentic-flow mcp start              # Start all MCP servers
  npx agentic-flow mcp list               # List all 209+ MCP tools

  # Agent Execution (Basic)
  npx agentic-flow --list                 # List all agents
  npx agentic-flow --agent coder --task "Build REST API"

  # Agent Execution (Advanced)
  npx agentic-flow --agent coder --task "Build API" \\
    --provider openrouter \\
    --model "meta-llama/llama-3.1-8b-instruct" \\
    --temperature 0.7 \\
    --max-tokens 2000 \\
    --output json \\
    --verbose

  # Agent Execution (Custom)
  npx agentic-flow --agent my-custom-agent --task "Your task" \\
    --agents-dir ./my-agents

  # Parallel Mode
  npx agentic-flow  # Run 3 agents in parallel

  # Model Optimization (Auto-select best model)
  npx agentic-flow --agent coder --task "Build API" --optimize
  npx agentic-flow --agent coder --task "Build API" --optimize --priority cost
  npx agentic-flow --agent researcher --task "Analyze data" --optimize --priority quality
  npx agentic-flow --agent coder --task "Simple function" --optimize --max-cost 0.001

ENVIRONMENT VARIABLES:
  (read from the environment and ./.env only; *_BASE_URL and *_PROXY_* keys
   are ignored in ./.env unless the file is passed with --env-file <path>)
  ANTHROPIC_API_KEY       Anthropic API key (for Claude models)
  OPENROUTER_API_KEY      OpenRouter API key (for alternative models)
  USE_ONNX                Set to 'true' to force ONNX local inference
  AGENT                   Agent name for agent mode
  TASK                    Task description for agent mode
  MODEL                   Model override for agent mode
  PROVIDER                Provider to use (anthropic, openrouter, onnx)
  TOPIC                   Research topic for parallel mode
  DIFF                    Code diff for parallel mode
  DATASET                 Dataset hint for parallel mode
  ENABLE_STREAMING        Enable streaming (true/false)
  HEALTH_PORT             Health check port (default: 8080)

MCP TOOLS (209+ available):
  • agentic-flow: 6 tools (agent execution, creation, management)
  • claude-flow: 101 tools (neural networks, GitHub, workflows, DAA)
  • flow-nexus: 96 cloud tools (sandboxes, distributed swarms, templates)
  • agentic-payments: 6 tools (payment authorization, multi-agent consensus)

PARALLEL EXECUTION & SWARM OPTIMIZATION (v2.0):
  • Automatic Topology Selection: AI recommends optimal swarm configuration
  • Self-Learning System: Learns from 100+ execution patterns (0.6 → 0.95 confidence)
  • Pattern Recognition: ReasoningBank stores & retrieves successful strategies
  • Performance Tracking: 3.5-5.0x speedup with hierarchical topology
  • Reward System: Multi-factor scoring (speedup, success rate, efficiency)
  • Adaptive Optimization: Improves recommendations over time

  Supported Topologies:
    - Mesh (1-10 agents): Full peer-to-peer coordination (2.5x speedup)
    - Hierarchical (6-50 agents): Coordinator delegation (3.5-4.0x speedup) ⭐ BEST
    - Ring (1-20 agents): Sequential token passing + parallel processing
    - Star (1-30 agents): Central coordinator pattern

  Usage Example (CLI subprocess spawning):
    const results = await Promise.all([
      exec('npx agentic-flow --agent researcher --task "domain1"'),
      exec('npx agentic-flow --agent researcher --task "domain2"'),
      exec('npx agentic-flow --agent coder --task "implement"')
    ]);

  Auto-Optimization Example:
    import { autoSelectSwarmConfig } from './hooks/swarm-learning-optimizer';
    const config = await autoSelectSwarmConfig(reasoningBank, taskDesc, options);
    // Returns: recommendedTopology, expectedSpeedup, confidence, reasoning

  See: /agentic-flow/src/prompts/parallel-execution-guide.md (v2.0)
       /docs/swarm-optimization-report.md

For more information, visit: https://github.com/ruvnet/agentic-flow
  `);
}

export function validateOptions(options: CliOptions): string | null {
  if (options.mode === 'agent') {
    if (!options.agent && !process.env.AGENT) {
      return 'Agent mode requires --agent <name> or AGENT env variable';
    }
    if (!options.task && !process.env.TASK) {
      return 'Agent mode requires --task <description> or TASK env variable';
    }
  }

  return null;
}
