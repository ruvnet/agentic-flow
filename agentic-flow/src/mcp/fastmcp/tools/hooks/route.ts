/**
 * Route Hook - Intelligent agent selection with SONA-style routing
 * Uses learned patterns, context, and exploration/exploitation balance
 *
 * NOW WITH FULL RUVECTOR INTELLIGENCE:
 * - @ruvector/sona: Micro-LoRA (~0.05ms), trajectories
 * - @ruvector/attention: MoE attention-based ranking
 * - Agent/pattern search: exact cosine scan
 */

import { z } from 'zod';
import * as path from 'path';
import type { ToolDefinition } from '../../types/index.js';
import {
  loadIntelligence,
  getAgentForFile,
  simpleEmbed,
  cosineSimilarity,
  agentMapping
} from './shared.js';
import {
  routeTaskIntelligent,
  findSimilarPatterns,
  getIntelligenceStats
} from './intelligence-bridge.js';

// Exploration rate for epsilon-greedy selection
const EXPLORATION_RATE = 0.1;

// Flag to use RuVector intelligence (can be toggled)
const USE_RUVECTOR_INTELLIGENCE = process.env.RUVECTOR_INTELLIGENCE_ENABLED !== 'false';

// Available agent types
const availableAgents = [
  'coder',
  'researcher',
  'analyst',
  'optimizer',
  'coordinator',
  'typescript-developer',
  'rust-developer',
  'python-developer',
  'go-developer',
  'react-developer',
  'test-engineer',
  'documentation-specialist',
  'database-specialist',
  'devops-engineer',
  'cicd-engineer',
  'security-specialist',
  'frontend-developer',
  'backend-developer'
];

export const hookRouteTool: ToolDefinition = {
  name: 'hook_route',
  description: 'Route task to optimal agent using learned patterns and context',
  parameters: z.object({
    task: z.string().describe('Task description'),
    context: z.object({
      file: z.string().optional(),
      recentFiles: z.array(z.string()).optional(),
      errorContext: z.string().optional()
    }).optional().describe('Optional context'),
    explore: z.boolean().optional().default(false).describe('Force exploration')
  }),
  execute: async ({ task, context, explore }, { onProgress }) => {
    const startTime = Date.now();

    // TRY RUVECTOR INTELLIGENCE FIRST (Micro-LoRA + HNSW + MoE)
    if (USE_RUVECTOR_INTELLIGENCE && !explore) {
      try {
        const intelligentResult = await routeTaskIntelligent(task, context);

        // Also check for similar patterns from ReasoningBank
        const similarPatterns = await findSimilarPatterns(task, 3);

        // Get stats for monitoring
        const stats = await getIntelligenceStats();

        return {
          success: true,
          agent: intelligentResult.agent,
          confidence: intelligentResult.confidence,
          score: intelligentResult.routingResults[0]?.confidence || 0,
          factors: [
            {
              name: 'ruvector_intelligence',
              weight: 3.0,
              agent: intelligentResult.agent,
              evidence: `SONA + MoE routing in ${intelligentResult.latencyMs.toFixed(2)}ms`
            },
            ...intelligentResult.usedFeatures.map(f => ({
              name: f,
              weight: 1.0,
              agent: intelligentResult.agent,
              evidence: `Used ${f} for routing`
            }))
          ],
          alternatives: intelligentResult.routingResults.slice(1, 4).map(r => ({
            agent: r.agentId,
            score: r.confidence,
            whyNot: `Score ${r.confidence.toFixed(2)} < best`
          })),
          similarPatterns: similarPatterns.slice(0, 2),
          explored: false,
          latencyMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          intelligenceStats: stats,
          engine: 'ruvector' // Mark that we used RuVector
        };
      } catch (error) {
        // Fall back to simple routing if intelligence fails
        console.warn('[Route] RuVector intelligence failed, using fallback:', error);
      }
    }

    // FALLBACK: Simple Q-learning routing (original implementation)
    const intel = loadIntelligence();

    // Track scoring factors
    const factors: Array<{
      name: string;
      weight: number;
      agent: string;
      evidence: string;
    }> = [];

    // Agent scores
    const scores: Record<string, number> = {};
    for (const agent of availableAgents) {
      scores[agent] = 0;
    }

    // 1. Score based on file context
    if (context?.file) {
      const ext = path.extname(context.file);
      const fileAgent = getAgentForFile(context.file);
      scores[fileAgent] = (scores[fileAgent] || 0) + 2.0;

      factors.push({
        name: 'file_pattern',
        weight: 2.0,
        agent: fileAgent,
        evidence: `File ${context.file} matches ${fileAgent}`
      });

      // Check learned patterns for this extension
      const state = `edit:${ext}`;
      if (intel.patterns[state]) {
        for (const [agent, value] of Object.entries(intel.patterns[state])) {
          if (typeof value === 'number') {
            scores[agent] = (scores[agent] || 0) + value;
            if (value > 0.5) {
              factors.push({
                name: 'learned_pattern',
                weight: value,
                agent,
                evidence: `Q-value ${value.toFixed(2)} for ${ext} edits`
              });
            }
          }
        }
      }
    }

    // 2. Score based on task keywords
    const taskLower = task.toLowerCase();
    const keywordScores: Record<string, string[]> = {
      'test-engineer': ['test', 'spec', 'coverage', 'mock', 'assert'],
      'documentation-specialist': ['document', 'readme', 'docs', 'explain', 'comment'],
      'security-specialist': ['security', 'auth', 'encrypt', 'vulnerability', 'owasp'],
      'database-specialist': ['database', 'sql', 'query', 'migration', 'schema'],
      'devops-engineer': ['docker', 'deploy', 'ci', 'cd', 'kubernetes', 'container'],
      'frontend-developer': ['ui', 'component', 'style', 'css', 'layout'],
      'backend-developer': ['api', 'endpoint', 'server', 'route', 'middleware'],
      'optimizer': ['optimize', 'performance', 'speed', 'cache', 'memory'],
      'researcher': ['research', 'find', 'search', 'explore', 'understand'],
      'analyst': ['analyze', 'review', 'audit', 'check', 'evaluate']
    };

    for (const [agent, keywords] of Object.entries(keywordScores)) {
      for (const keyword of keywords) {
        if (taskLower.includes(keyword)) {
          scores[agent] = (scores[agent] || 0) + 1.5;
          factors.push({
            name: 'keyword_match',
            weight: 1.5,
            agent,
            evidence: `Task contains "${keyword}"`
          });
          break; // Only count once per agent
        }
      }
    }

    // 3. Score based on memory similarity
    if (intel.memories.length > 0) {
      const taskEmbed = simpleEmbed(task);

      for (const mem of intel.memories) {
        if (mem.embedding && mem.type === 'success') {
          const similarity = cosineSimilarity(taskEmbed, mem.embedding);
          if (similarity > 0.4) {
            // Extract agent from memory content
            const agentMatch = mem.content.match(/by (\S+)/);
            if (agentMatch && scores[agentMatch[1]] !== undefined) {
              scores[agentMatch[1]] += similarity;
              factors.push({
                name: 'memory_match',
                weight: similarity,
                agent: agentMatch[1],
                evidence: `Similar to: ${mem.content.slice(0, 50)}...`
              });
            }
          }
        }
      }
    }

    // 4. Check for error context
    if (context?.errorContext) {
      for (const ep of intel.errorPatterns) {
        if (context.errorContext.includes(ep.errorType)) {
          // Find agent with best success rate for this error
          let bestAgent = 'coder';
          let bestScore = 0;

          for (const [agent, score] of Object.entries(ep.agentSuccess)) {
            if (score > bestScore) {
              bestScore = score;
              bestAgent = agent;
            }
          }

          if (bestScore > 0) {
            scores[bestAgent] = (scores[bestAgent] || 0) + 2.0;
            factors.push({
              name: 'error_specialist',
              weight: 2.0,
              agent: bestAgent,
              evidence: `Best at fixing ${ep.errorType}`
            });
          }
        }
      }
    }

    // 5. Select best agent (with exploration)
    let selectedAgent = 'coder';
    let maxScore = 0;

    // Epsilon-greedy: explore with probability EXPLORATION_RATE
    if (explore || Math.random() < EXPLORATION_RATE) {
      // Random selection for exploration
      const agentsWithScores = Object.keys(scores).filter(a => scores[a] > 0);
      if (agentsWithScores.length > 0) {
        selectedAgent = agentsWithScores[Math.floor(Math.random() * agentsWithScores.length)];
      } else {
        selectedAgent = availableAgents[Math.floor(Math.random() * availableAgents.length)];
      }
      factors.push({
        name: 'exploration',
        weight: 0,
        agent: selectedAgent,
        evidence: 'Random exploration for learning'
      });
    } else {
      // Exploitation: select best
      for (const [agent, score] of Object.entries(scores)) {
        if (score > maxScore) {
          maxScore = score;
          selectedAgent = agent;
        }
      }
    }

    // Calculate confidence
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const confidence = totalScore > 0 ? maxScore / totalScore : 0.5;

    // Get alternatives
    const alternatives = Object.entries(scores)
      .filter(([agent]) => agent !== selectedAgent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([agent, score]) => ({
        agent,
        score,
        whyNot: score < maxScore ? `Score ${score.toFixed(2)} < ${maxScore.toFixed(2)}` : 'Not selected'
      }));

    const latency = Date.now() - startTime;

    return {
      success: true,
      agent: selectedAgent,
      confidence: Math.min(0.95, confidence),
      score: maxScore,
      factors: factors.slice(0, 5),
      alternatives,
      explored: explore || Math.random() < EXPLORATION_RATE,
      latencyMs: latency,
      timestamp: new Date().toISOString()
    };
  }
};
