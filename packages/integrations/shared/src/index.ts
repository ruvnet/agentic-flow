/**
 * Agentic Flow Integrations - Shared Bridges Package
 *
 * TypeScript bridges connecting agent-booster, reasoningbank, agentdb, and QUIC
 * for seamless integration in agentic-flow patterns
 *
 * Performance Targets:
 * - AgentBooster: <5ms overhead
 * - ReasoningBank: <100ms query
 * - AgentDB: <50ms search
 * - QUIC: <10ms send
 */

// Export all bridges
export * from './bridges/index.js';

// Export all types
export * from './types/index.js';

// Export all utilities
export * from './utils/index.js';

// Version
export const VERSION = '1.0.0';
