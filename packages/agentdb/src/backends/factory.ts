/**
 * Backend Factory - Automatic Backend Detection and Selection
 *
 * Detects available vector backends and creates appropriate instances.
 * Priority: RuVector (native/WASM) > HNSWLib (Node.js)
 *
 * Features:
 * - Automatic detection of @ruvector packages
 * - Native vs WASM detection for RuVector
 * - GNN and Graph capabilities detection
 * - Graceful fallback to HNSWLib
 * - Clear error messages for missing dependencies
 */

import type { VectorBackend, VectorConfig } from './VectorBackend.js';
import { RuVectorBackend } from './ruvector/RuVectorBackend.js';
import { HNSWLibBackend } from './hnswlib/HNSWLibBackend.js';

export type BackendType = 'auto' | 'ruvector' | 'hnswlib';

export interface BackendDetection {
  available: 'ruvector' | 'hnswlib' | 'none';
  ruvector: {
    core: boolean;
    gnn: boolean;
    graph: boolean;
    native: boolean;
  };
  hnswlib: boolean;
}

/**
 * Detect available vector backends
 */
export async function detectBackends(): Promise<BackendDetection> {
  const result: BackendDetection = {
    available: 'none',
    ruvector: {
      core: false,
      gnn: false,
      graph: false,
      native: false
    },
    hnswlib: false
  };

  // Check RuVector packages (main package or scoped packages)
  try {
    // Try main ruvector package first
    const ruvector = await import('ruvector');
    result.ruvector.core = true;
    result.ruvector.gnn = true; // Main package includes GNN
    result.ruvector.graph = true; // Main package includes Graph
    result.ruvector.native = ruvector.isNative?.() ?? false;
    result.available = 'ruvector';
  } catch {
    // Try scoped packages as fallback
    try {
      const core = await import('@ruvector/core');
      result.ruvector.core = true;
      result.ruvector.native = core.isNative?.() ?? false;
      result.available = 'ruvector';

      // Check optional packages
      try {
        await import('@ruvector/gnn');
        result.ruvector.gnn = true;
      } catch {
        // GNN not installed - this is optional
      }

      try {
        await import('@ruvector/graph-node');
        result.ruvector.graph = true;
      } catch {
        // Graph not installed - this is optional
      }
    } catch {
      // RuVector not installed - will try fallback
    }
  }

  // Check HNSWLib
  try {
    await import('hnswlib-node');
    result.hnswlib = true;

    if (result.available === 'none') {
      result.available = 'hnswlib';
    }
  } catch {
    // HNSWLib not installed
  }

  return result;
}

/**
 * Create vector backend with automatic detection
 *
 * @param type - Backend type: 'auto', 'ruvector', or 'hnswlib'
 * @param config - Vector configuration
 * @returns Initialized VectorBackend instance
 */
export async function createBackend(
  type: BackendType,
  config: VectorConfig
): Promise<VectorBackend> {
  const detection = await detectBackends();

  // 1. PATH: RuVector (Explicit or Auto-Detected)
  if (type === 'ruvector' || (type === 'auto' && detection.ruvector.core)) {
    // Validation for explicit request
    if (type === 'ruvector' && !detection.ruvector.core) {
      throw new Error(
        'RuVector not available.\n' +
        'Install with: npm install @ruvector/core\n' +
        'Optional GNN support: npm install @ruvector/gnn\n' +
        'Optional Graph support: npm install @ruvector/graph-node'
      );
    }

    const backend = new RuVectorBackend(config);
    
    try {
      await (backend as any).initialize();
      
      if (type === 'auto') {
        console.log(`[AgentDB] Using RuVector backend (${detection.ruvector.native ? 'native' : 'WASM'})`);
      }
      return backend;
    } catch (error) {
      // If explicit, we must fail. If auto, we can fall back to HNSWLib.
      if (type === 'ruvector' || !detection.hnswlib) {
        throw error;
      }
      console.warn(`[AgentDB] RuVector init failed, falling back to HNSWLib: ${(error as Error).message}`);
    }
  }

  // 2. PATH: HNSWLib (Explicit or Fallback from Auto)
  if (type === 'hnswlib' || (type === 'auto' && detection.hnswlib)) {
    // Validation for explicit request
    if (type === 'hnswlib' && !detection.hnswlib) {
      throw new Error(
        'HNSWLib not available.\n' +
        'Install with: npm install hnswlib-node'
      );
    }

    const backend = new HNSWLibBackend(config);
    await (backend as any).initialize();
    
    if (type === 'auto') {
      console.log('[AgentDB] Using HNSWLib backend (fallback)');
    }
    return backend;
  }

  // 3. FAIL: No backends available
  throw new Error(
    'No vector backend available.\n' +
    'Install one of:\n' +
    '  - npm install @ruvector/core (recommended)\n' +
    '  - npm install hnswlib-node (fallback)'
  );
}

/**
 * Get recommended backend type based on environment
 */
export async function getRecommendedBackend(): Promise<BackendType> {
  const detection = await detectBackends();

  if (detection.ruvector.core) {
    return 'ruvector';
  } else if (detection.hnswlib) {
    return 'hnswlib';
  } else {
    return 'auto'; // Will throw error in createBackend
  }
}

/**
 * Check if a specific backend is available
 */
export async function isBackendAvailable(backend: 'ruvector' | 'hnswlib'): Promise<boolean> {
  const detection = await detectBackends();

  if (backend === 'ruvector') {
    return detection.ruvector.core;
  }

  return detection.hnswlib;
}

/**
 * Get installation instructions for a backend
 */
export function getInstallCommand(backend: 'ruvector' | 'hnswlib'): string {
  return backend === 'ruvector'
    ? 'npm install ruvector'
    : 'npm install hnswlib-node';
}
