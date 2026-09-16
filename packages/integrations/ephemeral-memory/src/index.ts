/**
 * Ephemeral Memory - On-demand agent spawning with persistent memory
 *
 * Features:
 * - Spawn agents in <50ms
 * - 90%+ resource savings vs persistent agents
 * - Persistent memory across agent lifecycles
 * - Semantic search for relevant context
 * - Automatic resource monitoring and optimization
 *
 * @example
 * ```typescript
 * import { EphemeralAgentManager } from '@agentic-flow/ephemeral-memory';
 *
 * const manager = new EphemeralAgentManager({
 *   tenantId: 'my-tenant',
 *   dbPath: './memory.db'
 * });
 *
 * // Spawn and execute
 * const result = await manager.executeTask(
 *   'web-scraper',
 *   { id: '1', type: 'scrape', description: 'Scrape product data' },
 *   async (context) => {
 *     // Access memory
 *     const lastRun = await context.memory.read('last_run');
 *
 *     // Execute task
 *     const data = await scrapeWebsite();
 *
 *     // Store results
 *     await context.memory.write(context.agent.id, 'last_run', Date.now());
 *
 *     return data;
 *   }
 * );
 *
 * // Get cost savings
 * const stats = manager.getResourceStats();
 * console.log(`Savings: ${stats.costSavings.savingsPercent}%`);
 * ```
 */

export { EphemeralAgentManager, EphemeralAgentManagerConfig, AgentExecutionContext } from './EphemeralAgentManager.js';
export { MemoryPersistenceLayer, MemoryPersistenceConfig } from './MemoryPersistenceLayer.js';
export { AgentLifecycleManager, LifecycleConfig } from './AgentLifecycleManager.js';
export { MemorySynchronizer, SyncConfig } from './MemorySynchronizer.js';
export { ResourceMonitor, MonitorConfig, ResourceAlert } from './ResourceMonitor.js';

export * from './types.js';
