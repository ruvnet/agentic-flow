/**
 * Memory Retrieval with MMR diversity
 * Algorithm 1 from ReasoningBank paper
 */

import { computeEmbedding } from '../utils/embeddings.js';
import { mmrSelection, cosineSimilarity } from '../utils/mmr.js';
import * as db from '../db/queries.js';
import { loadConfig } from '../utils/config.js';

export interface RetrievedMemory {
  id: string;
  title: string;
  description: string;
  content: string;
  score: number;
  components: {
    similarity: number;
    recency: number;
    reliability: number;
  };
}

/**
 * Retrieve top-k memories with MMR diversity
 *
 * Scoring formula: score = α·sim + β·recency + γ·reliability
 * Where:
 * - sim: cosine similarity to query
 * - recency: exp(-age_days / half_life)
 * - reliability: min(confidence, 1.0)
 */
export async function retrieveMemories(
  query: string,
  options: { k?: number; domain?: string; agent?: string } = {}
): Promise<RetrievedMemory[]> {
  const config = loadConfig();
  const k = options.k || config.retrieve.k;
  const startTime = Date.now();

  console.error(`[INFO] Retrieving memories for query: ${query.substring(0, 100)}...`);

  // 1. Embed query
  const queryEmbed = await computeEmbedding(query);

  // 2. Fetch candidates from database
  const candidates = db.fetchMemoryCandidates({
    domain: options.domain,
    agent: options.agent,
    minConfidence: config.retrieve.min_score
  });

  if (candidates.length === 0) {
    console.error('[INFO] No memory candidates found');
    return [];
  }

  console.error(`[INFO] Found ${candidates.length} candidates`);

  // 3. Score each candidate with 4-factor model
  const scored = candidates.map(item => {
    const similarity = cosineSimilarity(queryEmbed, item.embedding);
    const recency = Math.exp(-item.age_days / config.retrieve.recency_half_life_days);
    const reliability = Math.min(item.confidence, 1.0);

    const baseScore =
      config.retrieve.alpha * similarity +
      config.retrieve.beta * recency +
      config.retrieve.gamma * reliability;

    return {
      ...item,
      score: baseScore,
      components: { similarity, recency, reliability }
    };
  });

  // 4. MMR selection for diversity
  const selected = mmrSelection(scored, queryEmbed, k, config.retrieve.delta);

  // 5. Record usage for selected memories
  for (const mem of selected) {
    db.incrementUsage(mem.id);
  }

  const duration = Date.now() - startTime;
  console.error(`[INFO] Retrieval complete: ${selected.length} memories in ${duration}ms`);
  db.logMetric('rb.retrieve.latency_ms', duration);

  return selected.map(item => ({
    id: item.id,
    title: item.pattern_data.title,
    description: item.pattern_data.description,
    content: item.pattern_data.content,
    score: item.score,
    components: item.components
  }));
}

/**
 * Format memories for injection into system prompt
 */
export function formatMemoriesForPrompt(memories: RetrievedMemory[]): string {
  if (memories.length === 0) {
    return '';
  }

  let formatted = '\n## Relevant Memories from Past Experience\n\n';

  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    formatted += `### Memory ${i + 1}: ${mem.title}\n\n`;
    formatted += `${mem.description}\n\n`;
    formatted += `**Strategy:**\n${mem.content}\n\n`;
    formatted += `*Confidence: ${(mem.score * 100).toFixed(1)}% | `;
    formatted += `Similarity: ${(mem.components.similarity * 100).toFixed(1)}%*\n\n`;
    formatted += '---\n\n';
  }

  return formatted;
}
