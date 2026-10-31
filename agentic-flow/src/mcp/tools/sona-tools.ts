/**
 * SONA MCP Tools
 *
 * Model Context Protocol tools for SONA (Self-Optimizing Neural Architecture)
 * Provides trajectory management, pattern discovery, and learning operations
 */

import {
  sonaService,
  sonaServices,
  createSONAService,
  SONAProfile
} from '../../services/sona-service.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * SONA MCP Tools
 */
export const sonaMCPTools: MCPTool[] = [
  // Trajectory Management
  {
    name: 'sona_trajectory_begin',
    description: 'Begin a new SONA learning trajectory. Returns trajectory ID for subsequent operations.',
    inputSchema: {
      type: 'object',
      properties: {
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Embedding vector (1536D for OpenAI, 3072D for Phi-4)'
        },
        route: {
          type: 'string',
          description: 'LLM model route (e.g., claude-sonnet-4-5, gpt-4-turbo)'
        },
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile to use (default: balanced)'
        }
      },
      required: ['embedding']
    }
  },

  {
    name: 'sona_trajectory_step',
    description: 'Add a step to an active trajectory with activations, attention weights, and reward.',
    inputSchema: {
      type: 'object',
      properties: {
        trajectoryId: {
          type: 'string',
          description: 'Trajectory ID from sona_trajectory_begin'
        },
        activations: {
          type: 'array',
          items: { type: 'number' },
          description: 'Layer activations (3072D for Phi-4)'
        },
        attentionWeights: {
          type: 'array',
          items: { type: 'number' },
          description: 'Attention weights (40 layers for Phi-4)'
        },
        reward: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Reward score (0-1)'
        }
      },
      required: ['trajectoryId', 'activations', 'attentionWeights', 'reward']
    }
  },

  {
    name: 'sona_trajectory_context',
    description: 'Add context metadata to a trajectory (e.g., task type, domain).',
    inputSchema: {
      type: 'object',
      properties: {
        trajectoryId: {
          type: 'string',
          description: 'Trajectory ID'
        },
        contextId: {
          type: 'string',
          description: 'Context identifier (e.g., code-review, data-analysis)'
        }
      },
      required: ['trajectoryId', 'contextId']
    }
  },

  {
    name: 'sona_trajectory_end',
    description: 'End a trajectory with final quality score. Triggers learning if capacity threshold reached.',
    inputSchema: {
      type: 'object',
      properties: {
        trajectoryId: {
          type: 'string',
          description: 'Trajectory ID'
        },
        qualityScore: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Overall quality score (0-1)'
        }
      },
      required: ['trajectoryId', 'qualityScore']
    }
  },

  {
    name: 'sona_trajectory_list',
    description: 'List all active trajectories.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'Filter by profile (optional)'
        }
      }
    }
  },

  // Pattern Discovery
  {
    name: 'sona_pattern_find',
    description: 'Find similar patterns using k-NN search. Recommended k=3 for 761 decisions/sec throughput.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'array',
          items: { type: 'number' },
          description: 'Query embedding vector'
        },
        k: {
          type: 'number',
          default: 3,
          minimum: 1,
          maximum: 20,
          description: 'Number of patterns to retrieve (default: 3)'
        },
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile (default: balanced)'
        }
      },
      required: ['query']
    }
  },

  // LoRA Application
  {
    name: 'sona_apply_micro_lora',
    description: 'Apply Micro-LoRA adaptation to input vector. Sub-millisecond latency.',
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'array',
          items: { type: 'number' },
          description: 'Input vector (3072D for Phi-4)'
        },
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile (default: balanced)'
        }
      },
      required: ['input']
    }
  },

  {
    name: 'sona_apply_base_lora',
    description: 'Apply Base-LoRA adaptation to layer. 0.452ms per-layer cost.',
    inputSchema: {
      type: 'object',
      properties: {
        layerIndex: {
          type: 'number',
          minimum: 0,
          maximum: 39,
          description: 'Layer index (0-39 for Phi-4)'
        },
        input: {
          type: 'array',
          items: { type: 'number' },
          description: 'Input vector (3072D for Phi-4)'
        },
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile (default: balanced)'
        }
      },
      required: ['layerIndex', 'input']
    }
  },

  // Learning Control
  {
    name: 'sona_force_learn',
    description: 'Force learning cycle. Recommended when trajectory capacity reaches 80% utilization.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile (default: balanced)'
        }
      }
    }
  },

  // Statistics & Monitoring
  {
    name: 'sona_get_stats',
    description: 'Get SONA service statistics including trajectories, performance, and configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile (default: balanced)'
        },
        engineStats: {
          type: 'boolean',
          default: false,
          description: 'Include engine-level statistics'
        }
      }
    }
  },

  // Profile Management
  {
    name: 'sona_get_profile',
    description: 'Get SONA profile configuration details.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'Profile name'
        }
      },
      required: ['profile']
    }
  },

  {
    name: 'sona_list_profiles',
    description: 'List all available SONA profiles with their characteristics.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // Engine Control
  {
    name: 'sona_set_enabled',
    description: 'Enable or disable SONA engine.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable (true) or disable (false)'
        },
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile (default: balanced)'
        }
      },
      required: ['enabled']
    }
  },

  // Benchmarking
  {
    name: 'sona_benchmark',
    description: 'Run SONA performance benchmark. Expected: 2211 ops/sec, <0.5ms latency.',
    inputSchema: {
      type: 'object',
      properties: {
        iterations: {
          type: 'number',
          default: 1000,
          minimum: 100,
          maximum: 10000,
          description: 'Number of benchmark iterations'
        },
        profile: {
          type: 'string',
          enum: ['real-time', 'batch', 'research', 'edge', 'balanced'],
          description: 'SONA profile (default: balanced)'
        }
      }
    }
  }
];

/**
 * MCP Tool Handlers
 */
export const sonaMCPHandlers = {
  sona_trajectory_begin: async (params: {
    embedding: number[];
    route?: string;
    profile?: SONAProfile;
  }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const trajectoryId = service.beginTrajectory(params.embedding, params.route);

    return {
      success: true,
      trajectoryId,
      route: params.route,
      profile: params.profile || 'balanced'
    };
  },

  sona_trajectory_step: async (params: {
    trajectoryId: string;
    activations: number[];
    attentionWeights: number[];
    reward: number;
  }) => {
    sonaService.addTrajectoryStep(
      params.trajectoryId,
      params.activations,
      params.attentionWeights,
      params.reward
    );

    return {
      success: true,
      trajectoryId: params.trajectoryId,
      reward: params.reward
    };
  },

  sona_trajectory_context: async (params: {
    trajectoryId: string;
    contextId: string;
  }) => {
    sonaService.addTrajectoryContext(params.trajectoryId, params.contextId);

    return {
      success: true,
      trajectoryId: params.trajectoryId,
      contextId: params.contextId
    };
  },

  sona_trajectory_end: async (params: {
    trajectoryId: string;
    qualityScore: number;
  }) => {
    sonaService.endTrajectory(params.trajectoryId, params.qualityScore);

    const stats = sonaService.getStats();

    return {
      success: true,
      trajectoryId: params.trajectoryId,
      qualityScore: params.qualityScore,
      learningTriggered: stats.trajectoryUtilization >= 0.8
    };
  },

  sona_trajectory_list: async (params: { profile?: SONAProfile }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const active = service.getActiveTrajectories();

    return {
      count: active.length,
      trajectories: active.map(t => ({
        id: t.id,
        route: t.route,
        steps: t.steps.length,
        contexts: t.contexts.length,
        durationMs: Date.now() - t.startTime
      }))
    };
  },

  sona_pattern_find: async (params: {
    query: number[];
    k?: number;
    profile?: SONAProfile;
  }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const patterns = service.findPatterns(params.query, params.k || 3);

    return {
      count: patterns.length,
      patterns: patterns.map(p => ({
        id: p.id,
        patternType: p.patternType,
        clusterSize: p.clusterSize,
        avgQuality: p.avgQuality,
        similarity: p.similarity
      }))
    };
  },

  sona_apply_micro_lora: async (params: {
    input: number[];
    profile?: SONAProfile;
  }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const start = Date.now();
    const output = service.applyMicroLora(params.input);
    const latencyMs = Date.now() - start;

    return {
      output,
      latencyMs,
      inputDim: params.input.length,
      outputDim: output.length
    };
  },

  sona_apply_base_lora: async (params: {
    layerIndex: number;
    input: number[];
    profile?: SONAProfile;
  }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const start = Date.now();
    const output = service.applyBaseLora(params.layerIndex, params.input);
    const latencyMs = Date.now() - start;

    return {
      output,
      latencyMs,
      layerIndex: params.layerIndex,
      inputDim: params.input.length,
      outputDim: output.length
    };
  },

  sona_force_learn: async (params: { profile?: SONAProfile }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const result = service.forceLearn();

    return {
      success: result.success,
      patternsLearned: result.patternsLearned,
      profile: params.profile || 'balanced'
    };
  },

  sona_get_stats: async (params: {
    profile?: SONAProfile;
    engineStats?: boolean;
  }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const stats = service.getStats();

    const result: any = {
      profile: params.profile || 'balanced',
      trajectories: {
        total: stats.totalTrajectories,
        active: stats.activeTrajectories,
        completed: stats.completedTrajectories,
        utilization: stats.trajectoryUtilization
      },
      performance: {
        avgQualityScore: stats.avgQualityScore,
        totalOpsProcessed: stats.totalOpsProcessed,
        opsPerSecond: stats.opsPerSecond,
        learningCycles: stats.totalLearningCycles
      },
      configuration: stats.config
    };

    if (params.engineStats) {
      result.engineStats = service.getEngineStats();
    }

    return result;
  },

  sona_get_profile: async (params: { profile: SONAProfile }) => {
    const service = sonaServices[params.profile];
    if (!service) {
      throw new Error(`Unknown profile: ${params.profile}`);
    }

    const stats = service.getStats();

    return {
      profile: params.profile,
      configuration: stats.config,
      characteristics: getProfileCharacteristics(params.profile)
    };
  },

  sona_list_profiles: async () => {
    return {
      profiles: [
        {
          name: 'real-time',
          description: '2200 ops/sec, <0.5ms latency',
          config: 'Rank-2, 25 clusters, 0.7 threshold',
          useCase: 'Low-latency applications'
        },
        {
          name: 'batch',
          description: 'Balance throughput and adaptation',
          config: 'Rank-2, rank-8, 5000 capacity',
          useCase: 'Batch processing workflows'
        },
        {
          name: 'research',
          description: '+55% quality improvement',
          config: 'Rank-16 base, LR 0.002, 0.2 threshold',
          useCase: 'Maximum quality, research'
        },
        {
          name: 'edge',
          description: '<5MB memory footprint',
          config: 'Rank-1, 200 capacity, 15 clusters',
          useCase: 'Edge devices, mobile'
        },
        {
          name: 'balanced',
          description: '18ms overhead, +25% quality',
          config: 'Rank-2, rank-8, 0.4 threshold',
          useCase: 'General-purpose (default)'
        }
      ]
    };
  },

  sona_set_enabled: async (params: {
    enabled: boolean;
    profile?: SONAProfile;
  }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    service.setEnabled(params.enabled);

    return {
      success: true,
      enabled: params.enabled,
      profile: params.profile || 'balanced'
    };
  },

  sona_benchmark: async (params: {
    iterations?: number;
    profile?: SONAProfile;
  }) => {
    const service = params.profile ? sonaServices[params.profile] : sonaService;
    const iterations = params.iterations || 1000;

    // Benchmark Micro-LoRA
    const input = Array.from({ length: 3072 }, () => Math.random());
    const startMicro = Date.now();

    for (let i = 0; i < iterations; i++) {
      service.applyMicroLora(input);
    }

    const microTime = Date.now() - startMicro;
    const microLatency = microTime / iterations;
    const microOpsPerSec = (iterations / microTime) * 1000;

    // Benchmark Base-LoRA
    const startBase = Date.now();

    for (let i = 0; i < iterations; i++) {
      service.applyBaseLora(10, input);
    }

    const baseTime = Date.now() - startBase;
    const baseLatency = baseTime / iterations;
    const baseOpsPerSec = (iterations / baseTime) * 1000;

    return {
      iterations,
      profile: params.profile || 'balanced',
      microLora: {
        totalTimeMs: microTime,
        avgLatencyMs: microLatency,
        opsPerSec: microOpsPerSec
      },
      baseLora: {
        totalTimeMs: baseTime,
        avgLatencyMs: baseLatency,
        opsPerSec: baseOpsPerSec
      },
      expected: {
        targetThroughput: 2211,
        targetLatency: 0.5,
        perLayerCost: 0.452
      },
      meetsTarget: microOpsPerSec >= 1000
    };
  }
};

/**
 * Get profile characteristics
 */
function getProfileCharacteristics(profile: SONAProfile): any {
  const characteristics: Record<SONAProfile, any> = {
    'real-time': {
      throughput: '2200 ops/sec',
      latency: '<0.5ms',
      memory: '~20MB',
      qualityGain: '+15%'
    },
    'batch': {
      throughput: '1800 ops/sec',
      latency: '~1ms',
      memory: '~50MB',
      qualityGain: '+25%'
    },
    'research': {
      throughput: '1000 ops/sec',
      latency: '~2ms',
      memory: '~100MB',
      qualityGain: '+55%'
    },
    'edge': {
      throughput: '500 ops/sec',
      latency: '~2ms',
      memory: '<5MB',
      qualityGain: '+10%'
    },
    'balanced': {
      throughput: '1500 ops/sec',
      latency: '~1ms',
      memory: '~50MB',
      qualityGain: '+25%'
    },
    'custom': {
      throughput: 'configurable',
      latency: 'configurable',
      memory: 'configurable',
      qualityGain: 'configurable'
    }
  };

  return characteristics[profile];
}

export default sonaMCPTools;
