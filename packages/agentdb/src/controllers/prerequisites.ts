/**
 * Controller Prerequisites Registry
 *
 * Documents which agentdb controllers can be auto-activated by downstream
 * consumers (e.g. ruflo's memory bridge) versus which require external
 * dependencies that the embedding host has to supply.
 *
 * Issue #146 Gap 2 — downstream consumers were reading dist source to discover
 * which controllers were safe to default-construct. This module hoists that
 * information into the public API so callers can do:
 *
 * ```ts
 * import { controllerPrerequisites } from 'agentdb';
 *
 * const safe = controllerPrerequisites.filter(c => c.requirements.length === 0);
 * // → controllers whose constructor needs no external resources
 * ```
 *
 * The data is hand-curated and tracked alongside controller source files so
 * adding a new controller forces a registry update in the same change.
 */

/**
 * What a controller needs at construction time. Anything in `requirements`
 * has to be produced by the host before the controller can be instantiated.
 */
export type ControllerRequirement =
  | 'database'           // SQLite handle (better-sqlite3 / sql.js Database)
  | 'embedder'           // EmbeddingService (or compatible)
  | 'vectorBackend'      // VectorBackend implementation
  | 'graphBackend'       // External graph DB connection
  | 'learningBackend'    // LearningBackend implementation
  | 'config'             // Mandatory configuration object (no defaults)
  | 'wasm'               // WASM runtime / native binding
  | 'networkEndpoint';   // Reachable QUIC / HTTP peer

/** Activation safety: what happens when this controller is constructed. */
export type ControllerSafety =
  /** Constructor itself is pure — no I/O, threads, or network. */
  | 'pure'
  /** Constructor opens a file handle / WASM module / process resource. */
  | 'opens-resource'
  /** Constructor performs a network operation (e.g. binds a socket). */
  | 'opens-network';

export interface ControllerPrerequisite {
  /** Controller class name as exported from `agentdb`. */
  name: string;
  /**
   * Required external resources. When empty, the controller can be
   * default-constructed with no host-supplied arguments.
   */
  requirements: ControllerRequirement[];
  /** Optional resources — controller works without them but is degraded. */
  optional: ControllerRequirement[];
  /** Constructor arity (positional args). Useful for reflection-style wiring. */
  arity: number;
  /** What happens when this controller is instantiated. */
  safety: ControllerSafety;
  /** Short human description for tooling output. */
  description: string;
}

/**
 * Authoritative list of agentdb controllers and their construction needs.
 *
 * Order is alphabetical for easy diffs. Entries match the export names from
 * `controllers/index.ts`.
 */
export const controllerPrerequisites: readonly ControllerPrerequisite[] = Object.freeze([
  {
    name: 'AttentionService',
    requirements: ['config'],
    optional: ['wasm'],
    arity: 1,
    safety: 'opens-resource',
    description: 'Self / cross / multi-head attention over embeddings (uses @ruvector/attention WASM when present).'
  },
  {
    name: 'CausalMemoryGraph',
    requirements: ['database'],
    optional: ['embedder', 'graphBackend', 'vectorBackend', 'config'],
    arity: 5,
    safety: 'opens-resource',
    description: 'Causal edge graph over memories. Needs a database; graphBackend lets you swap to an external graph DB.'
  },
  {
    name: 'CausalRecall',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'config'],
    arity: 4,
    safety: 'pure',
    description: 'Causal-uplift reranker for recall queries.'
  },
  {
    name: 'ContextSynthesizer',
    requirements: ['database'],
    optional: ['embedder', 'config'],
    arity: 3,
    safety: 'pure',
    description: 'Synthesises retrieved memories into a coherent context window.'
  },
  {
    name: 'CrossAttentionController',
    requirements: ['config'],
    optional: ['wasm'],
    arity: 1,
    safety: 'opens-resource',
    description: 'Cross-attention controller (per-head context fusion).'
  },
  {
    name: 'EmbeddingService',
    requirements: ['config'],
    optional: [],
    arity: 1,
    safety: 'pure',
    description: 'Text → vector embedder (transformers.js / OpenAI / local).'
  },
  {
    name: 'EnhancedEmbeddingService',
    requirements: ['config'],
    optional: [],
    arity: 1,
    safety: 'pure',
    description: 'EmbeddingService with caching, batching, and provider fallback.'
  },
  {
    name: 'ExplainableRecall',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend'],
    arity: 3,
    safety: 'pure',
    description: 'Recall layer that emits feature attributions per match.'
  },
  {
    name: 'HNSWIndex',
    requirements: ['database'],
    optional: ['config'],
    arity: 2,
    safety: 'opens-resource',
    description: 'On-disk HNSW vector index. Loads native hnswlib when available.'
  },
  {
    name: 'LearningSystem',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'config'],
    arity: 4,
    safety: 'pure',
    description: 'Online learner that consolidates patterns and skills.'
  },
  {
    name: 'MMRDiversityRanker',
    requirements: [],
    optional: ['config'],
    arity: 1,
    safety: 'pure',
    description: 'Maximal Marginal Relevance diversity reranker.'
  },
  {
    name: 'MemoryController',
    requirements: [],
    optional: ['vectorBackend', 'config'],
    arity: 2,
    safety: 'pure',
    description: 'High-level memory orchestration over a vector backend (works in-memory if backend omitted).'
  },
  {
    name: 'MetadataFilter',
    requirements: [],
    optional: [],
    arity: 0,
    safety: 'pure',
    description: 'Pure utility for filtering memories by metadata predicates.'
  },
  {
    name: 'MultiHeadAttentionController',
    requirements: ['config'],
    optional: ['wasm'],
    arity: 1,
    safety: 'opens-resource',
    description: 'Multi-head attention controller built on AttentionService.'
  },
  {
    name: 'NightlyLearner',
    requirements: ['database', 'embedder'],
    optional: ['config'],
    arity: 3,
    safety: 'pure',
    description: 'Background consolidation pipeline (causal edges, A/B uplift, skill distillation).'
  },
  {
    name: 'QUICClient',
    requirements: ['config', 'networkEndpoint'],
    optional: [],
    arity: 1,
    safety: 'opens-network',
    description: 'QUIC sync client. Reaches out to a peer at construction time.'
  },
  {
    name: 'QUICServer',
    requirements: ['config'],
    optional: [],
    arity: 1,
    safety: 'opens-network',
    description: 'QUIC sync server. Binds a UDP socket at construction time.'
  },
  {
    name: 'ReasoningBank',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'graphBackend', 'config'],
    arity: 5,
    safety: 'pure',
    description: 'Top-level reasoning memory facade combining reflexion / causal / skill controllers.'
  },
  {
    name: 'ReflexionMemory',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'learningBackend', 'graphBackend'],
    arity: 5,
    safety: 'pure',
    description: 'Episodic replay memory (Reflexion paper). Stores critiques + outcomes.'
  },
  {
    name: 'SelfAttentionController',
    requirements: ['config'],
    optional: ['wasm'],
    arity: 1,
    safety: 'opens-resource',
    description: 'Self-attention controller (intra-context salience).'
  },
  {
    name: 'SkillLibrary',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'graphBackend', 'config'],
    arity: 5,
    safety: 'pure',
    description: 'Reusable skill registry with similarity-based retrieval.'
  },
  {
    name: 'SyncCoordinator',
    requirements: ['config'],
    optional: ['networkEndpoint'],
    arity: 1,
    safety: 'opens-network',
    description: 'Coordinates multi-peer QUIC sync.'
  },
  {
    name: 'WASMVectorSearch',
    requirements: ['wasm'],
    optional: ['config'],
    arity: 1,
    safety: 'opens-resource',
    description: 'Pure-WASM vector search index (no native deps).'
  }
]);

/**
 * Convenience: controllers safe to default-construct (no required resources).
 * These are what downstream "auto-activate" passes can enable without host
 * cooperation.
 */
export const noArgControllers: readonly ControllerPrerequisite[] = Object.freeze(
  controllerPrerequisites.filter(c => c.requirements.length === 0)
);

/** Look up a controller's prerequisites by name. Returns null if unknown. */
export function getControllerPrerequisite(name: string): ControllerPrerequisite | null {
  return controllerPrerequisites.find(c => c.name === name) ?? null;
}

/**
 * Filter controllers by safety class. Useful for hosts that want to enable
 * everything except network-touching controllers, for example:
 *
 * ```ts
 * const offlineSafe = filterBySafety(['pure', 'opens-resource']);
 * ```
 */
export function filterBySafety(
  safety: readonly ControllerSafety[]
): readonly ControllerPrerequisite[] {
  return controllerPrerequisites.filter(c => safety.includes(c.safety));
}
