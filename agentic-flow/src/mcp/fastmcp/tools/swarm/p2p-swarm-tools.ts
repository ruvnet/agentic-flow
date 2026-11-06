/**
 * P2P Swarm V2 MCP Tools
 *
 * Production-grade P2P swarm coordination exposed as MCP tools.
 * Provides decentralized coordination, task execution, and learning sync.
 *
 * Features:
 * - Ed25519/X25519 cryptography
 * - GunDB relay coordination
 * - Task execution with claim resolution
 * - Heartbeat-based liveness
 * - Verified member registry
 */

import { z } from 'zod';
import { P2PSwarmV2, createP2PSwarmV2 } from '../../../../swarm/p2p-swarm-v2.js';
import { logger } from '../../../../utils/logger.js';

// Global swarm instance for MCP tools
let swarmInstance: P2PSwarmV2 | null = null;

/**
 * Get or create swarm instance
 */
async function getSwarm(agentId?: string, swarmKey?: string): Promise<P2PSwarmV2> {
  if (!swarmInstance) {
    const id = agentId || `mcp-agent-${Date.now().toString(36)}`;
    swarmInstance = await createP2PSwarmV2(id, swarmKey);
  }
  return swarmInstance;
}

/**
 * P2P Swarm Connect Tool
 */
export const p2pSwarmConnectTool = {
  name: 'p2p_swarm_connect',
  description: 'Connect to a P2P swarm for decentralized coordination',
  schema: z.object({
    agentId: z.string().optional().describe('Agent ID (auto-generated if not provided)'),
    swarmKey: z.string().optional().describe('Swarm key to join existing swarm'),
    enableExecutor: z.boolean().optional().default(false).describe('Enable task executor'),
  }),
  execute: async (params: {
    agentId?: string;
    swarmKey?: string;
    enableExecutor?: boolean;
  }) => {
    try {
      const swarm = await getSwarm(params.agentId, params.swarmKey);

      if (params.enableExecutor) {
        swarm.startTaskExecutor();
      }

      const status = swarm.getStatus();

      return {
        success: true,
        connected: status.connected,
        agentId: status.agentId,
        swarmId: status.swarmId,
        swarmKey: swarm.getSwarmKey(),
        relays: status.relays,
        executorEnabled: params.enableExecutor || false,
      };
    } catch (error) {
      logger.error('Failed to connect to swarm', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * P2P Swarm Status Tool
 */
export const p2pSwarmStatusTool = {
  name: 'p2p_swarm_status',
  description: 'Get current P2P swarm status including live members',
  schema: z.object({}),
  execute: async () => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    const status = swarmInstance.getStatus();
    const liveMembers = swarmInstance.getLiveMembers();

    return {
      success: true,
      ...status,
      liveMembers,
      liveMemberCount: swarmInstance.getLiveMemberCount(),
    };
  },
};

/**
 * P2P Swarm Members Tool
 */
export const p2pSwarmMembersTool = {
  name: 'p2p_swarm_members',
  description: 'List swarm members with their capabilities and liveness',
  schema: z.object({
    includeOffline: z.boolean().optional().default(false).describe('Include offline members'),
  }),
  execute: async (params: { includeOffline?: boolean }) => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    const members = swarmInstance.getLiveMembers();
    const filtered = params.includeOffline ? members : members.filter(m => m.isAlive);

    return {
      success: true,
      count: filtered.length,
      liveCount: filtered.filter(m => m.isAlive).length,
      members: filtered.map(m => ({
        agentId: m.agentId,
        capabilities: m.capabilities,
        isAlive: m.isAlive,
        lastSeenAgo: Math.round((Date.now() - m.lastSeen) / 1000),
      })),
    };
  },
};

/**
 * P2P Swarm Publish Tool
 */
export const p2pSwarmPublishTool = {
  name: 'p2p_swarm_publish',
  description: 'Publish a signed and encrypted message to a swarm topic',
  schema: z.object({
    topic: z.string().describe('Topic to publish to'),
    payload: z.any().optional().describe('Message payload (will be JSON serialized)'),
  }),
  execute: async (params: { topic: string; payload: any }) => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    try {
      const messageId = await swarmInstance.publish(params.topic, params.payload);
      return {
        success: true,
        messageId,
        topic: params.topic,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * P2P Swarm Subscribe Tool
 */
export const p2pSwarmSubscribeTool = {
  name: 'p2p_swarm_subscribe',
  description: 'Subscribe to a swarm topic (messages delivered via callback)',
  schema: z.object({
    topic: z.string().describe('Topic to subscribe to'),
  }),
  execute: async (params: { topic: string }) => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    // Note: In MCP context, we return success but messages are handled internally
    // For real-time messages, use the streaming MCP transport
    swarmInstance.subscribe(params.topic, (data, from) => {
      logger.info('Swarm message received', { topic: params.topic, from, data });
    });

    return {
      success: true,
      subscribed: params.topic,
      note: 'Messages will be logged. Use streaming transport for real-time delivery.',
    };
  },
};

/**
 * P2P Swarm Sync Q-Table Tool
 */
export const p2pSwarmSyncQTableTool = {
  name: 'p2p_swarm_sync_qtable',
  description: 'Sync a Q-table to the swarm for distributed learning',
  schema: z.object({
    qTable: z.array(z.array(z.number())).describe('2D array Q-table'),
  }),
  execute: async (params: { qTable: number[][] }) => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    try {
      const pointer = await swarmInstance.syncQTable(params.qTable);
      return {
        success: true,
        cid: pointer.cid,
        dimensions: pointer.dimensions,
        checksum: pointer.checksum,
        timestamp: pointer.timestamp,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * P2P Swarm Sync Memory Tool
 */
export const p2pSwarmSyncMemoryTool = {
  name: 'p2p_swarm_sync_memory',
  description: 'Sync memory vectors to the swarm',
  schema: z.object({
    vectors: z.array(z.array(z.number())).describe('2D array of vectors'),
    namespace: z.string().optional().default('default').describe('Memory namespace'),
  }),
  execute: async (params: { vectors: number[][]; namespace?: string }) => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    try {
      const pointer = await swarmInstance.syncMemory(params.vectors, params.namespace || 'default');
      return {
        success: true,
        cid: pointer.cid,
        namespace: params.namespace || 'default',
        dimensions: pointer.dimensions,
        checksum: pointer.checksum,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * P2P Swarm Submit Task Tool
 */
export const p2pSwarmSubmitTaskTool = {
  name: 'p2p_swarm_submit_task',
  description: 'Submit a task for distributed execution',
  schema: z.object({
    moduleCID: z.string().describe('CID of WASM module'),
    inputCID: z.string().describe('CID of input data'),
    entrypoint: z.string().optional().default('main').describe('Entrypoint function'),
    fuelLimit: z.number().optional().default(1000000).describe('Fuel limit'),
    memoryMB: z.number().optional().default(64).describe('Memory limit in MB'),
    timeoutMs: z.number().optional().default(30000).describe('Timeout in ms'),
  }),
  execute: async (params: {
    moduleCID: string;
    inputCID: string;
    entrypoint?: string;
    fuelLimit?: number;
    memoryMB?: number;
    timeoutMs?: number;
  }) => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    try {
      const taskId = `task-${Date.now().toString(36)}`;
      const messageId = await swarmInstance.submitTask({
        taskId,
        moduleCID: params.moduleCID,
        inputCID: params.inputCID,
        entrypoint: params.entrypoint || 'main',
        outputSchemaHash: '',
        budgets: {
          fuelLimit: params.fuelLimit || 1000000,
          memoryMB: params.memoryMB || 64,
          timeoutMs: params.timeoutMs || 30000,
        },
      });

      return {
        success: true,
        taskId,
        messageId,
        moduleCID: params.moduleCID,
        inputCID: params.inputCID,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * P2P Swarm Start Executor Tool
 */
export const p2pSwarmStartExecutorTool = {
  name: 'p2p_swarm_start_executor',
  description: 'Start the task executor to process distributed tasks',
  schema: z.object({}),
  execute: async () => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm. Use p2p_swarm_connect first.',
      };
    }

    swarmInstance.startTaskExecutor();
    return {
      success: true,
      message: 'Task executor started. Listening for tasks.',
    };
  },
};

/**
 * P2P Swarm Stop Executor Tool
 */
export const p2pSwarmStopExecutorTool = {
  name: 'p2p_swarm_stop_executor',
  description: 'Stop the task executor',
  schema: z.object({}),
  execute: async () => {
    if (!swarmInstance) {
      return {
        success: false,
        error: 'Not connected to swarm.',
      };
    }

    swarmInstance.stopTaskExecutor();
    return {
      success: true,
      message: 'Task executor stopped.',
    };
  },
};

/**
 * P2P Swarm Disconnect Tool
 */
export const p2pSwarmDisconnectTool = {
  name: 'p2p_swarm_disconnect',
  description: 'Disconnect from the P2P swarm',
  schema: z.object({}),
  execute: async () => {
    if (swarmInstance) {
      swarmInstance.disconnect();
      swarmInstance = null;
      return {
        success: true,
        message: 'Disconnected from swarm.',
      };
    }
    return {
      success: true,
      message: 'Not connected to swarm.',
    };
  },
};

/**
 * P2P Swarm Keygen Tool
 */
export const p2pSwarmKeygenTool = {
  name: 'p2p_swarm_keygen',
  description: 'Generate a new swarm key for creating a new swarm',
  schema: z.object({}),
  execute: async () => {
    const crypto = await import('crypto');
    const key = crypto.randomBytes(32).toString('base64');
    return {
      success: true,
      swarmKey: key,
      usage: `Use with p2p_swarm_connect: { swarmKey: "${key}" }`,
    };
  },
};

// Export all tools as array for MCP registration
export const p2pSwarmTools = [
  p2pSwarmConnectTool,
  p2pSwarmStatusTool,
  p2pSwarmMembersTool,
  p2pSwarmPublishTool,
  p2pSwarmSubscribeTool,
  p2pSwarmSyncQTableTool,
  p2pSwarmSyncMemoryTool,
  p2pSwarmSubmitTaskTool,
  p2pSwarmStartExecutorTool,
  p2pSwarmStopExecutorTool,
  p2pSwarmDisconnectTool,
  p2pSwarmKeygenTool,
];

// Export singleton accessor
export function getP2PSwarmInstance(): P2PSwarmV2 | null {
  return swarmInstance;
}

export function setP2PSwarmInstance(instance: P2PSwarmV2): void {
  swarmInstance = instance;
}
