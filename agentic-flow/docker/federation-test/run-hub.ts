/**
 * Run Federation Hub Server
 */

import { FederationHubServer } from '../../src/federation/FederationHubServer.js';
import { logger } from '../../src/utils/logger.js';
import express from 'express';

const PORT = parseInt(process.env.HUB_PORT || '8443');
const DB_PATH = process.env.HUB_DB_PATH || '/data/hub.db';

async function main() {
  console.log('🚀 Starting Federation Hub Server...');
  console.log(`   Port: ${PORT}`);
  console.log(`   Database: ${DB_PATH}`);

  // Create hub server
  const hub = new FederationHubServer({
    port: PORT,
    host: process.env.HUB_HOST || '0.0.0.0', // inside a container; agents must present a JWT signed with JWT_SECRET
    dbPath: DB_PATH,
    maxAgents: 1000,
    syncInterval: 5000
  });

  // Start hub
  await hub.start();

  // Create health check endpoint
  const app = express();
  const healthPort = 8444;

  app.get('/health', (req, res) => {
    const stats = hub.getStats();
    res.json({
      status: 'healthy',
      ...stats,
      timestamp: Date.now()
    });
  });

  app.get('/stats', (req, res) => {
    const stats = hub.getStats();
    res.json(stats);
  });

  app.listen(healthPort, () => {
    console.log(`✅ Health check server running on port ${healthPort}`);
  });

  console.log('✅ Federation Hub Server is ready!');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await hub.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await hub.stop();
    process.exit(0);
  });

  // Keep alive
  setInterval(() => {
    const stats = hub.getStats();
    console.log(`[Hub] Agents: ${stats.connectedAgents}, Episodes: ${stats.totalEpisodes}, Tenants: ${stats.tenants}`);
  }, 10000);
}

main().catch((error) => {
  console.error('Hub server failed:', error);
  process.exit(1);
});
