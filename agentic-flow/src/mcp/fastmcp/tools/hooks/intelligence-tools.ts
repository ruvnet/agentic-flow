/**
 * Intelligence MCP Tools - Expose RuVector Intelligence via MCP
 *
 * These tools provide direct access to the full RuVector ecosystem:
 * - @ruvector/sona: Micro-LoRA (~0.05ms), EWC++, Trajectory tracking
 * - @ruvector/attention: MoE, Flash, Hyperbolic, Graph attention
 * - Agent/pattern search: exact cosine scan (HNSW is disabled in the bridge)
 *
 * Available both as MCP tools AND CLI hooks.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../../types/index.js';
import {
  getIntelligence,
  routeTaskIntelligent,
  beginTaskTrajectory,
  recordTrajectoryStep,
  endTaskTrajectory,
  storePattern,
  findSimilarPatterns,
  getIntelligenceStats,
  forceLearningCycle,
  computeAttentionSimilarity,
} from './intelligence-bridge.js';

/**
 * Intelligence Route Tool
 * Route tasks using SONA Micro-LoRA + MoE attention + cosine agent matching
 */
export const intelligenceRouteTool: ToolDefinition = {
  name: 'intelligence_route',
  description: 'Route task using RuVector intelligence: SONA Micro-LoRA + MoE attention + cosine agent matching',
  parameters: z.object({
    task: z.string().describe('Task description to route'),
    file: z.string().optional().describe('Optional file context'),
    errorContext: z.string().optional().describe('Optional error context for debugging tasks'),
    topK: z.number().optional().default(5).describe('Number of agent candidates to return'),
  }),
  execute: async ({ task, file, errorContext, topK }, { onProgress }) => {
    const startTime = Date.now();

    try {
      const result = await routeTaskIntelligent(task, {
        file,
        errorContext,
      });

      return {
        success: true,
        agent: result.agent,
        confidence: result.confidence,
        alternatives: result.routingResults.slice(1, topK).map(r => ({
          agent: r.agentId,
          confidence: r.confidence,
        })),
        features: result.usedFeatures,
        latencyMs: result.latencyMs,
        engine: ['ruvector', ...(result.usedFeatures ?? [])].join('+'),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Trajectory Start Tool
 * Begin trajectory tracking for learning from task execution
 */
export const intelligenceTrajectoryStartTool: ToolDefinition = {
  name: 'intelligence_trajectory_start',
  description: 'Begin SONA trajectory for learning from task execution. Returns trajectoryId for tracking.',
  parameters: z.object({
    task: z.string().describe('Task description'),
    agent: z.string().describe('Agent executing the task'),
    context: z.string().optional().describe('Additional context'),
  }),
  execute: async ({ task, agent, context }, { onProgress }) => {
    const startTime = Date.now();

    try {
      const fullTask = context ? `${task} [context: ${context}]` : task;
      const result = await beginTaskTrajectory(fullTask, agent);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to start trajectory',
          latencyMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        trajectoryId: result.trajectoryId,
        message: `Trajectory ${result.trajectoryId} started for agent ${agent}`,
        trackingEnabled: true,
        features: ['micro-lora', 'ewc++', 'attention-patterns'],
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Trajectory Step Tool
 * Record intermediate steps during task execution
 */
export const intelligenceTrajectoryStepTool: ToolDefinition = {
  name: 'intelligence_trajectory_step',
  description: 'Record a step in the trajectory for reinforcement learning',
  parameters: z.object({
    trajectoryId: z.number().describe('Trajectory ID from trajectory_start'),
    action: z.string().describe('Action taken (e.g., "edit-file", "run-test")'),
    reward: z.number().min(-1).max(1).describe('Reward signal (-1 to 1)'),
    file: z.string().optional().describe('File involved'),
    errorFixed: z.boolean().optional().describe('Whether an error was fixed'),
    testPassed: z.boolean().optional().describe('Whether tests passed'),
  }),
  execute: async ({ trajectoryId, action, reward, file, errorFixed, testPassed }, { onProgress }) => {
    const startTime = Date.now();

    try {
      await recordTrajectoryStep(trajectoryId, action, reward, {
        file,
        errorFixed,
        testPassed,
      });

      return {
        success: true,
        trajectoryId,
        action,
        reward,
        message: `Step recorded: ${action} with reward ${reward}`,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Trajectory End Tool
 * Complete trajectory and trigger learning with EWC++
 */
export const intelligenceTrajectoryEndTool: ToolDefinition = {
  name: 'intelligence_trajectory_end',
  description: 'End trajectory, trigger SONA learning with EWC++ (prevents catastrophic forgetting)',
  parameters: z.object({
    trajectoryId: z.number().describe('Trajectory ID from trajectory_start'),
    success: z.boolean().describe('Whether the task was successful'),
    quality: z.number().min(0).max(1).optional().default(0.8).describe('Quality score (0-1)'),
  }),
  execute: async ({ trajectoryId, success, quality }, { onProgress }) => {
    const startTime = Date.now();

    try {
      const outcome = await endTaskTrajectory(trajectoryId, success, quality);

      return {
        success: true,
        trajectoryId,
        taskSuccess: success,
        quality,
        learningOutcome: outcome,
        features: ['micro-lora-update', 'ewc++-consolidation', 'reasoning-bank-storage'],
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Pattern Store Tool
 * Store successful patterns in ReasoningBank for future retrieval
 */
export const intelligencePatternStoreTool: ToolDefinition = {
  name: 'intelligence_pattern_store',
  description: 'Store pattern in ReasoningBank (retrieved by cosine similarity)',
  parameters: z.object({
    task: z.string().describe('Task description'),
    resolution: z.string().describe('How the task was resolved'),
    reward: z.number().min(0).max(1).describe('Success score (0-1)'),
    tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
  }),
  execute: async ({ task, resolution, reward, tags }, { onProgress }) => {
    const startTime = Date.now();

    try {
      await storePattern(task, resolution, reward);

      return {
        success: true,
        message: `Pattern stored: "${task.slice(0, 50)}..."`,
        reward,
        indexed: true,
        retrieval: 'cosine',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Pattern Search Tool
 * Find similar patterns by cosine similarity
 */
export const intelligencePatternSearchTool: ToolDefinition = {
  name: 'intelligence_pattern_search',
  description: 'Search ReasoningBank for similar patterns by cosine similarity',
  parameters: z.object({
    query: z.string().describe('Query to search for similar patterns'),
    topK: z.number().optional().default(5).describe('Number of results to return'),
    minReward: z.number().min(0).max(1).optional().describe('Minimum reward filter'),
  }),
  execute: async ({ query, topK, minReward }, { onProgress }) => {
    const startTime = Date.now();

    try {
      let patterns = await findSimilarPatterns(query, topK);

      // Filter by minimum reward if specified
      if (minReward !== undefined) {
        patterns = patterns.filter(p => p.reward >= minReward);
      }

      return {
        success: true,
        query: query.slice(0, 50),
        patterns,
        count: patterns.length,
        searchEngine: 'cosine',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Intelligence Stats Tool
 * Get statistics about the intelligence layer
 */
export const intelligenceStatsTool: ToolDefinition = {
  name: 'intelligence_stats',
  description: 'Get RuVector intelligence layer statistics: SONA, HNSW, attention metrics',
  parameters: z.object({}),
  execute: async (_, { onProgress }) => {
    const startTime = Date.now();

    try {
      // Initialize intelligence FIRST, then get stats
      const intelligence = await getIntelligence();
      const fullStats = intelligence.getStats();
      const stats = await getIntelligenceStats();

      return {
        success: true,
        stats: {
          ...stats,
          ...fullStats,
        },
        features: {
          sona: {
            enabled: stats.features?.includes('sona') ?? false,
            microLora: 'rank-1 (~0.05ms)',
            baseLora: 'rank-8',
            ewcLambda: 1000.0,
          },
          attention: {
            type: 'moe',
            experts: 4,
            topK: 2,
          },
          hnsw: {
            enabled: stats.features?.includes('hnsw') ?? false,
            search: stats.features?.includes('hnsw') ? 'hnsw' : 'exact cosine scan',
          },
        },
        persistence: {
          enabled: true,
          backend: 'sqlite',
          trajectories: stats.persistedStats?.trajectories ?? 0,
          routings: stats.persistedStats?.routings ?? 0,
          patterns: stats.persistedStats?.patterns ?? 0,
          operations: stats.persistedStats?.operations ?? 0,
        },
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Force Learning Tool
 * Trigger an immediate learning cycle
 */
export const intelligenceLearnTool: ToolDefinition = {
  name: 'intelligence_learn',
  description: 'Force immediate SONA learning cycle with EWC++ consolidation',
  parameters: z.object({
    reason: z.string().optional().describe('Reason for forcing learning'),
  }),
  execute: async ({ reason }, { onProgress }) => {
    const startTime = Date.now();

    try {
      const result = await forceLearningCycle();

      return {
        success: true,
        message: 'Learning cycle completed',
        result,
        reason: reason || 'manual trigger',
        features: ['micro-lora-batch', 'ewc++-consolidation', 'pattern-distillation'],
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

/**
 * Attention Compute Tool
 * Compute attention-weighted similarity using MoE/Flash/Hyperbolic
 */
export const intelligenceAttentionTool: ToolDefinition = {
  name: 'intelligence_attention',
  description: 'Compute attention-weighted similarity using MoE/Flash/Hyperbolic attention',
  parameters: z.object({
    query: z.string().describe('Query text'),
    candidates: z.array(z.string()).describe('Candidate texts to score'),
    attentionType: z.enum(['moe', 'flash', 'hyperbolic', 'graph', 'dual']).optional().default('moe')
      .describe('Attention mechanism type'),
  }),
  execute: async ({ query, candidates, attentionType }, { onProgress }) => {
    const startTime = Date.now();

    try {
      // Simple embedding function
      const embed = (text: string): Float32Array => {
        const arr = new Float32Array(64);
        const words = text.toLowerCase().split(/\s+/);
        for (const word of words) {
          for (let i = 0; i < word.length; i++) {
            const idx = (word.charCodeAt(i) * (i + 1)) % 64;
            arr[idx] += 1;
          }
        }
        // Normalize
        const mag = Math.sqrt(arr.reduce((sum, v) => sum + v * v, 0));
        if (mag > 0) {
          for (let i = 0; i < arr.length; i++) arr[i] /= mag;
        }
        return arr;
      };

      const queryEmbed = embed(query);
      const candidateEmbeds = candidates.map(c => embed(c));

      const scores = await computeAttentionSimilarity(queryEmbed, candidateEmbeds);

      const results = candidates.map((c, i) => ({
        text: c.slice(0, 50),
        score: scores[i] || 0,
      })).sort((a, b) => b.score - a.score);

      return {
        success: true,
        query: query.slice(0, 50),
        attentionType,
        results,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

// Export all intelligence tools
export const intelligenceTools = [
  intelligenceRouteTool,
  intelligenceTrajectoryStartTool,
  intelligenceTrajectoryStepTool,
  intelligenceTrajectoryEndTool,
  intelligencePatternStoreTool,
  intelligencePatternSearchTool,
  intelligenceStatsTool,
  intelligenceLearnTool,
  intelligenceAttentionTool,
];
