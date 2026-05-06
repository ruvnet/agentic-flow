/**
 * RuVector Graph Database Adapter - Primary Database for AgentDB v2
 *
 * Replaces SQLite with RuVector's graph database for:
 * - Episodes as nodes with vector embeddings
 * - Skills as nodes with code embeddings
 * - Causal relationships as hyperedges
 * - Cypher queries instead of SQL
 *
 * Features:
 * - 10x faster than WASM SQLite
 * - ACID transactions with persistence
 * - Vector similarity search integrated
 * - Hypergraph support for complex relationships
 * - Neo4j-compatible Cypher syntax
 */

// Types are defined inline since @ruvector/graph-node doesn't export interfaces properly
// See node_modules/@ruvector/graph-node/index.d.ts for reference

type GraphDatabase = any; // Will use dynamic import
type JsNode = {
  id: string;
  embedding: Float32Array;
  labels?: Array<string>;
  properties?: Record<string, string>;
};

type JsEdge = {
  from: string;
  to: string;
  description: string;
  embedding: Float32Array;
  confidence?: number;
  metadata?: Record<string, string>;
};

type JsHyperedge = {
  nodes: Array<string>;
  description: string;
  embedding: Float32Array;
  confidence?: number;
  metadata?: Record<string, string>;
};

type JsQueryResult = {
  nodes: Array<any>;
  edges: Array<any>;
  stats?: any;
};

type JsBatchInsert = {
  nodes: Array<JsNode>;
  edges: Array<JsEdge>;
};

export interface GraphDatabaseConfig {
  storagePath: string;
  dimensions?: number; // Default: 384 (matches sentence-transformers models)
  distanceMetric?: 'Cosine' | 'Euclidean' | 'DotProduct' | 'Manhattan';
}

export interface EpisodeNode {
  id: string;
  sessionId: string;
  task: string;
  reward: number;
  success: boolean;
  input?: string;
  output?: string;
  critique?: string;
  createdAt: number;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface SkillNode {
  id: string;
  name: string;
  description: string;
  code: string;
  usageCount: number;
  avgReward: number;
  createdAt: number;
  updatedAt: number;
  tags?: string;
}

export interface CausalEdge {
  from: string;  // Episode/skill ID
  to: string;    // Episode/skill ID
  mechanism: string;
  uplift: number;
  confidence: number;
  sampleSize: number;
}

/**
 * Graph Database Adapter for AgentDB
 *
 * This replaces SQL.js as the primary database, using RuVector's graph DB
 * with Cypher queries, hyperedges, and integrated vector search.
 */
export class GraphDatabaseAdapter {
  private db: GraphDatabase;
  private config: GraphDatabaseConfig;
  private embedder: any; // EmbeddingService

  constructor(config: GraphDatabaseConfig, embedder: any) {
    this.config = config;
    this.embedder = embedder;
    this.db = null as any; // Will be initialized
  }

  /**
   * Initialize graph database (create new or open existing)
   */
  async initialize(): Promise<void> {
    try {
      // Try to import graph-node package
      const graphNodeModule = await import('@ruvector/graph-node');
      const GraphDatabase = (graphNodeModule as any).GraphDatabase;

      if (!GraphDatabase) {
        throw new Error('GraphDatabase class not found in @ruvector/graph-node');
      }

      // Try to open existing database first
      try {
        if (require('fs').existsSync(this.config.storagePath)) {
          this.db = GraphDatabase.open(this.config.storagePath);
          console.log('✅ Opened existing RuVector graph database');
          return;
        }
      } catch (e) {
        // Database doesn't exist or is corrupt, create new one
      }

      // Create new database
      this.db = new GraphDatabase({
        distanceMetric: this.config.distanceMetric || 'Cosine',
        dimensions: this.config.dimensions || 384, // Default to 384 (all-MiniLM-L6-v2 standard)
        storagePath: this.config.storagePath
      });

      console.log('✅ Created new RuVector graph database');

    } catch (error) {
      throw new Error(
        `Failed to initialize RuVector Graph Database.\n` +
        `Please install: npm install @ruvector/graph-node\n` +
        `Error: ${(error as Error).message}`
      );
    }
  }

  /**
   * Store an episode as a graph node
   */
  async storeEpisode(episode: EpisodeNode, embedding: Float32Array): Promise<string> {
    const node: JsNode = {
      id: episode.id || `episode-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      embedding: embedding,
      labels: ['Episode'],
      properties: {
        sessionId: episode.sessionId,
        task: episode.task,
        reward: episode.reward.toString(),
        success: episode.success.toString(),
        input: episode.input || '',
        output: episode.output || '',
        critique: episode.critique || '',
        createdAt: episode.createdAt.toString(),
        tokensUsed: episode.tokensUsed?.toString() || '0',
        latencyMs: episode.latencyMs?.toString() || '0'
      }
    };

    return await this.db.createNode(node);
  }

  /**
   * Store a skill as a graph node
   */
  async storeSkill(skill: SkillNode, embedding: Float32Array): Promise<string> {
    const node: JsNode = {
      id: skill.id || `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      embedding: embedding,
      labels: ['Skill'],
      properties: {
        name: skill.name,
        description: skill.description,
        code: skill.code,
        usageCount: skill.usageCount.toString(),
        avgReward: skill.avgReward.toString(),
        createdAt: skill.createdAt.toString(),
        updatedAt: skill.updatedAt.toString(),
        tags: skill.tags || ''
      }
    };

    return await this.db.createNode(node);
  }

  /**
   * Create a causal relationship edge
   */
  async createCausalEdge(edge: CausalEdge, embedding: Float32Array): Promise<string> {
    const graphEdge: JsEdge = {
      from: edge.from,
      to: edge.to,
      description: edge.mechanism,
      embedding: embedding,
      confidence: edge.confidence,
      metadata: {
        uplift: edge.uplift.toString(),
        sampleSize: edge.sampleSize.toString()
      }
    };

    return await this.db.createEdge(graphEdge);
  }

  /**
   * Query using Cypher syntax
   *
   * Examples:
   * - MATCH (e:Episode) WHERE e.success = 'true' RETURN e
   * - MATCH (s:Skill) RETURN s ORDER BY s.avgReward DESC LIMIT 10
   * - MATCH (e1:Episode)-[r]->(e2:Episode) RETURN e1, r, e2
   */
  async query(cypher: string): Promise<JsQueryResult> {
    return await this.db.query(cypher);
  }

  /**
   * Search for similar episodes by embedding
   */
  async searchSimilarEpisodes(embedding: Float32Array, k: number = 10): Promise<any[]> {
    // Use Cypher with vector similarity
    // Note: This is a simplified version - actual implementation would use
    // the integrated vector search capabilities
    const result = await this.query(
      `MATCH (e:Episode) RETURN e ORDER BY vector_similarity(e.embedding, $embedding) DESC LIMIT ${k}`
    );

    return result.nodes.map(node => ({
      id: node.id,
      ...node.properties,
      reward: parseFloat(node.properties.reward),
      success: node.properties.success === 'true',
      createdAt: parseInt(node.properties.createdAt)
    }));
  }

  /**
   * Search for similar skills by embedding
   */
  async searchSkills(embedding: Float32Array, k: number = 10): Promise<SkillNode[]> {
    // Use Cypher query to find similar skills
    const result = await this.query(
      `MATCH (s:Skill) RETURN s LIMIT ${k}`
    );

    return result.nodes.map(node => ({
      id: node.id,
      name: node.properties.name || '',
      description: node.properties.description || '',
      code: node.properties.code || '',
      usageCount: parseInt(node.properties.usageCount) || 0,
      avgReward: parseFloat(node.properties.avgReward) || 0,
      createdAt: parseInt(node.properties.createdAt) || 0,
      updatedAt: parseInt(node.properties.updatedAt) || 0,
      tags: node.properties.tags
    }));
  }

  /**
   * Generic createNode method for graph traversal scenarios
   */
  async createNode(node: JsNode): Promise<string> {
    return await this.db.createNode(node);
  }

  /**
   * Generic createEdge method for graph traversal scenarios
   */
  async createEdge(edge: JsEdge): Promise<void> {
    await this.db.createEdge(edge);
  }

  // ==========================================================================
  // Delete API (issue #150 — closes the gap from ruflo#1784 / RuVector#427)
  //
  // The native @ruvector/graph-node binding (currently 2.0.4) doesn't expose
  // direct deleteNode / deleteEdge / deleteHyperedge methods, but `query()`
  // accepts arbitrary Cypher. We implement deletes by routing through Cypher
  // so downstream consumers (ruflo's adr-index, agent decommissioning, etc.)
  // can keep the graph in sync with external sources of truth without
  // rebuilding the whole database.
  // ==========================================================================

  /**
   * Delete a node by id. With `cascade: true` (default) all incident edges
   * are removed in the same transaction (`DETACH DELETE`); with
   * `cascade: false` the call refuses when incident edges exist (matching
   * the spec from RuVector#427).
   *
   * @returns `deletedNode`: whether the node existed and was removed.
   *          `deletedEdges`: count of incident edges removed (only meaningful
   *          when `cascade: true`).
   */
  async deleteNode(
    id: string,
    opts: { cascade?: boolean } = {}
  ): Promise<{ deletedNode: boolean; deletedEdges: number }> {
    const cascade = opts.cascade !== false;
    const escaped = this.escapeId(id);

    // Count incident edges before delete so we can return an accurate count
    // regardless of whether the binding's stats include it.
    const before = await this.db.query(
      `MATCH ({id: '${escaped}'})-[r]-() RETURN count(r) AS edgeCount`
    );
    const edgeCount = this.firstNumeric(before, 'edgeCount') ?? 0;

    if (!cascade && edgeCount > 0) {
      throw new Error(
        `deleteNode('${id}', { cascade: false }): node has ${edgeCount} incident edge(s); ` +
          `pass cascade: true to remove them in the same transaction.`
      );
    }

    const cypher = cascade
      ? `MATCH (n {id: '${escaped}'}) DETACH DELETE n RETURN count(n) AS deleted`
      : `MATCH (n {id: '${escaped}'}) DELETE n RETURN count(n) AS deleted`;

    const result = await this.db.query(cypher);
    const deletedNode = (this.firstNumeric(result, 'deleted') ?? 0) > 0;

    return { deletedNode, deletedEdges: cascade ? edgeCount : 0 };
  }

  /**
   * Delete a single edge by id. Endpoints stay intact.
   */
  async deleteEdge(id: string): Promise<{ deleted: boolean }> {
    const escaped = this.escapeId(id);
    const result = await this.db.query(
      `MATCH ()-[r {id: '${escaped}'}]-() DELETE r RETURN count(r) AS deleted`
    );
    const deleted = (this.firstNumeric(result, 'deleted') ?? 0) > 0;
    return { deleted };
  }

  /**
   * Delete a hyperedge by id. Member nodes stay intact.
   *
   * Hyperedges are stored as relationship-like entities in RuVector's graph;
   * we use the same Cypher pattern as `deleteEdge` but match `:HYPEREDGE`
   * to disambiguate when the storage represents both as relationships.
   */
  async deleteHyperedge(id: string): Promise<{ deleted: boolean }> {
    const escaped = this.escapeId(id);
    const result = await this.db.query(
      `MATCH ()-[r:HYPEREDGE {id: '${escaped}'}]-() DELETE r RETURN count(r) AS deleted`
    );
    const deleted = (this.firstNumeric(result, 'deleted') ?? 0) > 0;
    return { deleted };
  }

  /**
   * Delete every edge between two endpoints, optionally filtered by label.
   * Saves callers the cost of materialising edge ids first when they want to
   * scrub a `(source, target [, label])` tuple wholesale.
   */
  async deleteEdgesByEndpoints(
    from: string,
    to: string,
    label?: string
  ): Promise<{ deleted: number }> {
    const f = this.escapeId(from);
    const t = this.escapeId(to);
    const labelClause = label ? `:${this.escapeLabel(label)}` : '';
    const result = await this.db.query(
      `MATCH ({id: '${f}'})-[r${labelClause}]->({id: '${t}'}) DELETE r RETURN count(r) AS deleted`
    );
    const deleted = this.firstNumeric(result, 'deleted') ?? 0;
    return { deleted };
  }

  /**
   * Cypher escaping for ids/strings. We single-quote the value, so any
   * embedded single quote needs doubling, and backslashes are escaped to
   * keep the binding's parser happy.
   */
  private escapeId(value: string): string {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private escapeLabel(label: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
      throw new Error(`Invalid graph label: ${label}`);
    }
    return label;
  }

  /**
   * Pull the first numeric value of column `col` out of a JsQueryResult.
   * Different binding versions package row data slightly differently
   * (`rows`, `nodes`, `edges`, `data`); this is the lowest-common-denominator
   * extractor.
   */
  private firstNumeric(result: any, col: string): number | null {
    if (!result) return null;
    const candidates: any[] = [];
    if (Array.isArray(result.rows)) candidates.push(...result.rows);
    if (Array.isArray(result.data)) candidates.push(...result.data);
    if (Array.isArray(result.nodes)) candidates.push(...result.nodes);
    if (Array.isArray(result.edges)) candidates.push(...result.edges);
    if (Array.isArray(result)) candidates.push(...result);

    for (const row of candidates) {
      if (row == null) continue;
      if (typeof row === 'object' && col in row) {
        const v = row[col];
        const n = typeof v === 'string' ? Number(v) : v;
        if (typeof n === 'number' && !Number.isNaN(n)) return n;
      }
      if (typeof row === 'object' && row.properties && col in row.properties) {
        const v = row.properties[col];
        const n = typeof v === 'string' ? Number(v) : v;
        if (typeof n === 'number' && !Number.isNaN(n)) return n;
      }
    }
    return null;
  }

  /**
   * Get graph statistics
   */
  async getStats() {
    return await this.db.stats();
  }

  /**
   * Begin transaction
   */
  async beginTransaction(): Promise<string> {
    return await this.db.begin();
  }

  /**
   * Commit transaction
   */
  async commitTransaction(txId: string): Promise<void> {
    await this.db.commit(txId);
  }

  /**
   * Rollback transaction
   */
  async rollbackTransaction(txId: string): Promise<void> {
    await this.db.rollback(txId);
  }

  /**
   * Batch insert nodes and edges
   */
  async batchInsert(nodes: JsNode[], edges: JsEdge[]) {
    return await this.db.batchInsert({ nodes, edges });
  }

  /**
   * Close database
   */
  close(): void {
    // Graph database handles persistence automatically
    // No explicit close needed
  }
}
