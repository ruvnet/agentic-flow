/**
 * SONA Agent Training Service
 *
 * Train specialized models for specific agents, tasks, and codebases
 * Uses @ruvector/sona for continuous learning and adaptation
 */

import { EventEmitter } from 'events';
import { requireSonaEngine } from './sona-loader.js';

export interface AgentConfig {
  name: string;
  purpose: 'simple' | 'complex' | 'diverse';
  hiddenDim?: number;
  microLoraRank?: number;
  microLoraLr?: number;
  baseLoraRank?: number;
  patternClusters?: number;
  trajectoryCapacity?: number;
  qualityThreshold?: number;
  ewcLambda?: number;
  route?: string;
}

export interface TrainingExample {
  embedding: number[];
  prompt?: string;
  output?: string;
  hiddenStates?: number[];
  attention?: number[];
  quality: number;
  context?: Record<string, any>;
}

export interface CodebaseFile {
  path: string;
  language: string;
  content: string;
  chunks?: Array<{
    code: string;
    type: 'function' | 'class' | 'interface' | 'module';
    embedding?: number[];
  }>;
}

export interface AgentStats {
  name: string;
  purpose: string;
  trainingCount: number;
  avgQuality: number;
  patterns: number;
  lastTrained?: Date;
  config: any;
}

/**
 * SONA Agent Factory - Create and manage specialized agents
 */
export class AgentFactory extends EventEmitter {
  private agents: Map<string, {
    engine: any;
    config: AgentConfig;
    trainingCount: number;
    totalQuality: number;
    lastTrained?: Date;
  }>;

  private baseConfig: Partial<AgentConfig>;

  constructor(baseConfig: Partial<AgentConfig> = {}) {
    super();
    this.baseConfig = {
      hiddenDim: 3072,
      microLoraRank: 2,
      microLoraLr: 0.002,
      ewcLambda: 2000,
      ...baseConfig
    };
    this.agents = new Map();
  }

  /**
   * Create a new specialized agent
   */
  createAgent(name: string, config: Partial<AgentConfig> = {}): any {
    const purpose = config.purpose || 'simple';

    // Customize config based on purpose
    const agentConfig: AgentConfig = {
      name,
      purpose,
      ...this.baseConfig,
      ...config,
      // Purpose-specific defaults
      baseLoraRank: purpose === 'complex' ? 16 : purpose === 'diverse' ? 12 : 8,
      patternClusters: purpose === 'diverse' ? 200 : purpose === 'complex' ? 100 : 50,
      trajectoryCapacity: purpose === 'complex' ? 10000 : 5000,
      qualityThreshold: purpose === 'complex' ? 0.2 : 0.3,
    };

    // Create SONA engine
    const engine = requireSonaEngine().withConfig({
      hiddenDim: agentConfig.hiddenDim!,
      microLoraRank: agentConfig.microLoraRank!,
      baseLoraRank: agentConfig.baseLoraRank!,
      microLoraLr: 0.002,
      patternClusters: agentConfig.patternClusters!,
      trajectoryCapacity: agentConfig.trajectoryCapacity!,
      qualityThreshold: agentConfig.qualityThreshold!,
      ewcLambda: agentConfig.ewcLambda!,
      enableSimd: true
    });

    this.agents.set(name, {
      engine,
      config: agentConfig,
      trainingCount: 0,
      totalQuality: 0
    });

    this.emit('agent:created', { name, config: agentConfig });
    return engine;
  }

  /**
   * Train an agent on specific examples
   */
  async trainAgent(name: string, examples: TrainingExample[]): Promise<number> {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent "${name}" not found. Create it first with createAgent()`);
    }

    let successCount = 0;

    for (const example of examples) {
      try {
        const tid = agent.engine.beginTrajectory(example.embedding);

        // Set route (agent name)
        agent.engine.setTrajectoryRoute(tid, name);

        // Add context
        if (example.context) {
          for (const [key, value] of Object.entries(example.context)) {
            agent.engine.addTrajectoryContext(tid, `${key}:${value}`);
          }
        }

        // Add trajectory step with hidden states and attention
        if (example.hiddenStates && example.attention) {
          agent.engine.addTrajectoryStep(
            tid,
            example.hiddenStates,
            example.attention,
            example.quality
          );
        }

        // End trajectory
        agent.engine.endTrajectory(tid, example.quality);

        agent.trainingCount++;
        agent.totalQuality += example.quality;
        successCount++;

      } catch (error: any) {
        this.emit('training:error', { name, error: error.message, example });
      }
    }

    // Force learning to update LoRA weights
    agent.engine.forceLearn();
    agent.lastTrained = new Date();

    this.emit('agent:trained', {
      name,
      examplesProcessed: successCount,
      totalTraining: agent.trainingCount,
      avgQuality: agent.totalQuality / agent.trainingCount
    });

    return successCount;
  }

  /**
   * Get an agent's engine for inference
   */
  getAgent(name: string): any {
    return this.agents.get(name)?.engine;
  }

  /**
   * Get agent statistics
   */
  getAgentStats(name: string): AgentStats | null {
    const agent = this.agents.get(name);
    if (!agent) return null;

    const stats = agent.engine.getStats();

    return {
      name,
      purpose: agent.config.purpose,
      trainingCount: agent.trainingCount,
      avgQuality: agent.trainingCount > 0 ? agent.totalQuality / agent.trainingCount : 0,
      patterns: stats.totalPatterns || 0,
      lastTrained: agent.lastTrained,
      config: agent.config
    };
  }

  /**
   * List all agents
   */
  listAgents(): AgentStats[] {
    return Array.from(this.agents.keys())
      .map(name => this.getAgentStats(name))
      .filter(s => s !== null) as AgentStats[];
  }

  /**
   * Find similar patterns for a query
   */
  async findPatterns(agentName: string, queryEmbedding: number[], k: number = 5): Promise<any[]> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent "${agentName}" not found`);
    }

    return agent.engine.findPatterns(queryEmbedding, k);
  }

  /**
   * Apply agent-specific adaptation to embedding
   */
  async applyAdaptation(agentName: string, embedding: number[]): Promise<number[]> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent "${agentName}" not found`);
    }

    return agent.engine.applyMicroLora(embedding);
  }
}

/**
 * Codebase-Specific Agent Trainer
 */
export class CodebaseTrainer {
  private engine: any;
  private indexed: number = 0;

  constructor(config: Partial<AgentConfig> = {}) {
    this.engine = requireSonaEngine().withConfig({
      hiddenDim: 3072,
      microLoraRank: 2,
      baseLoraRank: 16,
      patternClusters: 200,
      trajectoryCapacity: 10000,
      qualityThreshold: 0.2,
      ewcLambda: 2000,
      enableSimd: true,
      ...config
    });
  }

  /**
   * Index an entire codebase for pattern learning
   */
  async indexCodebase(files: CodebaseFile[]): Promise<number> {
    let totalChunks = 0;

    for (const file of files) {
      if (!file.chunks) {
        file.chunks = this.chunkCode(file.content, file.language);
      }

      for (const chunk of file.chunks) {
        if (!chunk.embedding) {
          // In production, call actual embedding service
          chunk.embedding = this.mockEmbedding(chunk.code);
        }

        const tid = this.engine.beginTrajectory(chunk.embedding);

        // Add rich context
        this.engine.setTrajectoryRoute(tid, file.language);
        this.engine.addTrajectoryContext(tid, file.path);
        this.engine.addTrajectoryContext(tid, chunk.type);

        // High quality for indexed code (0.95)
        this.engine.addTrajectoryStep(tid, chunk.embedding, chunk.embedding, 0.95);
        this.engine.endTrajectory(tid, 0.95);

        totalChunks++;
        this.indexed++;
      }
    }

    // Force learning
    this.engine.forceLearn();

    return totalChunks;
  }

  /**
   * Query with codebase-aware adaptation
   */
  async query(queryText: string, k: number = 5): Promise<{
    adapted: number[];
    relevantPatterns: any[];
  }> {
    const embedding = this.mockEmbedding(queryText);

    // Find relevant patterns from codebase
    const patterns = this.engine.findPatterns(embedding, k);

    // Apply codebase-specific adaptation
    const adapted = this.engine.applyMicroLora(embedding);

    return { adapted, relevantPatterns: patterns };
  }

  /**
   * Get codebase statistics
   */
  getStats() {
    return {
      indexed: this.indexed,
      ...this.engine.getStats()
    };
  }

  /**
   * Chunk code into trainable segments
   */
  private chunkCode(content: string, language: string): Array<{
    code: string;
    type: 'function' | 'class' | 'interface' | 'module';
  }> {
    // Simplified chunking - in production use tree-sitter or similar
    const chunks: any[] = [];

    // Detect functions
    const functionRegex = /(?:function|def|fn)\s+(\w+)/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const start = match.index;
      const end = this.findBlockEnd(content, start);
      chunks.push({
        code: content.slice(start, end),
        type: 'function'
      });
    }

    // Detect classes
    const classRegex = /(?:class|struct|interface)\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
      const start = match.index;
      const end = this.findBlockEnd(content, start);
      chunks.push({
        code: content.slice(start, end),
        type: 'class'
      });
    }

    // If no chunks, treat whole file as module
    if (chunks.length === 0) {
      chunks.push({
        code: content,
        type: 'module'
      });
    }

    return chunks;
  }

  /**
   * Find end of code block (simplified)
   */
  private findBlockEnd(content: string, start: number): number {
    let depth = 0;
    let inBlock = false;

    for (let i = start; i < content.length; i++) {
      if (content[i] === '{') {
        depth++;
        inBlock = true;
      } else if (content[i] === '}') {
        depth--;
        if (inBlock && depth === 0) {
          return i + 1;
        }
      }
    }

    return Math.min(start + 500, content.length);
  }

  /**
   * Mock embedding (replace with actual embedding service in production)
   */
  private mockEmbedding(text: string): number[] {
    const hash = this.hashCode(text);
    const embedding = new Array(3072);

    for (let i = 0; i < 3072; i++) {
      const seed = hash + i;
      embedding[i] = (Math.sin(seed) * 10000) - Math.floor(Math.sin(seed) * 10000);
    }

    return embedding;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}

/**
 * Pre-configured agent templates
 */
export const AgentTemplates = {
  /**
   * Code Assistant - Complex reasoning, code-specific patterns
   */
  codeAssistant: (): AgentConfig => ({
    name: 'code-assistant',
    purpose: 'complex',
    baseLoraRank: 16,
    patternClusters: 200,
    qualityThreshold: 0.2,
    route: 'code-agent'
  }),

  /**
   * Chat Agent - Simple conversational patterns
   */
  chatBot: (): AgentConfig => ({
    name: 'chat-bot',
    purpose: 'simple',
    baseLoraRank: 8,
    patternClusters: 50,
    qualityThreshold: 0.3,
    route: 'chat-agent'
  }),

  /**
   * Data Analyst - Diverse data patterns
   */
  dataAnalyst: (): AgentConfig => ({
    name: 'data-analyst',
    purpose: 'diverse',
    baseLoraRank: 12,
    patternClusters: 150,
    qualityThreshold: 0.25,
    route: 'data-agent'
  }),

  /**
   * RAG Agent - Large capacity for document retrieval
   */
  ragAgent: (): AgentConfig => ({
    name: 'rag-agent',
    purpose: 'diverse',
    baseLoraRank: 12,
    patternClusters: 200,
    trajectoryCapacity: 10000,
    qualityThreshold: 0.2,
    route: 'rag-agent'
  }),

  /**
   * Task Planner - Complex reasoning with strong memory
   */
  taskPlanner: (): AgentConfig => ({
    name: 'task-planner',
    purpose: 'complex',
    baseLoraRank: 16,
    patternClusters: 100,
    ewcLambda: 2500,
    qualityThreshold: 0.2,
    route: 'planner-agent'
  }),

  /**
   * Domain Expert - Learns specific domain
   */
  domainExpert: (domain: string): AgentConfig => ({
    name: `${domain}-expert`,
    purpose: 'complex',
    baseLoraRank: 16,
    patternClusters: 150,
    qualityThreshold: 0.1, // Learn from more examples
    route: `${domain}-agent`
  })
};
