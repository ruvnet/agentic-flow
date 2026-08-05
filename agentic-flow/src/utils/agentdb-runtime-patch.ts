/**
 * AgentDB Runtime Patch
 *
 * Automatically fixes AgentDB v1.3.9 import resolution issues at runtime.
 * This patch works in all contexts: npm install, npm install -g, and npx.
 *
 * Issue: agentdb v1.3.9 missing .js extensions in ESM exports
 * Solution: Patch the controller index.js file at runtime before first import
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

let patched = false;
let patchAttempted = false;

/**
 * Apply AgentDB import fix at runtime
 * Safe to call multiple times - only patches once
 */
export function applyAgentDBPatch(): boolean {
  // Only attempt once per process
  if (patchAttempted) {
    return patched;
  }
  patchAttempted = true;

  try {
    // Find agentdb installation
    const agentdbPath = findAgentDBPath();
    if (!agentdbPath) {
      console.warn('[AgentDB Patch] Could not locate agentdb installation');
      return false;
    }

    const controllerIndexPath = join(agentdbPath, 'dist', 'src', 'controllers', 'index.js');

    if (!existsSync(controllerIndexPath)) {
      console.warn(`[AgentDB Patch] Controller index not found: ${controllerIndexPath}`);
      return false;
    }

    // Read current content
    let content = readFileSync(controllerIndexPath, 'utf8');

    // Check if already patched
    if (content.includes("from './ReflexionMemory.js'")) {
      patched = true;
      return true;
    }

    // Apply patches
    const patches = [
      { from: "from './ReflexionMemory'", to: "from './ReflexionMemory.js'" },
      { from: "from './SkillLibrary'", to: "from './SkillLibrary.js'" },
      { from: "from './EmbeddingService'", to: "from './EmbeddingService.js'" },
      { from: "from './CausalMemoryGraph'", to: "from './CausalMemoryGraph.js'" },
      { from: "from './CausalRecall'", to: "from './CausalRecall.js'" },
      { from: "from './NightlyLearner'", to: "from './NightlyLearner.js'" }
    ];

    let modified = false;
    for (const patch of patches) {
      if (content.includes(patch.from) && !content.includes(patch.to)) {
        content = content.replace(new RegExp(patch.from, 'g'), patch.to);
        modified = true;
      }
    }

    if (modified) {
      try {
        writeFileSync(controllerIndexPath, content, 'utf8');
        patched = true;
        console.log('[AgentDB Patch] ✅ Successfully patched AgentDB imports');
        return true;
      } catch (writeError: any) {
        // If we can't write (npx temp dir permissions), that's OK - imports will fail gracefully
        console.warn('[AgentDB Patch] ⚠️  Could not write patch (read-only):', writeError.message);
        return false;
      }
    }

    return false;
  } catch (error: any) {
    console.warn('[AgentDB Patch] Error applying patch:', error.message);
    return false;
  }
}

/**
 * Find AgentDB installation directory
 * Checks multiple possible locations
 */
function findAgentDBPath(): string | null {
  const possiblePaths = [
    // Local node_modules (most common)
    join(process.cwd(), 'node_modules', 'agentdb'),

    // Parent directory node_modules (monorepo)
    join(process.cwd(), '..', 'node_modules', 'agentdb'),

    // Global npm installation
    join(process.execPath, '..', '..', 'lib', 'node_modules', 'agentdb'),

    // Relative to this file (for bundled installations)
    ...(typeof __dirname !== 'undefined'
      ? [
          join(__dirname, '..', '..', 'node_modules', 'agentdb'),
          join(__dirname, '..', '..', '..', 'agentdb')
        ]
      : []),

    // Using import.meta.url (ESM)
    ...(typeof import.meta !== 'undefined' && import.meta.url
      ? (() => {
          try {
            const currentDir = dirname(fileURLToPath(import.meta.url));
            return [
              join(currentDir, '..', '..', 'node_modules', 'agentdb'),
              join(currentDir, '..', '..', '..', 'agentdb')
            ];
          } catch {
            return [];
          }
        })()
      : [])
  ];

  // Try each path
  for (const path of possiblePaths) {
    if (existsSync(join(path, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
        if (pkg.name === 'agentdb') {
          return path;
        }
      } catch {
        continue;
      }
    }
  }

  // Try require.resolve as fallback
  try {
    const resolved = require.resolve('agentdb/package.json');
    return dirname(resolved);
  } catch {
    // Not found via require.resolve
  }

  return null;
}

/**
 * Check if AgentDB patch is needed
 */
export function isAgentDBPatchNeeded(): boolean {
  const agentdbPath = findAgentDBPath();
  if (!agentdbPath) return false;

  const controllerIndexPath = join(agentdbPath, 'dist', 'src', 'controllers', 'index.js');
  if (!existsSync(controllerIndexPath)) return false;

  const content = readFileSync(controllerIndexPath, 'utf8');
  return !content.includes("from './ReflexionMemory.js'");
}

/**
 * Get patch status information
 */
export function getAgentDBPatchStatus(): {
  needed: boolean;
  applied: boolean;
  attempted: boolean;
  location: string | null;
} {
  return {
    needed: isAgentDBPatchNeeded(),
    applied: patched,
    attempted: patchAttempted,
    location: findAgentDBPath()
  };
}

// Auto-apply patch on module load (SYNCHRONOUS - must happen before any AgentDB imports)
// This ensures the patch is applied before any imports
if (typeof process !== 'undefined' && !process.env.SKIP_AGENTDB_PATCH) {
  // MUST be synchronous - async won't work because imports happen immediately
  try {
    applyAgentDBPatch();
  } catch (error) {
    // Silently fail - patch will be attempted again on explicit call
  }
}
