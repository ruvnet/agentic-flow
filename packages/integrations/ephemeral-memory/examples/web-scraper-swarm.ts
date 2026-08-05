/**
 * Example: Web Scraper Swarm with Ephemeral Agents
 *
 * This example demonstrates:
 * - Spawning ephemeral scrapers on-demand
 * - Sharing scraped data via persistent memory
 * - Cost savings vs persistent scraper pool
 */

import { EphemeralAgentManager } from '../src/index.js';

interface ScrapingTask {
  url: string;
  selector: string;
}

interface ScrapedData {
  url: string;
  data: any;
  scrapedAt: number;
}

async function main() {
  console.log('🕷️  Starting Web Scraper Swarm...\n');

  // Initialize manager
  const manager = new EphemeralAgentManager({
    tenantId: 'scraper-swarm',
    dbPath: './scraper-memory.db',
    lifecycle: {
      defaultTTL: 300000, // 5 minutes
      enableAutoCleanup: true
    }
  });

  // Listen for events
  manager.on('agent:spawned', (event) => {
    console.log(`✨ Spawned ${event.agent.id} in ${event.spawnTime}ms`);
  });

  manager.on('agent:terminated', (event) => {
    console.log(`💀 Terminated ${event.agentId}`);
  });

  // URLs to scrape
  const tasks: ScrapingTask[] = [
    { url: 'https://example.com/page1', selector: '.product' },
    { url: 'https://example.com/page2', selector: '.product' },
    { url: 'https://example.com/page3', selector: '.product' },
    { url: 'https://example.com/page4', selector: '.product' },
    { url: 'https://example.com/page5', selector: '.product' }
  ];

  console.log(`📋 Scraping ${tasks.length} URLs...\n`);

  // Spawn ephemeral scrapers for each task
  const results = await Promise.all(
    tasks.map((task, index) =>
      manager.executeTask(
        'web-scraper',
        {
          id: `scrape-${index}`,
          type: 'scrape',
          description: `Scrape ${task.url}`
        },
        async (context) => {
          // Check if URL was recently scraped
          const cached = await context.memory.search(task.url, 1);
          if (cached.length > 0) {
            console.log(`📦 Cache hit for ${task.url}`);
            return cached[0];
          }

          // Simulate scraping (replace with actual scraping logic)
          console.log(`🔍 Scraping ${task.url}...`);
          await new Promise(resolve => setTimeout(resolve, 1000));

          const scrapedData: ScrapedData = {
            url: task.url,
            data: { items: Math.floor(Math.random() * 10) + 1 },
            scrapedAt: Date.now()
          };

          // Store in persistent memory
          await context.memory.write(
            context.agent.id,
            `scraped:${task.url}`,
            scrapedData
          );

          return scrapedData;
        }
      )
    )
  );

  console.log('\n✅ Scraping complete!\n');
  console.log('📊 Results:');
  results.forEach((result, i) => {
    console.log(`  ${i + 1}. ${result.url}: ${result.data.items} items`);
  });

  // Show cost savings
  console.log('\n💰 Cost Analysis:');
  const stats = manager.getResourceStats();
  console.log(`  Persistent agents cost: $${stats.costSavings.persistentAgentCost.toFixed(4)}`);
  console.log(`  Ephemeral agents cost:  $${stats.costSavings.ephemeralAgentCost.toFixed(4)}`);
  console.log(`  💸 Savings: ${stats.costSavings.savingsPercent.toFixed(1)}% ($${stats.costSavings.savingsAmount.toFixed(4)})`);
  console.log(`  ⏱️  Uptime: ${stats.costSavings.uptimePercent.toFixed(1)}%`);

  // Show metrics
  console.log('\n📈 Performance Metrics:');
  const metrics = manager.exportMetrics();
  console.log(`  Total spawns: ${metrics.monitor.aggregated.totalSpawns}`);
  console.log(`  Avg spawn time: ${metrics.monitor.aggregated.avgSpawnTime.toFixed(2)}ms`);
  console.log(`  Avg execution time: ${metrics.monitor.aggregated.avgExecutionTime.toFixed(2)}ms`);
  console.log(`  Memory reads: ${metrics.monitor.aggregated.totalMemoryReads}`);
  console.log(`  Memory writes: ${metrics.monitor.aggregated.totalMemoryWrites}`);

  // Cleanup
  await manager.shutdown();
  console.log('\n👋 Shutdown complete');
}

main().catch(console.error);
