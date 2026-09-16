/**
 * Metrics Types for Bridge Performance Tracking
 *
 * Detailed metric definitions for monitoring bridge performance
 */

/**
 * AgentBooster specific metrics
 */
export interface AgentBoosterMetrics {
  /** Edit operation latency in milliseconds */
  editLatencyMs: number;
  /** AST parsing latency in milliseconds */
  parseLatencyMs: number;
  /** Batch edit latency in milliseconds */
  batchEditLatencyMs: number;
  /** Number of files processed */
  filesProcessed: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Lines of code processed */
  linesProcessed: number;
}

/**
 * ReasoningBank specific metrics
 */
export interface ReasoningBankMetrics {
  /** Trajectory storage latency in milliseconds */
  storeLatencyMs: number;
  /** Query latency in milliseconds */
  queryLatencyMs: number;
  /** Learning iteration latency in milliseconds */
  learnLatencyMs: number;
  /** Number of trajectories stored */
  trajectoriesStored: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Active RL algorithm */
  algorithm: string;
}

/**
 * AgentDB specific metrics
 */
export interface AgentDBMetrics {
  /** Vector insertion latency in milliseconds */
  insertLatencyMs: number;
  /** Vector search latency in milliseconds */
  searchLatencyMs: number;
  /** Pattern storage latency in milliseconds */
  patternStoreLatencyMs: number;
  /** Number of vectors indexed */
  vectorsIndexed: number;
  /** Search results count */
  resultsFound: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Database size in MB */
  dbSizeMb: number;
}

/**
 * QUIC specific metrics
 */
export interface QuicMetrics {
  /** Connection establishment latency in milliseconds */
  connectLatencyMs: number;
  /** Send operation latency in milliseconds */
  sendLatencyMs: number;
  /** Receive operation latency in milliseconds */
  receiveLatencyMs: number;
  /** Stream creation latency in milliseconds */
  streamLatencyMs: number;
  /** Bytes sent */
  bytesSent: number;
  /** Bytes received */
  bytesReceived: number;
  /** Active connections count */
  activeConnections: number;
  /** Success rate (0-1) */
  successRate: number;
}

/**
 * Aggregated metrics across all bridges
 */
export interface AggregatedMetrics {
  /** Total operations performed */
  totalOperations: number;
  /** Average latency across all operations */
  averageLatencyMs: number;
  /** Peak latency */
  peakLatencyMs: number;
  /** Overall success rate (0-1) */
  overallSuccessRate: number;
  /** Metrics per bridge */
  perBridge: {
    agentBooster?: AgentBoosterMetrics;
    reasoningBank?: ReasoningBankMetrics;
    agentDB?: AgentDBMetrics;
    quic?: QuicMetrics;
  };
  /** Timestamp of metrics collection */
  timestamp: number;
}

/**
 * Performance target thresholds
 */
export const PERFORMANCE_TARGETS = {
  AGENT_BOOSTER_MAX_LATENCY_MS: 5,
  REASONING_BANK_MAX_QUERY_MS: 100,
  AGENT_DB_MAX_SEARCH_MS: 50,
  QUIC_MAX_SEND_MS: 10,
  MIN_SUCCESS_RATE: 0.95,
} as const;
