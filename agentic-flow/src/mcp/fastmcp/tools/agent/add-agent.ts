import { z } from 'zod';
import { ToolDefinition, ToolContext } from '../../types/index.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveAgentDir } from '../../../../utils/path-safety.js';

const addAgentSchema = z.object({
  name: z.string().describe('Agent name (kebab-case, e.g., custom-researcher)'),
  description: z.string().describe('Agent description'),
  systemPrompt: z.string().describe('System prompt/instructions for the agent'),
  category: z.string().optional().default('custom').describe('Agent category'),
  capabilities: z.array(z.string()).optional().describe('Agent capabilities/features'),
  outputFormat: z.string().optional().describe('Expected output format')
});

export const addAgentTool: ToolDefinition = {
  name: 'agent_add',
  description: 'Add a new custom agent defined in markdown format',
  parameters: addAgentSchema,

  async execute({ name, description, systemPrompt, category, capabilities, outputFormat }: z.infer<typeof addAgentSchema>, { onProgress }: ToolContext) {
    try {
      onProgress?.({ progress: 0.2, message: `Creating custom agent: ${name}` });

      // Validate name format
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new Error('Agent name must be kebab-case (lowercase, numbers, hyphens only)');
      }

      // Create agents directory if it doesn't exist (category validated, kept under .claude/agents)
      const agentsDir = resolveAgentDir(category);
      if (!existsSync(agentsDir)) {
        mkdirSync(agentsDir, { recursive: true });
      }

      onProgress?.({ progress: 0.4, message: 'Generating agent markdown...' });

      // Generate markdown content
      const markdown = `# ${name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

## Description
${description}

## System Prompt
${systemPrompt}

${capabilities && capabilities.length > 0 ? `## Capabilities
${capabilities.map(c => `- ${c}`).join('\n')}
` : ''}

${outputFormat ? `## Output Format
${outputFormat}
` : ''}

## Usage
\`\`\`bash
npx agentic-flow --agent ${name} --task "Your task here"
\`\`\`

## MCP Tool Usage
\`\`\`json
{
  "name": "agent_execute",
  "arguments": {
    "agent": "${name}",
    "task": "Your task here",
    "stream": false
  }
}
\`\`\`

---
*Generated: ${new Date().toISOString()}*
*Category: ${category}*
`;

      const filePath = join(agentsDir, `${name}.md`);

      // Check if agent already exists
      if (existsSync(filePath)) {
        throw new Error(`Agent '${name}' already exists at ${filePath}`);
      }

      onProgress?.({ progress: 0.7, message: 'Writing agent file...' });

      // Write the markdown file
      writeFileSync(filePath, markdown, 'utf8');

      onProgress?.({ progress: 1.0, message: 'Agent created successfully' });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            agent: name,
            category,
            filePath,
            description,
            capabilities: capabilities || [],
            message: `Agent '${name}' created successfully at ${filePath}`,
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
            agent: name,
            error: error.message,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  }
};
