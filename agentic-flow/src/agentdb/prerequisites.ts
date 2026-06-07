/**
 * Controller Prerequisites — local shim for `agentic-flow/agentdb`.
 *
 * Mirrors the registry that lives in the upstream `agentdb` package
 * (`agentdb/dist/controllers/prerequisites.js`). Exposing it through the
 * `agentic-flow/agentdb` re-export means consumers (e.g. ruflo) can rely on
 * a single import surface regardless of which agentdb version is installed.
 *
 * Issue #146 Gap 2.
 */

export type ControllerRequirement =
  | 'database'
  | 'embedder'
  | 'vectorBackend'
  | 'graphBackend'
  | 'learningBackend'
  | 'config'
  | 'wasm'
  | 'networkEndpoint';

export type ControllerSafety = 'pure' | 'opens-resource' | 'opens-network';

export interface ControllerPrerequisite {
  name: string;
  requirements: ControllerRequirement[];
  optional: ControllerRequirement[];
  arity: number;
  safety: ControllerSafety;
  description: string;
}

export const controllerPrerequisites: readonly ControllerPrerequisite[] = Object.freeze([
  {
    name: 'AttentionService',
    requirements: ['config'],
    optional: ['wasm'],
    arity: 1,
    safety: 'opens-resource',
    description: 'Self / cross / multi-head attention over embeddings.'
  },
  {
    name: 'CausalMemoryGraph',
    requirements: ['database'],
    optional: ['embedder', 'graphBackend', 'vectorBackend', 'config'],
    arity: 5,
    safety: 'opens-resource',
    description: 'Causal edge graph over memories.'
  },
  {
    name: 'CausalRecall',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'config'],
    arity: 4,
    safety: 'pure',
    description: 'Causal-uplift reranker.'
  },
  {
    name: 'ContextSynthesizer',
    requirements: ['database'],
    optional: ['embedder', 'config'],
    arity: 3,
    safety: 'pure',
    description: 'Synthesises retrieved memories into context.'
  },
  {
    name: 'EmbeddingService',
    requirements: ['config'],
    optional: [],
    arity: 1,
    safety: 'pure',
    description: 'Text → vector embedder.'
  },
  {
    name: 'EnhancedEmbeddingService',
    requirements: ['config'],
    optional: [],
    arity: 1,
    safety: 'pure',
    description: 'EmbeddingService with caching and provider fallback.'
  },
  {
    name: 'ExplainableRecall',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend'],
    arity: 3,
    safety: 'pure',
    description: 'Recall with feature attributions.'
  },
  {
    name: 'HNSWIndex',
    requirements: ['database'],
    optional: ['config'],
    arity: 2,
    safety: 'opens-resource',
    description: 'On-disk HNSW vector index.'
  },
  {
    name: 'LearningSystem',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'config'],
    arity: 4,
    safety: 'pure',
    description: 'Online learning consolidator.'
  },
  {
    name: 'MMRDiversityRanker',
    requirements: [],
    optional: ['config'],
    arity: 1,
    safety: 'pure',
    description: 'MMR diversity reranker.'
  },
  {
    name: 'MemoryController',
    requirements: [],
    optional: ['vectorBackend', 'config'],
    arity: 2,
    safety: 'pure',
    description: 'High-level memory orchestration.'
  },
  {
    name: 'MetadataFilter',
    requirements: [],
    optional: [],
    arity: 0,
    safety: 'pure',
    description: 'Pure utility for metadata predicates.'
  },
  {
    name: 'NightlyLearner',
    requirements: ['database', 'embedder'],
    optional: ['config'],
    arity: 3,
    safety: 'pure',
    description: 'Background consolidation pipeline.'
  },
  {
    name: 'QUICClient',
    requirements: ['config', 'networkEndpoint'],
    optional: [],
    arity: 1,
    safety: 'opens-network',
    description: 'QUIC sync client.'
  },
  {
    name: 'QUICServer',
    requirements: ['config'],
    optional: [],
    arity: 1,
    safety: 'opens-network',
    description: 'QUIC sync server.'
  },
  {
    name: 'ReasoningBank',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'graphBackend', 'config'],
    arity: 5,
    safety: 'pure',
    description: 'Reasoning memory facade.'
  },
  {
    name: 'ReflexionMemory',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'learningBackend', 'graphBackend'],
    arity: 5,
    safety: 'pure',
    description: 'Episodic replay memory.'
  },
  {
    name: 'SkillLibrary',
    requirements: ['database', 'embedder'],
    optional: ['vectorBackend', 'graphBackend', 'config'],
    arity: 5,
    safety: 'pure',
    description: 'Reusable skill registry.'
  },
  {
    name: 'SyncCoordinator',
    requirements: ['config'],
    optional: ['networkEndpoint'],
    arity: 1,
    safety: 'opens-network',
    description: 'Multi-peer QUIC sync coordinator.'
  },
  {
    name: 'WASMVectorSearch',
    requirements: ['wasm'],
    optional: ['config'],
    arity: 1,
    safety: 'opens-resource',
    description: 'Pure-WASM vector search index.'
  }
]);

export const noArgControllers: readonly ControllerPrerequisite[] = Object.freeze(
  controllerPrerequisites.filter(c => c.requirements.length === 0)
);

export function getControllerPrerequisite(name: string): ControllerPrerequisite | null {
  return controllerPrerequisites.find(c => c.name === name) ?? null;
}

export function filterBySafety(
  safety: readonly ControllerSafety[]
): readonly ControllerPrerequisite[] {
  return controllerPrerequisites.filter(c => safety.includes(c.safety));
}
