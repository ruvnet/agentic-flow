#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing catch(error: any) handlers; outside scope of CWE-78 fix */
// FastMCP server with HTTP/SSE transport - All agentic-flow tools
// Accessible via HTTP at http://127.0.0.1:8080/mcp
// SSE endpoint at http://127.0.0.1:8080/sse
//
// Access control: binds AGENTIC_FLOW_MCP_HOST (default 127.0.0.1) and requires
// AGENTIC_FLOW_MCP_TOKEN as a bearer token (generated and printed once when
// unset). Browser origins must be listed in AGENTIC_FLOW_MCP_ALLOWED_ORIGINS.
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { execFileSync } from 'child_process';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  createMcpHttpAuthenticate,
  resolveMcpHttpAuth,
  DEFAULT_MCP_HTTP_PORT,
} from '../auth/http-auth.js';
import { toAgentSlug, resolveAgentDir, resolveWithin } from '../../../utils/path-safety.js';

// Security: All shell-outs use execFileSync with argv arrays (shell: false) to
// prevent OS command injection via tool parameters (CWE-78). Do NOT reintroduce
// execSync with template-string interpolation here.
const NPX_EXEC_OPTS = { shell: false as const };

console.error('🚀 Starting Agentic-Flow MCP Server (HTTP/SSE transport)...');
console.error('📦 Loading agentic-flow tools');

const httpAuth = resolveMcpHttpAuth();

const server = new FastMCP({
  name: 'agentic-flow-http',
  version: '1.1.12',
  authenticate: createMcpHttpAuthenticate(httpAuth)
});

// Tool: Run agentic-flow agent
server.addTool({
  name: 'agentic_flow_agent',
  description: 'Execute an agentic-flow agent with a specific task. Supports multiple providers (Anthropic, Gemini, OpenRouter, ONNX) and comprehensive configuration options.',
  parameters: z.object({
    agent: z.string().describe('Agent type (coder, researcher, analyst, etc.) - Use agentic_flow_list_agents to see all 66+ available agents'),
    task: z.string().describe('Task description for the agent to execute'),

    // Provider Configuration
    model: z.string().optional().describe('Model to use (e.g., "claude-sonnet-4-5-20250929" for Anthropic, "meta-llama/llama-3.1-8b-instruct" for OpenRouter, or "Xenova/gpt2" for ONNX local models)'),
    provider: z.enum(['anthropic', 'openrouter', 'onnx', 'gemini']).optional().describe('LLM provider: "anthropic" (default, highest quality, requires ANTHROPIC_API_KEY), "gemini" (free tier, requires GOOGLE_GEMINI_API_KEY), "openrouter" (99% cost savings, requires OPENROUTER_API_KEY), "onnx" (free local inference, no API key needed)'),

    // API Configuration
    anthropicApiKey: z.string().optional().describe('Anthropic API key (sk-ant-...) - overrides ANTHROPIC_API_KEY environment variable'),
    openrouterApiKey: z.string().optional().describe('OpenRouter API key (sk-or-...) - overrides OPENROUTER_API_KEY environment variable'),

    // Agent Behavior
    stream: z.boolean().optional().default(false).describe('Enable streaming output (real-time response chunks)'),
    temperature: z.number().min(0).max(1).optional().describe('Sampling temperature (0.0-1.0): lower = more focused/deterministic, higher = more creative/random. Default varies by agent.'),
    maxTokens: z.number().positive().optional().describe('Maximum tokens in response (default: 4096). Controls output length.'),

    // Directory Configuration
    agentsDir: z.string().optional().describe('Custom agents directory path (default: .claude/agents) - for using custom agent definitions'),

    // Output Options
    outputFormat: z.enum(['text', 'json', 'markdown']).optional().describe('Output format: "text" (default, human-readable), "json" (structured data), "markdown" (formatted docs)'),
    verbose: z.boolean().optional().default(false).describe('Enable verbose logging for debugging'),

    // Execution Control
    timeout: z.number().positive().optional().describe('Execution timeout in milliseconds (default: 300000 = 5 minutes)'),
    retryOnError: z.boolean().optional().default(false).describe('Automatically retry on transient errors (rate limits, network issues)')
  }),
  execute: async ({
    agent,
    task,
    model,
    provider,
    anthropicApiKey,
    openrouterApiKey,
    stream,
    temperature,
    maxTokens,
    agentsDir,
    outputFormat,
    verbose,
    timeout,
    retryOnError
  }) => {
    try {
      // Build argv (NOT a shell string) — every user-supplied value stays a
      // separate argv element and cannot be reinterpreted by the shell.
      const args: string[] = ['--yes', 'agentic-flow', '--agent', agent, '--task', task];

      // Provider & Model
      if (model) args.push('--model', model);
      if (provider) args.push('--provider', provider);

      // API Keys (set as env vars)
      const env = { ...process.env };
      if (anthropicApiKey) env.ANTHROPIC_API_KEY = anthropicApiKey;
      if (openrouterApiKey) env.OPENROUTER_API_KEY = openrouterApiKey;

      // Agent Behavior
      if (stream) args.push('--stream');
      if (temperature !== undefined) args.push('--temperature', String(temperature));
      if (maxTokens) args.push('--max-tokens', String(maxTokens));

      // Directories
      if (agentsDir) args.push('--agents-dir', agentsDir);

      // Output
      if (outputFormat) args.push('--output', outputFormat);
      if (verbose) args.push('--verbose');

      // Execution
      if (timeout) args.push('--timeout', String(timeout));
      if (retryOnError) args.push('--retry');

      const result = execFileSync('npx', args, {
        ...NPX_EXEC_OPTS,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeout || 300000,
        env
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            agent,
            provider: provider || 'anthropic',
            output: result,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            agent,
            error: error.message,
            stderr: error.stderr?.toString(),
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
});

// Tool: List all agents
server.addTool({
  name: 'agentic_flow_list_agents',
  description: 'List all available agentic-flow agents (66+ total)',
  parameters: z.object({
    format: z.enum(['summary', 'detailed', 'json']).optional().default('summary')
  }),
  execute: async ({ format }) => {
    try {
      const result = execFileSync('npx', ['--yes', 'agentic-flow', '--list'], {
        ...NPX_EXEC_OPTS,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 30000
      });

      if (format === 'detailed') {
        return {
          content: [{
            type: 'text',
            text: result
          }]
        };
      }

      // Parse agent list
      const agents: any[] = [];
      const lines = result.split('\n');
      let currentCategory = '';

      for (const line of lines) {
        if (line.includes(':') && line.trim().endsWith(':')) {
          currentCategory = line.replace(':', '').trim();
        } else if (line.trim().startsWith('•') || /^\s{2,}\w/.test(line)) {
          const match = line.match(/^\s*[•\s]*(\S+)\s+(.+)$/);
          if (match) {
            agents.push({
              name: match[1],
              description: match[2].trim(),
              category: currentCategory
            });
          }
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: agents.length,
            agents: format === 'json' ? agents : agents.map(a => a.name),
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
});

// Tool: Create custom agent
server.addTool({
  name: 'agentic_flow_create_agent',
  description: 'Create a new custom agent with specified name, description, and system prompt',
  parameters: z.object({
    name: z.string().describe('Agent name (will be converted to kebab-case, e.g., my-custom-agent)'),
    description: z.string().describe('Agent description (what this agent does)'),
    systemPrompt: z.string().describe('System prompt that defines the agent behavior and personality'),
    category: z.string().optional().default('custom').describe('Category/folder to organize the agent (default: custom)'),
    tools: z.array(z.string()).optional().describe('Optional list of tools this agent can use (e.g., ["web-search", "code-execution"])')
  }),
  execute: async ({ name, description, systemPrompt, category, tools }) => {
    try {
      const { writeFileSync, existsSync, mkdirSync } = await import('fs');
      const { join } = await import('path');

      // Convert to kebab-case; name and category must be slugs under .claude/agents
      const agentName = toAgentSlug(name);
      const agentsDir = resolveAgentDir(category || 'custom');

      if (!existsSync(agentsDir)) {
        mkdirSync(agentsDir, { recursive: true });
      }

      const markdown = `# ${name}

## Description
${description}

## System Prompt
${systemPrompt}

${tools && tools.length > 0 ? `## Tools\n${tools.map(t => `- ${t}`).join('\n')}\n` : ''}

## Usage
\`\`\`bash
npx agentic-flow --agent ${agentName} --task "Your task"
\`\`\`

---
*Created: ${new Date().toISOString()}*
`;

      const filePath = resolveWithin(agentsDir, `${agentName}.md`);
      if (existsSync(filePath)) {
        throw new Error(`Agent '${agentName}' already exists at ${filePath}`);
      }

      writeFileSync(filePath, markdown, 'utf8');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            agent: agentName,
            category: category || 'custom',
            filePath,
            message: `Agent '${agentName}' created successfully`,
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
});

// Tool: Get agent info
server.addTool({
  name: 'agentic_flow_agent_info',
  description: 'Get detailed information about a specific agent including source, description, and system prompt preview',
  parameters: z.object({
    name: z.string().describe('Agent name to get information about')
  }),
  execute: async ({ name }) => {
    try {
      // Use execFileSync with array args to prevent shell injection from user-supplied `name`
      const result = execFileSync('npx', ['--yes', 'agentic-flow', 'agent', 'info', name], {
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 30000
      });

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
});

// Tool: Check for agent conflicts
server.addTool({
  name: 'agentic_flow_check_conflicts',
  description: 'Check for conflicts between package agents and local custom agents',
  parameters: z.object({}),
  execute: async () => {
    try {
      const result = execFileSync('npx', ['--yes', 'agentic-flow', 'agent', 'conflicts'], {
        ...NPX_EXEC_OPTS,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 30000
      });

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
});

// Tool: Optimize model selection
server.addTool({
  name: 'agentic_flow_optimize_model',
  description: 'Automatically select the optimal model for an agent and task based on priorities (quality, cost, speed, privacy)',
  parameters: z.object({
    agent: z.string().describe('Agent type (e.g., coder, researcher, reviewer)'),
    task: z.string().describe('Task description'),
    priority: z.enum(['quality', 'balanced', 'cost', 'speed', 'privacy']).optional().default('balanced')
      .describe('Optimization priority: quality (best results), balanced (cost/quality), cost (cheapest), speed (fastest), privacy (local only)'),
    max_cost: z.number().positive().optional().describe('Maximum cost per task in dollars (optional budget cap)')
  }),
  execute: async ({ agent, task, priority, max_cost }) => {
    try {
      const args: string[] = ['--yes', 'agentic-flow', '--agent', agent, '--task', task, '--optimize', '--priority', priority];
      if (max_cost) args.push('--max-cost', String(max_cost));

      const result = execFileSync('npx', args, {
        ...NPX_EXEC_OPTS,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000
      });

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
});

console.error('✅ Registered 6 tools successfully');

export interface HttpSseServerHandle {
  host: string;
  port: number;
  token: string;
  stop: () => Promise<void>;
}

/** Start the HTTP/SSE transport. Port defaults to AGENTIC_FLOW_MCP_PORT or 8080. */
export async function startHttpSseServer(
  port: number = Number(process.env.AGENTIC_FLOW_MCP_PORT) || DEFAULT_MCP_HTTP_PORT,
  host: string = httpAuth.host
): Promise<HttpSseServerHandle> {
  await server.start({
    transportType: 'httpStream',
    httpStream: { port, host }
  });

  const base = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  console.error('✅ Agentic-Flow MCP Server running!');
  console.error(`📡 HTTP endpoint: ${base}/mcp`);
  console.error(`📡 SSE endpoint: ${base}/sse`);
  console.error(`💊 Health check: ${base}/health`);
  if (httpAuth.generated) {
    console.error('🔑 No AGENTIC_FLOW_MCP_TOKEN set; generated one for this run:');
    console.error(`   Authorization: Bearer ${httpAuth.token}`);
  }
  if (httpAuth.allowedOrigins.size === 0) {
    console.error('🌐 Browser origins: none allowed (set AGENTIC_FLOW_MCP_ALLOWED_ORIGINS)');
  }

  return { host, port, token: httpAuth.token, stop: () => server.stop() };
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  console.error('🌐 Starting HTTP/SSE transport...');
  startHttpSseServer().catch((error) => {
    console.error('❌ Failed to start HTTP/SSE server:', error);
    process.exit(1);
  });
}
