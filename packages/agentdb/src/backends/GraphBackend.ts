/**
 * GraphBackend Interface - Graph database capabilities (Optional)
 *
 * Provides property graph storage and Cypher-like query capabilities.
 * Available when @ruvector/graph-node is installed.
 *
 * Features:
 * - Node and relationship management
 * - Cypher query execution
 * - Graph traversal and pattern matching
 * - Integration with vector search
 */

/**
 * Graph node representation
 */
export interface GraphNode {
  /** Unique node identifier */
  id: string;

  /** Node labels (types) */
  labels: string[];

  /** Node properties */
  properties: Record<string, any>;

  /** Optional vector embedding for hybrid search */
  embedding?: Float32Array;
}

/**
 * Graph relationship representation
 */
export interface GraphRelationship {
  /** Unique relationship identifier */
  id: string;

  /** Source node ID */
  from: string;

  /** Target node ID */
  to: string;

  /** Relationship type */
  type: string;

  /** Relationship properties */
  properties?: Record<string, any>;
}

/**
 * Cypher query result
 */
export interface QueryResult {
  /** Result rows */
  rows: Record<string, any>[];

  /** Result columns */
  columns: string[];

  /** Number of rows returned */
  count: number;

  /** Query execution time in milliseconds */
  executionTime: number;
}

/**
 * Graph traversal options
 */
export interface TraversalOptions {
  /** Maximum traversal depth */
  maxDepth?: number;

  /** Relationship types to follow (empty = all) */
  relationshipTypes?: string[];

  /** Node label filter */
  nodeLabels?: string[];

  /** Direction: 'outgoing', 'incoming', 'both' */
  direction?: 'outgoing' | 'incoming' | 'both';
}

/**
 * Graph statistics
 */
export interface GraphStats {
  /** Total number of nodes */
  nodeCount: number;

  /** Total number of relationships */
  relationshipCount: number;

  /** Node label distribution */
  nodeLabelCounts: Record<string, number>;

  /** Relationship type distribution */
  relationshipTypeCounts: Record<string, number>;

  /** Estimated memory usage in bytes */
  memoryUsage: number;
}

/**
 * GraphBackend - Optional graph database interface
 *
 * Implementations:
 * - RuVectorGraph: Native Rust graph with @ruvector/graph-node
 * - MockGraphBackend: No-op implementation for testing
 */
export interface GraphBackend {
  /**
   * Initialize the graph backend and underlying engine
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<void>;

  // ============================================================================
  // Cypher Execution
  // ============================================================================

  /**
   * Execute a Cypher query
   *
   * @param cypher - Cypher query string
   * @param params - Query parameters
   * @returns Query result with rows and metadata
   */
  execute(cypher: string, params?: Record<string, any>): Promise<QueryResult>;

  // ============================================================================
  // Node Operations
  // ============================================================================

  /**
   * Create a new node
   *
   * @param labels - Node labels (types)
   * @param properties - Node properties
   * @returns Created node ID
   */
  createNode(labels: string[], properties: Record<string, any>): Promise<string>;

  /**
   * Get a node by ID
   *
   * @param id - Node identifier
   * @returns Node or null if not found
   */
  getNode(id: string): Promise<GraphNode | null>;

  /**
   * Update node properties
   *
   * @param id - Node identifier
   * @param properties - Properties to update
   * @returns True if updated, false if not found
   */
  updateNode(id: string, properties: Record<string, any>): Promise<boolean>;

  /**
   * Delete a node and its relationships
   *
   * @param id - Node identifier
   * @returns True if deleted, false if not found
   */
  deleteNode(id: string): Promise<boolean>;

  // ============================================================================
  // Relationship Operations
  // ============================================================================

  /**
   * Create a relationship between nodes
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @param type - Relationship type
   * @param properties - Optional relationship properties
   * @returns Created relationship ID
   */
  createRelationship(
    from: string,
    to: string,
    type: string,
    properties?: Record<string, any>
  ): Promise<string>;

  /**
   * Get a relationship by ID
   *
   * @param id - Relationship identifier
   * @returns Relationship or null if not found
   */
  getRelationship(id: string): Promise<GraphRelationship | null>;

  /**
   * Delete a relationship
   *
   * @param id - Relationship identifier
   * @returns True if deleted, false if not found
   */
  deleteRelationship(id: string): Promise<boolean>;

  // ============================================================================
  // Traversal
  // ============================================================================

  /**
   * Traverse the graph from a starting node
   *
   * @param startId - Starting node ID
   * @param pattern - Traversal pattern (e.g., "()-[:RELATES_TO]->(:Entity)")
   * @param options - Traversal options
   * @returns Array of nodes found during traversal
   */
  traverse(
    startId: string,
    pattern: string,
    options?: TraversalOptions
  ): Promise<GraphNode[]>;

  /**
   * Find shortest path between two nodes
   *
   * @param fromId - Source node ID
   * @param toId - Target node ID
   * @param options - Traversal options
   * @returns Array of nodes representing the path, or empty if no path exists
   */
  shortestPath(
    fromId: string,
    toId: string,
    options?: TraversalOptions
  ): Promise<GraphNode[]>;

  // ============================================================================
  // Hybrid Operations (Graph + Vector)
  // ============================================================================

  /**
   * Find nodes similar to a query vector within a graph context
   *
   * Combines vector similarity search with graph structure
   *
   * @param query - Query vector
   * @param k - Number of results
   * @param contextNodeId - Optional context node for graph-based filtering
   * @returns Array of nodes sorted by similarity
   */
  vectorSearch(
    query: Float32Array,
    k: number,
    contextNodeId?: string
  ): Promise<GraphNode[]>;

  // ============================================================================
  // Stats
  // ============================================================================

  /**
   * Get graph statistics
   *
   * @returns Current statistics of the graph
   */
  getStats(): GraphStats;

  /**
   * Clear the entire graph
   */
  clear(): Promise<void>;
}

/**
 * Type guard to check if an object implements GraphBackend
 */
export function isGraphBackend(obj: any): obj is GraphBackend {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.execute === 'function' &&
    typeof obj.createNode === 'function' &&
    typeof obj.getNode === 'function' &&
    typeof obj.updateNode === 'function' &&
    typeof obj.deleteNode === 'function' &&
    typeof obj.createRelationship === 'function' &&
    typeof obj.getRelationship === 'function' &&
    typeof obj.deleteRelationship === 'function' &&
    typeof obj.traverse === 'function' &&
    typeof obj.shortestPath === 'function' &&
    typeof obj.vectorSearch === 'function' &&
    typeof obj.getStats === 'function' &&
    typeof obj.clear === 'function'
  );
}
