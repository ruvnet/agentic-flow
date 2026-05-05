/**
 * AgentDB Controllers - State-of-the-Art Memory Systems
 *
 * Export all memory controllers for agent systems
 */

export { ReflexionMemory } from './ReflexionMemory.js';
export { SkillLibrary } from './SkillLibrary.js';
export { EmbeddingService } from './EmbeddingService.js';
export { WASMVectorSearch } from './WASMVectorSearch.js';
export { HNSWIndex } from './HNSWIndex.js';
export { EnhancedEmbeddingService } from './EnhancedEmbeddingService.js';
export { MMRDiversityRanker } from './MMRDiversityRanker.js';
export { ContextSynthesizer } from './ContextSynthesizer.js';
export { MetadataFilter } from './MetadataFilter.js';
export { QUICServer } from './QUICServer.js';
export { QUICClient } from './QUICClient.js';
export { SyncCoordinator } from './SyncCoordinator.js';
export { AttentionService } from './AttentionService.js';

// Memory Controller with Attention Integration
export { MemoryController } from './MemoryController.js';

// Attention Controllers
export { SelfAttentionController } from './attention/SelfAttentionController.js';
export { CrossAttentionController } from './attention/CrossAttentionController.js';
export { MultiHeadAttentionController } from './attention/MultiHeadAttentionController.js';

export type { Episode, EpisodeWithEmbedding, ReflexionQuery } from './ReflexionMemory.js';
export type { Skill, SkillLink, SkillQuery } from './SkillLibrary.js';
export type { EmbeddingConfig } from './EmbeddingService.js';
export type { VectorSearchConfig, VectorSearchResult, VectorIndex } from './WASMVectorSearch.js';
export type { HNSWConfig, HNSWSearchResult, HNSWStats } from './HNSWIndex.js';
export type { EnhancedEmbeddingConfig } from './EnhancedEmbeddingService.js';
export type { MMROptions, MMRCandidate } from './MMRDiversityRanker.js';
export type { MemoryPattern, SynthesizedContext } from './ContextSynthesizer.js';
export type { MetadataFilters, FilterableItem, FilterOperator, FilterValue } from './MetadataFilter.js';
export type { QUICServerConfig, SyncRequest, SyncResponse } from './QUICServer.js';
export type { QUICClientConfig, SyncOptions, SyncResult, SyncProgress } from './QUICClient.js';
export type { SyncCoordinatorConfig, SyncState, SyncReport } from './SyncCoordinator.js';
export type { AttentionConfig, AttentionResult, AttentionStats } from './AttentionService.js';

// MemoryController types
export type {
  MemoryControllerConfig,
  Memory,
  SearchOptions,
  SearchResult,
  AttentionRetrievalResult
} from './MemoryController.js';

// Attention Controller types
export type {
  SelfAttentionConfig,
  AttentionScore,
  SelfAttentionResult,
  SelfAttentionMemoryEntry
} from './attention/index.js';

export type {
  CrossAttentionConfig,
  CrossAttentionScore,
  CrossAttentionResult,
  ContextEntry
} from './attention/index.js';

export type {
  MultiHeadAttentionConfig,
  HeadAttentionOutput,
  MultiHeadAttentionResult,
  MultiHeadMemoryEntry
} from './attention/index.js';

// Controller activation registry (issue #146 Gap 2)
export {
  controllerPrerequisites,
  noArgControllers,
  getControllerPrerequisite,
  filterBySafety
} from './prerequisites.js';
export type {
  ControllerPrerequisite,
  ControllerRequirement,
  ControllerSafety
} from './prerequisites.js';
