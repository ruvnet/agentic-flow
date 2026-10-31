/**
 * LLM-as-Judge for trajectory evaluation
 * Algorithm 2 from ReasoningBank paper
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../utils/config.js';
import { ModelRouter } from '../../router/router.js';
import type { Trajectory } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize ModelRouter once
let routerInstance: ModelRouter | null = null;
function getRouter(): ModelRouter {
  if (!routerInstance) {
    routerInstance = new ModelRouter();
  }
  return routerInstance;
}

export interface Verdict {
  label: 'Success' | 'Failure';
  confidence: number;
  reasons: string[];
}

/**
 * Judge a task trajectory using LLM evaluation
 */
export async function judgeTrajectory(
  trajectory: Trajectory,
  query: string,
  options: { useCache?: boolean } = {}
): Promise<Verdict> {
  const config = loadConfig();
  const startTime = Date.now();

  console.error(`[INFO] Judging trajectory for query: ${query.substring(0, 100)}...`);

  // Load judge prompt template (relative to this file)
  const promptPath = join(__dirname, '../prompts/judge.json');
  const promptTemplate = JSON.parse(readFileSync(promptPath, 'utf-8'));

  // Format trajectory for judgment
  const trajectoryText = formatTrajectory(trajectory);

  // Check if we have any API key configured
  const hasApiKey = process.env.OPENROUTER_API_KEY ||
                    process.env.ANTHROPIC_API_KEY ||
                    process.env.GOOGLE_GEMINI_API_KEY;

  if (!hasApiKey) {
    console.warn('[WARN] No API key set (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GEMINI_API_KEY), using heuristic judgment');
    return heuristicJudge(trajectory, query);
  }

  try {
    // Call LLM API with judge prompt using ModelRouter
    const prompt = promptTemplate.template
      .replace('{{task_query}}', query)
      .replace('{{trajectory}}', trajectoryText);

    const router = getRouter();
    const response = await router.chat({
      model: config.judge.model,
      messages: [
        { role: 'system', content: promptTemplate.system },
        { role: 'user', content: prompt }
      ],
      temperature: config.judge.temperature,
      maxTokens: config.judge.max_tokens
    }, 'reasoningbank-judge');

    // Extract content from router response
    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse JSON response
    const verdict = parseVerdict(content);

    const duration = Date.now() - startTime;
    console.error(`[INFO] Judgment complete: ${verdict.label} (${verdict.confidence}) in ${duration}ms`);
    db.logMetric('rb.judge.latency_ms', duration);
    db.logMetric('rb.judge.success_rate', verdict.label === 'Success' ? 1 : 0);

    return verdict;
  } catch (error) {
    console.error('[ERROR] Judge failed:', error);
    console.warn('[WARN] Falling back to heuristic judgment');
    return heuristicJudge(trajectory, query);
  }
}

/**
 * Format trajectory for LLM consumption
 */
function formatTrajectory(trajectory: Trajectory): string {
  const steps = trajectory.steps || [];
  let formatted = '';

  for (let i = 0; i < steps.length; i++) {
    formatted += `Step ${i + 1}: ${JSON.stringify(steps[i], null, 2)}\n\n`;
  }

  return formatted || 'No steps recorded';
}

/**
 * Parse verdict from LLM response
 */
function parseVerdict(content: string): Verdict {
  try {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        label: parsed.verdict?.label || parsed.label || 'Failure',
        confidence: parsed.verdict?.confidence || parsed.confidence || 0.5,
        reasons: parsed.verdict?.reasons || parsed.reasons || []
      };
    }
  } catch (error) {
    console.warn('[WARN] Failed to parse verdict JSON, using text analysis');
  }

  // Fallback: text-based detection
  const lower = content.toLowerCase();
  const isSuccess = lower.includes('success') && !lower.includes('failure');

  return {
    label: isSuccess ? 'Success' : 'Failure',
    confidence: 0.6,
    reasons: ['Parsed from text (JSON parse failed)']
  };
}

/**
 * Heuristic judgment when LLM is unavailable
 * Simple rule-based classification
 */
function heuristicJudge(trajectory: Trajectory, query: string): Verdict {
  const steps = trajectory.steps || [];

  // Check for error indicators
  const hasErrors = steps.some(step =>
    JSON.stringify(step).toLowerCase().includes('error')
  );

  // Check for completion indicators
  const hasCompletion = steps.some(step =>
    JSON.stringify(step).toLowerCase().includes('complete')
  );

  // Simple heuristic: success if no errors and has completion markers
  const isSuccess = !hasErrors && hasCompletion && steps.length > 0;

  return {
    label: isSuccess ? 'Success' : 'Failure',
    confidence: 0.5, // Low confidence for heuristic
    reasons: [
      `Heuristic judgment (no API key)`,
      `Steps: ${steps.length}`,
      `Errors: ${hasErrors}`,
      `Completion markers: ${hasCompletion}`
    ]
  };
}

// Import db late to avoid circular dependency
import * as db from '../db/queries.js';
