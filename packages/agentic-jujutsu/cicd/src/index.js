/**
 * CI/CD Module for agentic-jujutsu
 *
 * Provides intelligent CI/CD orchestration with:
 * - Vector database learning and optimization
 * - ReasoningBank pattern recognition
 * - Multiple coordination topologies (sequential, mesh, hierarchical, adaptive, gossip)
 * - AST-based code analysis (optional, 352x faster than LLM)
 * - Quantum-resistant coordination
 *
 * @module @agentic-jujutsu/cicd
 */

// Core components
const { CICDVectorDB } = require('./vectordb');
const { WorkflowOrchestrator } = require('./orchestrator');
const { EnhancedOrchestrator } = require('./enhanced-orchestrator');

// Topology components
const TopologyManager = require('./topology-manager');
const SequentialTopology = require('./topologies/sequential');
const MeshTopology = require('./topologies/mesh');
const HierarchicalTopology = require('./topologies/hierarchical');
const AdaptiveTopology = require('./topologies/adaptive');
const GossipTopology = require('./topologies/gossip');

// Optional AST analyzer
const ASTAnalyzer = require('./ast-analyzer');

module.exports = {
  // Core (existing)
  CICDVectorDB,
  WorkflowOrchestrator,

  // Enhanced (new)
  EnhancedOrchestrator,

  // Topology management
  TopologyManager,

  // Individual topologies (for direct access)
  SequentialTopology,
  MeshTopology,
  HierarchicalTopology,
  AdaptiveTopology,
  GossipTopology,

  // Grouped topologies (for organized access)
  topologies: {
    SequentialTopology,
    MeshTopology,
    HierarchicalTopology,
    AdaptiveTopology,
    GossipTopology
  },

  // Optional features
  ASTAnalyzer
};
