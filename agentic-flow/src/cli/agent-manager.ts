#!/usr/bin/env node
/**
 * Agent Management CLI - Create, list, and manage custom agents
 * Supports both npm package agents and local .claude/agents
 * Includes conflict detection and deduplication
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, join, dirname, relative, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { assertCategoryPath, resolveWithin } from '../utils/path-safety.js';

// Get package root and default paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '../..');
const packageAgentsDir = join(packageRoot, '.claude/agents');
const localAgentsDir = join(process.cwd(), '.claude/agents');

interface AgentMetadata {
  name: string;
  description: string;
  category?: string;
  color?: string;
  tools?: string[];
}

interface AgentSource {
  path: string;
  source: 'package' | 'local';
  relativePath: string;
}

interface AgentInfo {
  name: string;
  description: string;
  category: string;
  filePath: string;
  source: 'package' | 'local';
  relativePath: string;
}

export class AgentManager {
  /**
   * Find all agent files from both package and local directories
   * Deduplicates by preferring local over package
   */
  private findAllAgents(): Map<string, AgentInfo> {
    const agents = new Map<string, AgentInfo>();

    // Load package agents first
    if (existsSync(packageAgentsDir)) {
      this.scanAgentsDirectory(packageAgentsDir, 'package', agents);
    }

    // Load local agents (overrides package agents with same relative path)
    if (existsSync(localAgentsDir)) {
      this.scanAgentsDirectory(localAgentsDir, 'local', agents);
    }

    return agents;
  }

  /**
   * Recursively scan directory for agent markdown files
   */
  private scanAgentsDirectory(
    dir: string,
    source: 'package' | 'local',
    agents: Map<string, AgentInfo>
  ): void {
    const baseDir = source === 'package' ? packageAgentsDir : localAgentsDir;

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          this.scanAgentsDirectory(fullPath, source, agents);
        } else if (extname(entry) === '.md' && entry !== 'README.md') {
          const relativePath = relative(baseDir, fullPath);
          const agentInfo = this.parseAgentFile(fullPath, source, relativePath);

          if (agentInfo) {
            // Use relative path as key for deduplication
            // Local agents override package agents
            const existingAgent = agents.get(relativePath);
            if (!existingAgent || source === 'local') {
              agents.set(relativePath, agentInfo);
            }
          }
        }
      }
    } catch (error: any) {
      console.error(`Error scanning directory ${dir}: ${error.message}`);
    }
  }

  /**
   * Parse agent markdown file and extract metadata
   */
  private parseAgentFile(
    filePath: string,
    source: 'package' | 'local',
    relativePath: string
  ): AgentInfo | null {
    try {
      const content = readFileSync(filePath, 'utf-8');

      // Try frontmatter format first
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (frontmatterMatch) {
        const [, frontmatter] = frontmatterMatch;
        const meta: any = {};

        frontmatter.split('\n').forEach(line => {
          const match = line.match(/^(\w+):\s*(.+)$/);
          if (match) {
            const [, key, value] = match;
            meta[key] = value.replace(/^["']|["']$/g, '');
          }
        });

        if (meta.name && meta.description) {
          return {
            name: meta.name,
            description: meta.description,
            category: this.getCategoryFromPath(relativePath),
            filePath,
            source,
            relativePath
          };
        }
      }

      // Fallback: extract from markdown headers
      const nameMatch = content.match(/^#\s+(.+)$/m);
      const descMatch = content.match(/^##\s+Description\s*\n\s*(.+)$/m);

      if (nameMatch) {
        return {
          name: nameMatch[1].trim(),
          description: descMatch ? descMatch[1].trim() : 'No description available',
          category: this.getCategoryFromPath(relativePath),
          filePath,
          source,
          relativePath
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get category from file path
   */
  private getCategoryFromPath(relativePath: string): string {
    const parts = relativePath.split('/');
    return parts.length > 1 ? parts[0] : 'custom';
  }

  /**
   * List all agents with deduplication
   */
  list(format: 'summary' | 'detailed' | 'json' = 'summary'): void {
    const agents = this.findAllAgents();

    if (format === 'json') {
      const agentList = Array.from(agents.values()).map(a => ({
        name: a.name,
        description: a.description,
        category: a.category,
        source: a.source,
        path: a.relativePath
      }));
      console.log(JSON.stringify(agentList, null, 2));
      return;
    }

    // Group by category
    const byCategory = new Map<string, AgentInfo[]>();
    for (const agent of agents.values()) {
      const category = agent.category;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(agent);
    }

    // Sort categories
    const sortedCategories = Array.from(byCategory.keys()).sort();

    console.log('\n📦 Available Agents:');
    console.log('═'.repeat(80));

    for (const category of sortedCategories) {
      const categoryAgents = byCategory.get(category)!.sort((a, b) => a.name.localeCompare(b.name));
      console.log(`\n${category.toUpperCase()}:`);

      for (const agent of categoryAgents) {
        const sourceIcon = agent.source === 'local' ? '📝' : '📦';
        if (format === 'detailed') {
          console.log(`  ${sourceIcon} ${agent.name}`);
          console.log(`     ${agent.description}`);
          console.log(`     Source: ${agent.source} (${agent.relativePath})`);
        } else {
          console.log(`  ${sourceIcon} ${agent.name.padEnd(30)} ${agent.description.substring(0, 45)}...`);
        }
      }
    }

    console.log(`\n📊 Total: ${agents.size} agents`);
    console.log(`   📝 Local: ${Array.from(agents.values()).filter(a => a.source === 'local').length}`);
    console.log(`   📦 Package: ${Array.from(agents.values()).filter(a => a.source === 'package').length}`);
    console.log('');
  }

  /**
   * Create a new agent
   */
  async create(options: {
    name?: string;
    description?: string;
    category?: string;
    systemPrompt?: string;
    tools?: string[];
    interactive?: boolean;
  }): Promise<void> {
    let { name, description, category, systemPrompt, tools } = options;

    // Interactive mode
    if (options.interactive) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const question = (prompt: string): Promise<string> => {
        return new Promise(resolve => rl.question(prompt, resolve));
      };

      console.log('\n🤖 Create New Agent');
      console.log('═'.repeat(80));

      name = await question('Agent name (e.g., my-custom-agent): ');
      description = await question('Description: ');
      category = await question('Category (default: custom): ') || 'custom';
      systemPrompt = await question('System prompt: ');

      const toolsInput = await question('Tools (comma-separated, optional): ');
      tools = toolsInput ? toolsInput.split(',').map(t => t.trim()) : [];

      rl.close();
    }

    // Validate required fields
    if (!name || !description || !systemPrompt) {
      throw new Error('Name, description, and system prompt are required');
    }

    // Normalize name to kebab-case
    const kebabName = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!kebabName) {
      throw new Error(`Invalid agent name '${name}': use letters, digits and hyphens`);
    }

    // The category becomes a directory: slug segments only, and it must stay
    // under .claude/agents (rejects '..', absolute paths and separators).
    const targetCategory = category || 'custom';
    const targetDir = resolveWithin(localAgentsDir, ...assertCategoryPath(targetCategory));

    // Check for conflicts
    const agents = this.findAllAgents();
    const conflictingAgent = Array.from(agents.values()).find(
      a => a.name.toLowerCase() === kebabName.toLowerCase()
    );

    if (conflictingAgent) {
      console.log(`\n⚠️  Warning: Agent "${conflictingAgent.name}" already exists`);
      console.log(`   Source: ${conflictingAgent.source}`);
      console.log(`   Path: ${conflictingAgent.relativePath}`);

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>(resolve => {
        rl.question('\nCreate in local .claude/agents anyway? (y/N): ', resolve);
      });

      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.');
        return;
      }
    }

    // Create directory structure
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Generate markdown content
    const markdown = this.generateAgentMarkdown({
      name: kebabName,
      description: description!,
      category: targetCategory,
      tools
    }, systemPrompt!);

    const filePath = join(targetDir, `${kebabName}.md`);

    if (existsSync(filePath)) {
      throw new Error(`Agent file already exists at ${filePath}`);
    }

    writeFileSync(filePath, markdown, 'utf8');

    console.log(`\n✅ Agent created successfully!`);
    console.log(`   Name: ${kebabName}`);
    console.log(`   Category: ${targetCategory}`);
    console.log(`   Path: ${filePath}`);
    console.log(`\n📝 Usage:`);
    console.log(`   npx agentic-flow --agent ${kebabName} --task "Your task"`);
    console.log('');
  }

  /**
   * Generate agent markdown with frontmatter
   */
  private generateAgentMarkdown(
    metadata: AgentMetadata,
    systemPrompt: string
  ): string {
    const toolsLine = metadata.tools && metadata.tools.length > 0
      ? `tools: ${metadata.tools.join(', ')}`
      : '';

    return `---
name: ${metadata.name}
description: ${metadata.description}
${metadata.color ? `color: ${metadata.color}` : ''}
${toolsLine}
---

${systemPrompt}

## Usage

\`\`\`bash
npx agentic-flow --agent ${metadata.name} --task "Your task"
\`\`\`

## Examples

### Example 1
\`\`\`bash
npx agentic-flow --agent ${metadata.name} --task "Example task description"
\`\`\`

---
*Created: ${new Date().toISOString()}*
*Source: local*
`;
  }

  /**
   * Get information about a specific agent
   */
  info(name: string): void {
    const agents = this.findAllAgents();
    const agent = Array.from(agents.values()).find(
      a => a.name.toLowerCase() === name.toLowerCase()
    );

    if (!agent) {
      console.log(`\n❌ Agent "${name}" not found`);
      console.log('\nUse "agentic-flow agent list" to see all available agents\n');
      return;
    }

    console.log('\n📋 Agent Information');
    console.log('═'.repeat(80));
    console.log(`Name:        ${agent.name}`);
    console.log(`Description: ${agent.description}`);
    console.log(`Category:    ${agent.category}`);
    console.log(`Source:      ${agent.source === 'local' ? '📝 Local' : '📦 Package'}`);
    console.log(`Path:        ${agent.relativePath}`);
    console.log(`Full Path:   ${agent.filePath}`);
    console.log('');

    // Show content preview
    try {
      const content = readFileSync(agent.filePath, 'utf-8');
      console.log('Preview:');
      console.log('─'.repeat(80));
      const lines = content.split('\n').slice(0, 20);
      console.log(lines.join('\n'));
      if (content.split('\n').length > 20) {
        console.log('...');
      }
      console.log('');
    } catch (error) {
      console.log('Could not read agent file\n');
    }
  }

  /**
   * Check for conflicts between package and local agents
   */
  checkConflicts(): void {
    console.log('\n🔍 Checking for agent conflicts...');
    console.log('═'.repeat(80));

    const packageAgents = new Map<string, AgentInfo>();
    const localAgents = new Map<string, AgentInfo>();

    if (existsSync(packageAgentsDir)) {
      this.scanAgentsDirectory(packageAgentsDir, 'package', packageAgents);
    }

    if (existsSync(localAgentsDir)) {
      this.scanAgentsDirectory(localAgentsDir, 'local', localAgents);
    }

    // Find conflicts (same relative path in both)
    const conflicts: Array<{ path: string; package: AgentInfo; local: AgentInfo }> = [];

    for (const [relativePath, localAgent] of localAgents) {
      const packageAgent = packageAgents.get(relativePath);
      if (packageAgent) {
        conflicts.push({ path: relativePath, package: packageAgent, local: localAgent });
      }
    }

    if (conflicts.length === 0) {
      console.log('\n✅ No conflicts found!\n');
      return;
    }

    console.log(`\n⚠️  Found ${conflicts.length} conflict(s):\n`);

    for (const conflict of conflicts) {
      console.log(`📁 ${conflict.path}`);
      console.log(`   📦 Package: ${conflict.package.name}`);
      console.log(`      ${conflict.package.description}`);
      console.log(`   📝 Local:   ${conflict.local.name}`);
      console.log(`      ${conflict.local.description}`);
      console.log(`   ℹ️  Local version will be used\n`);
    }
  }
}

/**
 * CLI command handler
 */
export async function handleAgentCommand(args: string[]): Promise<void> {
  const command = args[0];
  const manager = new AgentManager();

  switch (command) {
    case undefined:
    case 'help':
      console.log(`
🤖 Agent Management CLI

USAGE:
  npx agentic-flow agent <command> [options]

COMMANDS:
  list [format]           List all available agents
                          format: summary (default), detailed, json

  create                  Create a new agent interactively
  create --name NAME      Create agent with CLI arguments
         --description DESC
         --category CAT
         --prompt PROMPT
         [--tools TOOLS]

  info <name>            Show detailed information about an agent

  conflicts              Check for conflicts between package and local agents

  help                   Show this help message

EXAMPLES:
  # List all agents
  npx agentic-flow agent list

  # List with details
  npx agentic-flow agent list detailed

  # Create agent interactively
  npx agentic-flow agent create

  # Create agent with CLI
  npx agentic-flow agent create --name my-agent --description "My custom agent" --prompt "You are a helpful assistant"

  # Get agent info
  npx agentic-flow agent info coder

  # Check conflicts
  npx agentic-flow agent conflicts

AGENT LOCATIONS:
  📦 Package: ${packageAgentsDir}
  📝 Local:   ${localAgentsDir}

  Note: Local agents override package agents with the same path.
`);
      break;

    case 'list':
      const format = (args[1] as 'summary' | 'detailed' | 'json') || 'summary';
      manager.list(format);
      break;

    case 'create':
      const nameIdx = args.indexOf('--name');
      const descIdx = args.indexOf('--description');
      const catIdx = args.indexOf('--category');
      const promptIdx = args.indexOf('--prompt');
      const toolsIdx = args.indexOf('--tools');

      if (nameIdx === -1 || descIdx === -1 || promptIdx === -1) {
        // Interactive mode
        await manager.create({ interactive: true });
      } else {
        // CLI mode
        await manager.create({
          name: args[nameIdx + 1],
          description: args[descIdx + 1],
          category: catIdx !== -1 ? args[catIdx + 1] : 'custom',
          systemPrompt: args[promptIdx + 1],
          tools: toolsIdx !== -1 ? args[toolsIdx + 1].split(',').map(t => t.trim()) : []
        });
      }
      break;

    case 'info':
      if (!args[1]) {
        console.log('\n❌ Please specify an agent name\n');
        console.log('Usage: npx agentic-flow agent info <name>\n');
        process.exit(1);
      }
      manager.info(args[1]);
      break;

    case 'conflicts':
      manager.checkConflicts();
      break;

    default:
      console.log(`\n❌ Unknown command: ${command}\n`);
      console.log('Use "npx agentic-flow agent help" for usage information\n');
      process.exit(1);
  }
}
