/**
 * Hook Tools - Intelligent agent routing and self-learning
 * Integrates with ReasoningBank, LearningSystem, and Swarm
 *
 * NOW WITH FULL RUVECTOR INTELLIGENCE:
 * - @ruvector/sona: Micro-LoRA (~0.05ms), EWC++, Trajectory tracking
 * - @ruvector/attention: MoE, Flash, Hyperbolic, Graph attention
 * - Agent/pattern search: exact cosine scan
 *
 * Available as BOTH:
 * 1. MCP Tools (via hooks-server.ts)
 * 2. CLI Hooks (via npx ruvector hooks)
 */

// Hook tools (original)
export { hookPreEditTool } from './pre-edit.js';
export { hookPostEditTool } from './post-edit.js';
export { hookPreCommandTool } from './pre-command.js';
export { hookPostCommandTool } from './post-command.js';
export { hookRouteTool } from './route.js';
export { hookExplainTool } from './explain.js';
export { hookPretrainTool } from './pretrain.js';
export { hookBuildAgentsTool } from './build-agents.js';
export { hookMetricsTool } from './metrics.js';
export { hookTransferTool } from './transfer.js';

// RuVector Intelligence Bridge
export {
  getIntelligence,
  routeTaskIntelligent,
  beginTaskTrajectory,
  recordTrajectoryStep,
  endTaskTrajectory,
  storePattern,
  findSimilarPatterns,
  getIntelligenceStats,
  forceLearningCycle,
  computeAttentionSimilarity
} from './intelligence-bridge.js';

// RuVector Intelligence MCP Tools (NEW)
export {
  intelligenceRouteTool,
  intelligenceTrajectoryStartTool,
  intelligenceTrajectoryStepTool,
  intelligenceTrajectoryEndTool,
  intelligencePatternStoreTool,
  intelligencePatternSearchTool,
  intelligenceStatsTool,
  intelligenceLearnTool,
  intelligenceAttentionTool,
  intelligenceTools
} from './intelligence-tools.js';

// Import all tools for registration
import { hookPreEditTool } from './pre-edit.js';
import { hookPostEditTool } from './post-edit.js';
import { hookPreCommandTool } from './pre-command.js';
import { hookPostCommandTool } from './post-command.js';
import { hookRouteTool } from './route.js';
import { hookExplainTool } from './explain.js';
import { hookPretrainTool } from './pretrain.js';
import { hookBuildAgentsTool } from './build-agents.js';
import { hookMetricsTool } from './metrics.js';
import { hookTransferTool } from './transfer.js';
import { intelligenceTools } from './intelligence-tools.js';

// Original hook tools (10 tools)
export const hookTools = [
  hookPreEditTool,
  hookPostEditTool,
  hookPreCommandTool,
  hookPostCommandTool,
  hookRouteTool,
  hookExplainTool,
  hookPretrainTool,
  hookBuildAgentsTool,
  hookMetricsTool,
  hookTransferTool
];

// All tools including intelligence (19 tools total)
export const allHookTools = [
  ...hookTools,
  ...intelligenceTools
];
