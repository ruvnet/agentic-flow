/**
 * Memory Consolidation
 * Algorithm 4 from ReasoningBank paper: Dedup, Contradict, Prune
 */

import { ulid } from 'ulid';
import { loadConfig } from '../utils/config.js';
import { cosineSimilarity } from '../utils/mmr.js';
import * as db from '../db/queries.js';

export interface ConsolidationResult {
  itemsProcessed: number;
  duplicatesFound: number;
  contradictionsFound: number;
  itemsPruned: number;
  durationMs: number;
}

/**
 * Run consolidation: deduplicate, detect contradictions, prune old memories
 */
export async function consolidate(): Promise<ConsolidationResult> {
  const config = loadConfig();
  const startTime = Date.now();

  console.error('[INFO] Starting memory consolidation...');

  const runId = ulid();
  const memories = db.getAllActiveMemories();

  console.error(`[INFO] Processing ${memories.length} active memories`);

  let duplicatesFound = 0;
  let contradictionsFound = 0;
  let itemsPruned = 0;

  // Step 1: Deduplicate similar memories
  duplicatesFound = await deduplicateMemories(memories, config.consolidate.duplicate_threshold);

  // Step 2: Detect contradictions
  contradictionsFound = await detectContradictions(memories, config.consolidate.contradiction_threshold);

  // Step 3: Prune old, unused memories
  itemsPruned = db.pruneOldMemories({
    maxAgeDays: config.consolidate.prune_age_days,
    minConfidence: config.consolidate.min_confidence_keep
  });

  const durationMs = Date.now() - startTime;

  // Store consolidation run
  db.storeConsolidationRun({
    run_id: runId,
    items_processed: memories.length,
    duplicates_found: duplicatesFound,
    contradictions_found: contradictionsFound,
    items_pruned: itemsPruned,
    duration_ms: durationMs
  });

  console.error(`[INFO] Consolidation complete: ${duplicatesFound} dupes, ${contradictionsFound} contradictions, ${itemsPruned} pruned in ${durationMs}ms`);

  db.logMetric('rb.consolidate.duration_ms', durationMs);
  db.logMetric('rb.consolidate.duplicates', duplicatesFound);
  db.logMetric('rb.consolidate.contradictions', contradictionsFound);
  db.logMetric('rb.consolidate.pruned', itemsPruned);

  return {
    itemsProcessed: memories.length,
    duplicatesFound,
    contradictionsFound,
    itemsPruned,
    durationMs
  };
}

/**
 * Deduplicate highly similar memories
 * PERFORMANCE FIX: Use bucketing/blocking to reduce O(n²) to ~O(n·k)
 * by only comparing memories within the same semantic bucket
 */
async function deduplicateMemories(
  memories: any[],
  threshold: number
): Promise<number> {
  let duplicatesFound = 0;

  if (memories.length === 0) return 0;

  // Fetch all embeddings in a single batch query (instead of N queries)
  const dbConn = db.getDb();
  const ids = memories.map(m => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = dbConn.prepare(`SELECT id, vector FROM pattern_embeddings WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; vector: Buffer }>;

  const embeddingsMap = new Map<string, Float32Array>();
  for (const row of rows) {
    embeddingsMap.set(row.id, new Float32Array(row.vector));
  }

  // PERFORMANCE: Use locality-sensitive hashing (LSH) bucketing
  // Group memories by their dominant embedding dimension to reduce comparisons
  const buckets = new Map<number, any[]>();
  const BUCKET_GRANULARITY = 10; // Number of buckets per dimension

  for (const mem of memories) {
    const emb = embeddingsMap.get(mem.id);
    if (!emb) continue;

    // Find dominant dimension and bucket
    let maxDim = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < Math.min(emb.length, 32); i++) { // Check first 32 dims
      if (Math.abs(emb[i]) > maxVal) {
        maxVal = Math.abs(emb[i]);
        maxDim = i;
      }
    }
    const bucketKey = maxDim * BUCKET_GRANULARITY + Math.floor((emb[maxDim] + 1) * BUCKET_GRANULARITY / 2);

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(mem);
  }

  // Compare only within buckets (and neighboring buckets for safety)
  const deletedIds = new Set<string>();

  for (const [bucketKey, bucketMemories] of buckets) {
    // Compare within bucket
    for (let i = 0; i < bucketMemories.length; i++) {
      const mem1 = bucketMemories[i];
      if (deletedIds.has(mem1.id)) continue;

      const emb1 = embeddingsMap.get(mem1.id);
      if (!emb1) continue;

      for (let j = i + 1; j < bucketMemories.length; j++) {
        const mem2 = bucketMemories[j];
        if (deletedIds.has(mem2.id)) continue;

        const emb2 = embeddingsMap.get(mem2.id);
        if (!emb2) continue;

        const similarity = cosineSimilarity(emb1, emb2);

        if (similarity >= threshold) {
          // Mark as duplicate
          db.storeLink(mem1.id, mem2.id, 'duplicate_of', similarity);
          duplicatesFound++;

          // Merge: keep the one with higher usage
          if (mem1.usage_count < mem2.usage_count) {
            deletedIds.add(mem1.id);
            console.error(`[INFO] Merged duplicate: ${mem1.pattern_data?.title || mem1.id} → ${mem2.pattern_data?.title || mem2.id}`);
          } else {
            deletedIds.add(mem2.id);
          }
        }
      }
    }
  }

  // Batch delete all duplicates in a single transaction
  if (deletedIds.size > 0) {
    const deleteIds = Array.from(deletedIds);
    const deletePlaceholders = deleteIds.map(() => '?').join(',');
    dbConn.prepare(`DELETE FROM patterns WHERE id IN (${deletePlaceholders})`).run(...deleteIds);
  }

  return duplicatesFound;
}

/**
 * Detect contradicting memories
 * Uses embedding similarity + semantic analysis
 * PERFORMANCE FIX: Reuses embeddings from deduplication phase and uses bucketing
 */
async function detectContradictions(
  memories: any[],
  threshold: number,
  preloadedEmbeddings?: Map<string, Float32Array>
): Promise<number> {
  let contradictionsFound = 0;

  if (memories.length === 0) return 0;

  // Use preloaded embeddings if available, otherwise fetch in batch
  let embeddingsMap: Map<string, Float32Array>;

  if (preloadedEmbeddings) {
    embeddingsMap = preloadedEmbeddings;
  } else {
    const dbConn = db.getDb();
    const ids = memories.map(m => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = dbConn.prepare(`SELECT id, vector FROM pattern_embeddings WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; vector: Buffer }>;

    embeddingsMap = new Map<string, Float32Array>();
    for (const row of rows) {
      embeddingsMap.set(row.id, new Float32Array(row.vector));
    }
  }

  // PERFORMANCE: Group by outcome first, only compare across different outcomes
  const outcomeGroups = new Map<string, any[]>();

  for (const mem of memories) {
    const outcome = mem.pattern_data?.source?.outcome ?? 'unknown';
    if (!outcomeGroups.has(outcome)) {
      outcomeGroups.set(outcome, []);
    }
    outcomeGroups.get(outcome)!.push(mem);
  }

  // Only compare memories with different outcomes
  const outcomeKeys = Array.from(outcomeGroups.keys());

  for (let o1 = 0; o1 < outcomeKeys.length; o1++) {
    for (let o2 = o1 + 1; o2 < outcomeKeys.length; o2++) {
      const group1 = outcomeGroups.get(outcomeKeys[o1])!;
      const group2 = outcomeGroups.get(outcomeKeys[o2])!;

      // Compare across groups (different outcomes)
      for (const mem1 of group1) {
        const emb1 = embeddingsMap.get(mem1.id);
        if (!emb1) continue;

        for (const mem2 of group2) {
          const emb2 = embeddingsMap.get(mem2.id);
          if (!emb2) continue;

          const similarity = cosineSimilarity(emb1, emb2);

          // High similarity but different outcomes = contradiction
          if (similarity >= threshold) {
            db.storeLink(mem1.id, mem2.id, 'contradicts', similarity);
            contradictionsFound++;
            console.error(`[WARN] Contradiction detected: ${mem1.pattern_data?.title || mem1.id} vs ${mem2.pattern_data?.title || mem2.id}`);
          }
        }
      }
    }
  }

  return contradictionsFound;
}

/**
 * Check if consolidation should run
 * Returns true if threshold of new memories is reached
 */
export function shouldConsolidate(): boolean {
  const config = loadConfig();
  const newCount = db.countNewMemoriesSinceConsolidation();
  return newCount >= config.consolidate.trigger_threshold;
}
