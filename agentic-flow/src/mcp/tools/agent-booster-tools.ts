/**
 * Agent Booster MCP Tools
 *
 * Ultra-fast code editing (352x faster than cloud APIs, $0 cost)
 * Uses Agent Booster's local WASM engine for sub-millisecond transformations
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MCPTool } from './sona-tools.js';
// agent-booster types are optional — we re-declare a structural subset so this
// file builds even when the optional sibling package is not installed (#102).
type MorphApplyResponse = {
  output: string;
  success: boolean;
  latency: number;
  tokens?: { input: number; output: number };
  confidence: number;
  strategy: string;
  error?: string;
  metadata?: any;
};

type AgentBoosterInstance = {
  apply(input: any): Promise<MorphApplyResponse>;
};

let _booster: AgentBoosterInstance | null = null;
async function getBooster(): Promise<AgentBoosterInstance> {
  if (_booster) return _booster;
  const mod: any = await import('agent-booster').catch((err: any) => {
    throw new Error(
      `Agent Booster optional package not installed: ${err?.message || err}. ` +
        `Run: npm install agent-booster`
    );
  });
  const Ctor = mod.AgentBooster ?? mod.default?.AgentBooster ?? mod.default;
  if (!Ctor) {
    throw new Error("'agent-booster' loaded but does not export AgentBooster");
  }
  _booster = new Ctor({
    confidenceThreshold: 0.5,
    maxChunks: 100,
  });
  return _booster;
}

/**
 * Agent Booster MCP Tools
 */
export const agentBoosterMCPTools: MCPTool[] = [
  {
    name: 'agent_booster_edit_file',
    description:
      'Ultra-fast code editing (352x faster than cloud APIs, $0 cost). Apply precise code edits using Agent Booster\'s local WASM engine. Use "// ... existing code ..." markers for unchanged sections.',
    inputSchema: {
      type: 'object',
      properties: {
        target_filepath: {
          type: 'string',
          description: 'Path of the file to modify',
        },
        instructions: {
          type: 'string',
          description: 'First-person instruction (e.g., "I will add error handling")',
        },
        code_edit: {
          type: 'string',
          description:
            'Precise code lines to edit, using "// ... existing code ..." for unchanged sections',
        },
        language: {
          type: 'string',
          description: 'Programming language (auto-detected from file extension if not provided)',
        },
      },
      required: ['target_filepath', 'instructions', 'code_edit'],
    },
  },
  {
    name: 'agent_booster_batch_edit',
    description:
      'Apply multiple code edits in a single operation (ultra-fast batch processing). Perfect for multi-file refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'Array of edit requests',
          items: {
            type: 'object',
            properties: {
              target_filepath: {
                type: 'string',
                description: 'File path',
              },
              instructions: {
                type: 'string',
                description: 'First-person instruction',
              },
              code_edit: {
                type: 'string',
                description: 'Code edit with markers',
              },
              language: {
                type: 'string',
                description: 'Programming language',
              },
            },
            required: ['target_filepath', 'instructions', 'code_edit'],
          },
        },
      },
      required: ['edits'],
    },
  },
  {
    name: 'agent_booster_parse_markdown',
    description:
      'Parse markdown code blocks with filepath= and instruction= metadata, then apply all edits. Compatible with LLM-generated multi-file refactoring outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            'Markdown text containing code blocks with filepath= and instruction= metadata',
        },
      },
      required: ['markdown'],
    },
  },
];

/**
 * Agent Booster MCP Tool Handlers
 */
export const agentBoosterMCPHandlers = {
  /**
   * Edit a single file with Agent Booster
   */
  agent_booster_edit_file: async (params: {
    target_filepath: string;
    instructions: string;
    code_edit: string;
    language?: string;
  }): Promise<MorphApplyResponse> => {
    try {
      // Read current file content
      const originalCode = await fs.readFile(params.target_filepath, 'utf8');

      // Auto-detect language from file extension if not provided
      const language = params.language || path.extname(params.target_filepath).slice(1);

      // Apply edit using Agent Booster - use any for flexible signature
      const booster = await getBooster();
      const result = await booster.apply({
        code: originalCode,
        edit: params.code_edit,
        language,
        target_filepath: params.target_filepath,
        instructions: params.code_edit,
        code_edit: params.code_edit,
      } as any);

      // Write modified code if successful
      if (result.success) {
        await fs.writeFile(params.target_filepath, result.output, 'utf8');
      }

      return {
        ...result,
        // Add metadata
        metadata: {
          filepath: params.target_filepath,
          instructions: params.instructions,
          language,
          originalSize: originalCode.length,
          modifiedSize: result.output.length,
        },
      } as any;
    } catch (error: any) {
      return {
        output: '',
        success: false,
        latency: 0,
        tokens: { input: 0, output: 0 },
        confidence: 0,
        strategy: 'failed',
        error: error.message,
      } as any;
    }
  },

  /**
   * Apply multiple edits in batch
   */
  agent_booster_batch_edit: async (params: {
    edits: Array<{
      target_filepath: string;
      instructions: string;
      code_edit: string;
      language?: string;
    }>;
  }): Promise<{ results: MorphApplyResponse[]; summary: any }> => {
    const results: MorphApplyResponse[] = [];

    let totalLatency = 0;
    let successCount = 0;
    let totalBytes = 0;

    for (const edit of params.edits) {
      try {
        // Read current file content
        const originalCode = await fs.readFile(edit.target_filepath, 'utf8');

        // Auto-detect language
        const language = edit.language || path.extname(edit.target_filepath).slice(1);

        // Apply edit using Agent Booster - use any for flexible signature
        const booster = await getBooster();
        const result = await booster.apply({
          code: originalCode,
          edit: edit.code_edit,
          language,
          target_filepath: edit.target_filepath,
          instructions: edit.code_edit,
          code_edit: edit.code_edit,
        } as any);

        // Write modified code if successful
        if (result.success) {
          await fs.writeFile(edit.target_filepath, result.output, 'utf8');
          successCount++;
        }

        totalLatency += result.latency;
        totalBytes += Buffer.byteLength(result.output, 'utf8');

        results.push({
          ...result,
          metadata: {
            filepath: edit.target_filepath,
            instructions: edit.instructions,
          },
        } as any);
      } catch (error: any) {
        results.push({
          output: '',
          success: false,
          latency: 0,
          tokens: { input: 0, output: 0 },
          confidence: 0,
          strategy: 'failed',
          error: error.message,
          metadata: {
            filepath: edit.target_filepath,
          },
        } as any);
      }
    }

    return {
      results,
      summary: {
        total: params.edits.length,
        successful: successCount,
        failed: params.edits.length - successCount,
        totalLatency,
        avgLatency: totalLatency / params.edits.length,
        totalBytes,
        speedupVsCloud: Math.round(352 / (totalLatency / params.edits.length)),
      },
    };
  },

  /**
   * Parse markdown and apply edits
   */
  agent_booster_parse_markdown: async (params: {
    markdown: string;
  }): Promise<{ results: MorphApplyResponse[]; summary: any }> => {
    // Parse markdown code blocks
    const codeBlockRegex =
      /```(\w+)?\s+filepath=["']([^"']+)["']\s+instruction=["']([^"']+)["']\s*\n([\s\S]*?)```/g;
    const edits: Array<{
      target_filepath: string;
      instructions: string;
      code_edit: string;
      language?: string;
    }> = [];

    let match;
    while ((match = codeBlockRegex.exec(params.markdown)) !== null) {
      edits.push({
        language: match[1],
        target_filepath: match[2],
        instructions: match[3],
        code_edit: match[4].trim(),
      });
    }

    if (edits.length === 0) {
      return {
        results: [],
        summary: {
          total: 0,
          successful: 0,
          failed: 0,
          error: 'No code blocks found with required metadata',
        },
      };
    }

    // Apply all edits
    return agentBoosterMCPHandlers.agent_booster_batch_edit({ edits });
  },
};

/**
 * Get Agent Booster statistics
 */
export function getAgentBoosterStats() {
  return {
    engine: 'Agent Booster WASM',
    version: '0.2.2',
    performance: {
      avgLatency: '1ms',
      speedup: '352x vs cloud APIs',
      costSavings: '$240/month',
    },
    features: {
      local: true,
      offline: true,
      privacy: 'Complete (no data sent to cloud)',
      languages: [
        'javascript',
        'typescript',
        'python',
        'rust',
        'go',
        'java',
        'c',
        'cpp',
        'ruby',
        'php',
        'swift',
        'kotlin',
      ],
    },
  };
}
