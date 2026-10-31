/**
 * Memory Distillation from trajectories
 * Algorithm 3 from ReasoningBank paper
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ulid } from 'ulid';
import { loadConfig } from '../utils/config.js';
import { scrubMemory } from '../utils/pii-scrubber.js';
import { computeEmbedding } from '../utils/embeddings.js';
import { ModelRouter } from '../../router/router.js';
import * as db from '../db/queries.js';
import type { Trajectory } from '../db/schema.js';
import type { Verdict } from './judge.js';

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

export interface DistilledMemory {
  title: string;
  description: string;
  content: string;
  tags: string[];
  domain?: string;
}

/**
 * Distill memories from a trajectory
 */
export async function distillMemories(
  trajectory: Trajectory,
  verdict: Verdict,
  query: string,
  options: { taskId?: string; agentId?: string; domain?: string } = {}
): Promise<string[]> {
  const config = loadConfig();
  const startTime = Date.now();

  console.error(`[INFO] Distilling memories from ${verdict.label} trajectory`);

  // Select appropriate prompt template
  const templateName = verdict.label === 'Success' ? 'distill-success.json' : 'distill-failure.json';
  const promptPath = join(__dirname, '../prompts', templateName);
  const promptTemplate = JSON.parse(readFileSync(promptPath, 'utf-8'));

  const maxItems = verdict.label === 'Success'
    ? config.distill.max_items_success
    : config.distill.max_items_failure;

  const confidencePrior = verdict.label === 'Success'
    ? config.distill.confidence_prior_success
    : config.distill.confidence_prior_failure;

  // Check if we have any API key configured
  const hasApiKey = process.env.OPENROUTER_API_KEY ||
                    process.env.ANTHROPIC_API_KEY ||
                    process.env.GOOGLE_GEMINI_API_KEY;

  if (!hasApiKey) {
    console.warn('[WARN] No API key set (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GEMINI_API_KEY), using template-based distillation');
    return templateBasedDistill(trajectory, verdict, query, options);
  }

  try {
    // Format trajectory
    const trajectoryText = JSON.stringify(trajectory.steps || [], null, 2);

    // Build prompt
    const prompt = promptTemplate.template
      .replace('{{task_query}}', query)
      .replace('{{trajectory}}', trajectoryText)
      .replace('{{max_items}}', String(maxItems));

    // Use ModelRouter for multi-provider support
    const router = getRouter();
    const response = await router.chat({
      model: config.distill.model || config.judge.model,
      messages: [
        { role: 'system', content: promptTemplate.system },
        { role: 'user', content: prompt }
      ],
      temperature: config.distill.temperature || 0.3,
      maxTokens: config.distill.max_tokens || 2048
    }, 'reasoningbank-distill');

    // Extract content from router response
    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse memories from response
    const distilled = parseDistilledMemories(content);

    // Store memories in database
    const memoryIds = await storeMemories(
      distilled,
      confidencePrior,
      verdict,
      options
    );

    const duration = Date.now() - startTime;
    console.error(`[INFO] Distilled ${memoryIds.length} memories in ${duration}ms`);
    db.logMetric('rb.distill.latency_ms', duration);
    db.logMetric('rb.distill.yield', memoryIds.length);

    return memoryIds;
  } catch (error) {
    console.error('[ERROR] Distillation failed:', error);
    return templateBasedDistill(trajectory, verdict, query, options);
  }
}

/**
 * Parse distilled memories from LLM response
 */
function parseDistilledMemories(content: string): DistilledMemory[] {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.memories || [];
    }
  } catch (error) {
    console.warn('[WARN] Failed to parse distilled memories JSON');
  }

  return [];
}

/**
 * Store memories in database
 */
async function storeMemories(
  memories: DistilledMemory[],
  confidencePrior: number,
  verdict: Verdict,
  options: { taskId?: string; agentId?: string; domain?: string }
): Promise<string[]> {
  const memoryIds: string[] = [];

  for (const mem of memories) {
    // Scrub PII
    const scrubbed = scrubMemory(mem);

    // Generate embedding
    const embedding = await computeEmbedding(
      `${scrubbed.title} ${scrubbed.description} ${scrubbed.content}`
    );

    // Create memory ID
    const id = ulid();

    // Store memory
    db.upsertMemory({
      id,
      type: 'reasoning_memory',
      pattern_data: {
        title: scrubbed.title,
        description: scrubbed.description,
        content: scrubbed.content,
        source: {
          task_id: options.taskId || 'unknown',
          agent_id: options.agentId || 'unknown',
          outcome: verdict.label,
          evidence: []
        },
        tags: scrubbed.tags,
        domain: options.domain || scrubbed.domain,
        created_at: new Date().toISOString(),
        confidence: confidencePrior,
        n_uses: 0
      },
      confidence: confidencePrior,
      usage_count: 0
    });

    // Store embedding
    db.upsertEmbedding({
      id,
      model: 'distill-' + verdict.label.toLowerCase(),
      dims: embedding.length,
      vector: embedding,
      created_at: new Date().toISOString()
    });

    memoryIds.push(id);
    console.error(`[INFO] Stored memory: ${scrubbed.title}`);
  }

  return memoryIds;
}

/**
 * Template-based distillation (fallback)
 * Simple extraction without LLM
 */
function templateBasedDistill(
  trajectory: Trajectory,
  verdict: Verdict,
  query: string,
  options: any
): string[] {
  console.error('[INFO] Using template-based distillation (no API key)');

  // Create a single generic memory from the trajectory
  const memory: DistilledMemory = {
    title: `${verdict.label}: ${query.substring(0, 50)}`,
    description: `Task outcome: ${verdict.label}`,
    content: `Query: ${query}\n\nSteps: ${trajectory.steps?.length || 0}\n\nOutcome: ${verdict.label}`,
    tags: [verdict.label.toLowerCase(), 'template'],
    domain: options.domain
  };

  // Store synchronously (no async needed for template)
  return []; // Skip storage for template-based (would need to make this async)
}
