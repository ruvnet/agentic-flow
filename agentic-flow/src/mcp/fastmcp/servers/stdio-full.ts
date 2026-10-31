#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing catch(error: any) handlers; outside scope of CWE-78 fix */
// Full FastMCP server with stdio transport - All 11 claude-flow-sdk tools
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { execFileSync } from 'child_process';
import { assertSlug, resolveAgentDir, resolveWithin } from '../../../utils/path-safety.js';

// Security: All shell-outs use execFileSync with argv arrays (shell: false) to
// prevent OS command injection via tool parameters (CWE-78). Do NOT reintroduce
// execSync with template-string interpolation here.
const NPX_EXEC_OPTS = { shell: false as const };

console.error('🚀 Starting FastMCP Full Server (stdio transport)...');
console.error('📦 Loading 11 tools: memory (3), swarm (3), agent (5)');

// Create server
const server = new FastMCP({
  name: 'fastmcp-stdio-full',
  version: '1.0.0'
});

// Tool 1: Memory Store
server.addTool({
  name: 'memory_store',
  description: 'Store a value in persistent memory with optional namespace and TTL',
  parameters: z.object({
    key: z.string().min(1).describe('Memory key'),
    value: z.string().describe('Value to store'),
    namespace: z.string().optional().default('default').describe('Memory namespace'),
    ttl: z.number().positive().optional().describe('Time-to-live in seconds')
  }),
  execute: async ({ key, value, namespace, ttl }) => {
    try {
      const args = ['claude-flow@alpha', 'memory', 'store', key, value, '--namespace', namespace];
      if (ttl) args.push('--ttl', String(ttl));

      execFileSync('npx', args, { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

      return JSON.stringify({
        success: true,
        key,
        namespace,
        size: value.length,
        ttl,
        timestamp: new Date().toISOString(),
        message: 'Memory stored successfully'
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to store memory: ${error.message}`);
    }
  }
});

// Tool 2: Memory Retrieve
server.addTool({
  name: 'memory_retrieve',
  description: 'Retrieve a value from persistent memory',
  parameters: z.object({
    key: z.string().min(1).describe('Memory key'),
    namespace: z.string().optional().default('default').describe('Memory namespace')
  }),
  execute: async ({ key, namespace }) => {
    try {
      const result = execFileSync(
        'npx',
        ['claude-flow@alpha', 'memory', 'retrieve', key, '--namespace', namespace],
        { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      return JSON.stringify({
        success: true,
        key,
        namespace,
        value: result.trim(),
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to retrieve memory: ${error.message}`);
    }
  }
});

// Tool 3: Memory Search
server.addTool({
  name: 'memory_search',
  description: 'Search for keys matching a pattern in memory with wildcard support',
  parameters: z.object({
    pattern: z.string().min(1).describe('Search pattern (supports wildcards like * and ?)'),
    namespace: z.string().optional().describe('Memory namespace to search in (searches all if not specified)'),
    limit: z.number().positive().optional().default(10).describe('Maximum number of results to return (1-100)')
      .refine((val) => val >= 1 && val <= 100, { message: 'Limit must be between 1 and 100' })
  }),
  execute: async ({ pattern, namespace, limit }) => {
    try {
      const args = ['claude-flow@alpha', 'memory', 'search', pattern];
      if (namespace) args.push('--namespace', namespace);
      args.push('--limit', String(limit));

      const result = execFileSync('npx', args, { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

      return JSON.stringify({
        success: true,
        pattern,
        namespace: namespace || 'all',
        limit,
        results: result.trim(),
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to search memory: ${error.message}`);
    }
  }
});

// Tool 4: Swarm Init
server.addTool({
  name: 'swarm_init',
  description: 'Initialize a multi-agent swarm with specified topology and strategy',
  parameters: z.object({
    topology: z.enum(['mesh', 'hierarchical', 'ring', 'star'])
      .describe('Swarm topology: mesh (peer-to-peer), hierarchical (tree), ring (circular), star (centralized)'),
    maxAgents: z.number().positive().optional().default(8).describe('Maximum number of agents in the swarm (1-100)')
      .refine((val) => val >= 1 && val <= 100, { message: 'maxAgents must be between 1 and 100' }),
    strategy: z.enum(['balanced', 'specialized', 'adaptive']).optional().default('balanced')
      .describe('Agent distribution strategy: balanced (equal), specialized (role-based), adaptive (dynamic)')
  }),
  execute: async ({ topology, maxAgents, strategy }) => {
    try {
      const result = execFileSync(
        'npx',
        ['claude-flow@alpha', 'swarm', 'init', '--topology', topology, '--max-agents', String(maxAgents), '--strategy', strategy],
        { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      return JSON.stringify({
        success: true,
        topology,
        maxAgents,
        strategy,
        message: 'Swarm initialized successfully',
        details: result.trim(),
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to initialize swarm: ${error.message}`);
    }
  }
});

// Tool 5: Agent Spawn
server.addTool({
  name: 'agent_spawn',
  description: 'Spawn a new agent in the swarm with specified type and capabilities',
  parameters: z.object({
    type: z.enum(['researcher', 'coder', 'analyst', 'optimizer', 'coordinator'])
      .describe('Agent type: researcher (data gathering), coder (implementation), analyst (analysis), optimizer (performance), coordinator (orchestration)'),
    capabilities: z.array(z.string()).optional()
      .describe('Specific capabilities for the agent (e.g., ["python", "testing", "documentation"])'),
    name: z.string().optional().describe('Custom agent name/identifier')
  }),
  execute: async ({ type, capabilities, name }) => {
    try {
      const args = ['claude-flow@alpha', 'agent', 'spawn', '--type', type];
      if (capabilities && capabilities.length > 0) args.push('--capabilities', capabilities.join(','));
      if (name) args.push('--name', name);
      const result = execFileSync('npx', args, { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

      return JSON.stringify({
        success: true,
        type,
        capabilities: capabilities || [],
        name: name || `${type}-${Date.now()}`,
        message: 'Agent spawned successfully',
        details: result.trim(),
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to spawn agent: ${error.message}`);
    }
  }
});

// Tool 6: Task Orchestrate
server.addTool({
  name: 'task_orchestrate',
  description: 'Orchestrate a complex task across the swarm with specified strategy and priority',
  parameters: z.object({
    task: z.string().min(1).describe('Task description or instructions for the swarm to execute'),
    strategy: z.enum(['parallel', 'sequential', 'adaptive']).optional().default('adaptive')
      .describe('Execution strategy: parallel (simultaneous), sequential (ordered), adaptive (dynamic based on task)'),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium')
      .describe('Task priority level: low, medium, high, or critical'),
    maxAgents: z.number().positive().optional().describe('Maximum number of agents to use for this task (1-10)')
      .refine((val) => !val || (val >= 1 && val <= 10), { message: 'maxAgents must be between 1 and 10' })
  }),
  execute: async ({ task, strategy, priority, maxAgents }) => {
    try {
      const args = ['claude-flow@alpha', 'task', 'orchestrate', task, '--strategy', strategy, '--priority', priority];
      if (maxAgents) args.push('--max-agents', String(maxAgents));
      const result = execFileSync('npx', args, { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 300000 });

      return JSON.stringify({
        success: true,
        task,
        strategy,
        priority,
        maxAgents: maxAgents || 'auto',
        message: 'Task orchestrated successfully',
        details: result.trim(),
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to orchestrate task: ${error.message}`);
    }
  }
});

// Tool 7: Agent Execute
server.addTool({
  name: 'agent_execute',
  description: 'Execute a specific agent with a task (equivalent to --agent CLI command)',
  parameters: z.object({
    agent: z.string().describe('Agent name to execute'),
    task: z.string().describe('Task description'),
    stream: z.boolean().optional().default(false).describe('Enable streaming output')
  }),
  execute: async ({ agent, task, stream }) => {
    try {
      const args = ['agentic-flow', '--agent', agent, '--task', task];
      if (stream) args.push('--stream');
      const result = execFileSync('npx', args, { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 300000 });

      return JSON.stringify({
        success: true,
        agent,
        task: task.substring(0, 100),
        output: result,
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to execute agent: ${error.message}`);
    }
  }
});

// Tool 8: Agent Parallel
server.addTool({
  name: 'agent_parallel',
  description: 'Run parallel mode with 3 agents (research, code review, data analysis)',
  parameters: z.object({
    topic: z.string().optional().describe('Research topic'),
    diff: z.string().optional().describe('Code diff for review'),
    dataset: z.string().optional().describe('Dataset hint'),
    streaming: z.boolean().optional().default(false).describe('Enable streaming')
  }),
  execute: async ({ topic, diff, dataset, streaming }) => {
    try {
      const env = {
        ...process.env,
        ...(topic && { TOPIC: topic }),
        ...(diff && { DIFF: diff }),
        ...(dataset && { DATASET: dataset }),
        ...(streaming && { ENABLE_STREAMING: 'true' })
      };
      const result = execFileSync('npx', ['agentic-flow'], { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 300000, env });

      return JSON.stringify({
        success: true,
        mode: 'parallel',
        agents: ['research', 'code_review', 'data'],
        output: result,
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to run parallel mode: ${error.message}`);
    }
  }
});

// Tool 9: Agent List
server.addTool({
  name: 'agent_list',
  description: 'List all available agents',
  parameters: z.object({
    format: z.enum(['summary', 'detailed', 'json']).optional().default('summary')
  }),
  execute: async ({ format }) => {
    try {
      const result = execFileSync('npx', ['agentic-flow', '--list'], { ...NPX_EXEC_OPTS, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024, timeout: 30000 });

      if (format === 'detailed') {
        return result;
      }

      const agents: any[] = [];
      const lines = result.split('\n');
      let currentCategory = '';

      for (const line of lines) {
        if (line.includes(':') && line.trim().endsWith(':')) {
          currentCategory = line.replace(':', '').trim();
        } else if (line.trim().startsWith('•') || /^\s{2,}\w/.test(line)) {
          const match = line.match(/^\s*[•\s]*(\S+)\s+(.+)$/);
          if (match) {
            agents.push({ name: match[1], description: match[2].trim(), category: currentCategory });
          }
        }
      }

      return JSON.stringify({
        success: true,
        count: agents.length,
        agents,
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to list agents: ${error.message}`);
    }
  }
});

// Tool 10: Add Custom Agent
server.addTool({
  name: 'agent_add',
  description: 'Add a new custom agent defined in markdown',
  parameters: z.object({
    name: z.string().describe('Agent name (kebab-case)'),
    description: z.string().describe('Agent description'),
    systemPrompt: z.string().describe('System prompt'),
    category: z.string().optional().default('custom').describe('Category'),
    capabilities: z.array(z.string()).optional().describe('Capabilities')
  }),
  execute: async ({ name, description, systemPrompt, category, capabilities }) => {
    try {
      const { writeFileSync, existsSync, mkdirSync } = await import('fs');
      const { join } = await import('path');

      // name and category become path segments: slugs only, kept under .claude/agents
      assertSlug(name, 'agent name');
      const agentsDir = resolveAgentDir(category || 'custom');
      if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });

      const markdown = `# ${name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

## Description
${description}

## System Prompt
${systemPrompt}

${capabilities && capabilities.length > 0 ? `## Capabilities\n${capabilities.map(c => `- ${c}`).join('\n')}\n` : ''}

## Usage
\`\`\`bash
npx agentic-flow --agent ${name} --task "Your task"
\`\`\`

---
*Generated: ${new Date().toISOString()}*
`;

      const filePath = resolveWithin(agentsDir, `${name}.md`);
      if (existsSync(filePath)) throw new Error(`Agent '${name}' already exists`);

      writeFileSync(filePath, markdown, 'utf8');

      return JSON.stringify({
        success: true,
        agent: name,
        category: category || 'custom',
        filePath,
        message: `Agent '${name}' created successfully`,
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to add agent: ${error.message}`);
    }
  }
});

// Tool 11: Add Custom Command
server.addTool({
  name: 'command_add',
  description: 'Add a new custom command defined in markdown',
  parameters: z.object({
    name: z.string().describe('Command name (kebab-case)'),
    description: z.string().describe('Command description'),
    usage: z.string().describe('Usage example'),
    parameters: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      description: z.string()
    })).optional().describe('Parameters'),
    examples: z.array(z.string()).optional().describe('Examples')
  }),
  execute: async ({ name, description, usage, parameters, examples }) => {
    try {
      const { writeFileSync, existsSync, mkdirSync } = await import('fs');
      const { join } = await import('path');

      assertSlug(name, 'command name');
      const commandsDir = join(process.cwd(), '.claude', 'commands');
      if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });

      const markdown = `# ${name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Command

## Description
${description}

## Usage
\`\`\`bash
${usage}
\`\`\`

${parameters && parameters.length > 0 ? `## Parameters\n| Name | Type | Required | Description |\n|------|------|----------|-------------|\n${parameters.map(p => `| \`${p.name}\` | ${p.type} | ${p.required ? 'Yes' : 'No'} | ${p.description} |`).join('\n')}\n` : ''}

${examples && examples.length > 0 ? `## Examples\n\n${examples.map((ex, i) => `### Example ${i + 1}\n\`\`\`bash\n${ex}\n\`\`\`\n`).join('\n')}` : ''}

---
*Generated: ${new Date().toISOString()}*
`;

      const filePath = resolveWithin(commandsDir, `${name}.md`);
      if (existsSync(filePath)) throw new Error(`Command '${name}' already exists`);

      writeFileSync(filePath, markdown, 'utf8');

      return JSON.stringify({
        success: true,
        command: name,
        filePath,
        message: `Command '${name}' created successfully`,
        timestamp: new Date().toISOString()
      }, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to add command: ${error.message}`);
    }
  }
});

console.error('✅ Registered 11 tools successfully');
console.error('🔌 Starting stdio transport...');

// Start with stdio transport
server.start({ transportType: 'stdio' }).then(() => {
  console.error('✅ FastMCP Full Server running on stdio');
}).catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
