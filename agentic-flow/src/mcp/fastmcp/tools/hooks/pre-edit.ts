/**
 * Pre-Edit Hook - Context retrieval and agent routing before file edit
 * Latency target: <20ms
 *
 * NOW WITH RUVECTOR INTELLIGENCE:
 * - Trajectory tracking for learning from edit sequences
 * - HNSW-powered similar file retrieval
 * - SONA pattern matching for agent selection
 */

import { z } from 'zod';
import * as path from 'path';
import type { ToolDefinition } from '../../types/index.js';
import {
  loadIntelligence,
  getAgentForFile,
  simpleEmbed,
  cosineSimilarity
} from './shared.js';
import {
  beginTaskTrajectory,
  findSimilarPatterns,
  getIntelligenceStats
} from './intelligence-bridge.js';

// Store active trajectory IDs for continuation in post-edit
const activeEditTrajectories = new Map<string, number>();

// Export for post-edit to access
export { activeEditTrajectories };

export const hookPreEditTool: ToolDefinition = {
  name: 'hook_pre_edit',
  description: 'Pre-edit intelligence: retrieve context, suggest agent, find related files',
  parameters: z.object({
    filePath: z.string().describe('Path to file being edited'),
    task: z.string().optional().describe('Optional task description')
  }),
  execute: async ({ filePath, task }, { onProgress }) => {
    const startTime = Date.now();
    const intel = loadIntelligence();
    const ext = path.extname(filePath);
    const dir = path.dirname(filePath);

    // START TRAJECTORY TRACKING (RuVector Intelligence)
    let trajectoryId: number | null = null;
    let intelligenceEnabled = false;
    let similarPatterns: Array<{ task: string; resolution: string; similarity: number }> = [];

    try {
      // Begin trajectory for this edit
      const taskDesc = task || `Edit ${path.basename(filePath)}`;
      const trajectoryResult = await beginTaskTrajectory(taskDesc, getAgentForFile(filePath));

      if (trajectoryResult.success && trajectoryResult.trajectoryId >= 0) {
        trajectoryId = trajectoryResult.trajectoryId;
        activeEditTrajectories.set(filePath, trajectoryId);
        intelligenceEnabled = true;
      }

      // Find similar past edits (cosine similarity)
      similarPatterns = await findSimilarPatterns(taskDesc, 3);
    } catch (error) {
      // Continue without trajectory if intelligence not available
      console.debug('[PreEdit] Intelligence not available:', error);
    }

    // 1. Determine suggested agent from patterns
    const state = `edit:${ext}`;
    let suggestedAgent = getAgentForFile(filePath);
    let confidence = 0.5;

    // Check learned patterns
    if (intel.patterns[state]) {
      const agents = intel.patterns[state];
      let bestAgent = suggestedAgent;
      let bestScore = 0;

      for (const [agent, score] of Object.entries(agents)) {
        if (score > bestScore) {
          bestScore = score;
          bestAgent = agent;
        }
      }

      if (bestScore > 0) {
        suggestedAgent = bestAgent;
        confidence = Math.min(0.9, 0.5 + bestScore / 10);
      }
    }

    // Check directory patterns
    if (intel.dirPatterns[dir]) {
      suggestedAgent = intel.dirPatterns[dir];
      confidence = Math.max(confidence, 0.6);
    }

    // 2. Find related files from co-edit sequences
    const relatedFiles: Array<{ file: string; score: number }> = [];
    if (intel.sequences[filePath]) {
      relatedFiles.push(
        ...intel.sequences[filePath]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
      );
    }

    // 3. Retrieve relevant memories
    const memories: Array<{ content: string; score: number }> = [];
    if (task && intel.memories.length > 0) {
      const taskEmbed = simpleEmbed(task);

      for (const mem of intel.memories) {
        if (mem.embedding) {
          const score = cosineSimilarity(taskEmbed, mem.embedding);
          if (score > 0.3) {
            memories.push({ content: mem.content.slice(0, 200), score });
          }
        }
      }

      memories.sort((a, b) => b.score - a.score);
      memories.splice(3); // Keep top 3
    }

    // 4. Check for relevant error patterns
    const errorHints: string[] = [];
    for (const ep of intel.errorPatterns) {
      if (ep.context.includes(ext) || ep.context.includes(path.basename(filePath))) {
        errorHints.push(ep.resolution);
      }
    }

    const latency = Date.now() - startTime;

    return {
      success: true,
      suggestedAgent,
      confidence,
      relatedFiles,
      memories,
      errorHints: errorHints.slice(0, 2),
      // RuVector Intelligence additions
      trajectoryId,
      intelligenceEnabled,
      similarPatterns: similarPatterns.slice(0, 3),
      latencyMs: latency,
      timestamp: new Date().toISOString()
    };
  }
};
