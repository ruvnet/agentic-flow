/**
 * Shared type definitions for ephemeral-memory package
 */

export interface Agent {
  id: string;
  type: string;
  tenantId: string;
  spawnedAt: number;
  expiresAt: number;
  status: 'spawning' | 'active' | 'terminating' | 'terminated';
  memoryNamespace: string;
  resourceUsage: ResourceUsage;
}

export interface Task {
  id: string;
  type: string;
  description: string;
  context?: Record<string, any>;
  priority?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
}

export interface Memory {
  key: string;
  value: any;
  namespace: string;
  agentId: string;
  tenantId: string;
  createdAt: number;
  updatedAt: number;
  embeddings?: number[];
  metadata?: Record<string, any>;
}

export interface ResourceUsage {
  cpuPercent: number;
  memoryMB: number;
  uptime: number;
  taskCount: number;
}

export interface AgentMetrics {
  agentId: string;
  spawnTime: number;
  executionTime: number;
  memoryReads: number;
  memoryWrites: number;
  tasksCompleted: number;
  errors: number;
  resourceUsage: ResourceUsage;
}

export interface CostSavings {
  persistentAgentCost: number;
  ephemeralAgentCost: number;
  savingsPercent: number;
  savingsAmount: number;
  uptimePercent: number;
}

export interface MemorySearchResult {
  key: string;
  value: any;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface SpawnOptions {
  ttl?: number; // time-to-live in milliseconds
  memoryPreload?: string[]; // keys to preload
  resourceLimits?: {
    maxMemoryMB?: number;
    maxCpuPercent?: number;
  };
  autoTerminate?: boolean;
}

export interface LifecycleEvent {
  agentId: string;
  event: 'spawned' | 'active' | 'terminating' | 'terminated' | 'error';
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface SyncBatch {
  writes: Memory[];
  deletes: string[];
  timestamp: number;
}

export interface CacheEntry<T = any> {
  value: T;
  expiresAt: number;
  hits: number;
}
