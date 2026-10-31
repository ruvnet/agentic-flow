#!/usr/bin/env node
/**
 * P2P Swarm V2 CLI Commands
 *
 * Production-grade P2P swarm coordination with:
 * - Ed25519/X25519 cryptography
 * - GunDB relay coordination
 * - Task execution with claim resolution
 * - Heartbeat-based liveness
 * - Verified member registry
 */

import { Command } from 'commander';
import { P2PSwarmV2, createP2PSwarmV2 } from '../../swarm/p2p-swarm-v2.js';
import { logger } from '../../utils/logger.js';
import { packageSpec } from '../../utils/package-version.js';

// Global swarm instance
let swarmInstance: P2PSwarmV2 | null = null;

export function createSwarmCommand(): Command {
  const swarm = new Command('swarm')
    .description('P2P Swarm V2 - Production-grade decentralized coordination');

  // Initialize and connect to swarm
  swarm
    .command('connect')
    .description('Connect to a P2P swarm')
    .option('-a, --agent-id <id>', 'Agent ID (default: auto-generated)')
    .option('-k, --swarm-key <key>', 'Swarm key for joining existing swarm')
    .option('-e, --executor', 'Enable task executor capability')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: {
      agentId?: string;
      swarmKey?: string;
      executor?: boolean;
      json?: boolean;
    }) => {
      try {
        const agentId = options.agentId || `agent-${Date.now().toString(36)}`;

        console.log(`Connecting to P2P Swarm...`);
        swarmInstance = await createP2PSwarmV2(agentId, options.swarmKey);

        if (options.executor) {
          swarmInstance.startTaskExecutor();
        }

        const status = swarmInstance.getStatus();

        if (options.json) {
          console.log(JSON.stringify({
            connected: status.connected,
            agentId: status.agentId,
            swarmId: status.swarmId,
            swarmKey: swarmInstance.getSwarmKey(),
            relays: status.relays,
            executor: options.executor || false,
          }, null, 2));
        } else {
          console.log(`\n✅ Connected to P2P Swarm V2`);
          console.log(`   Agent ID:  ${status.agentId}`);
          console.log(`   Swarm ID:  ${status.swarmId}`);
          console.log(`   Swarm Key: ${swarmInstance.getSwarmKey().slice(0, 20)}...`);
          console.log(`   Relays:    ${status.relays.healthy}/${status.relays.total} healthy`);
          console.log(`   Executor:  ${options.executor ? 'Enabled' : 'Disabled'}`);
          console.log(`\nShare the swarm key to invite others:`);
          console.log(`   npx ${packageSpec()} swarm connect -k "${swarmInstance.getSwarmKey()}"`);
        }

        // Keep process alive for background operations
        if (options.executor) {
          console.log(`\nTask executor running. Press Ctrl+C to stop.`);
          process.on('SIGINT', () => {
            swarmInstance?.disconnect();
            process.exit(0);
          });
          // Keep alive
          await new Promise(() => {});
        }
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Get swarm status
  swarm
    .command('status')
    .description('Get current swarm status')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      const status = swarmInstance.getStatus();
      const liveMembers = swarmInstance.getLiveMembers();

      if (options.json) {
        console.log(JSON.stringify({
          ...status,
          liveMembers,
          liveMemberCount: swarmInstance.getLiveMemberCount(),
        }, null, 2));
      } else {
        console.log(`\n📊 P2P Swarm Status`);
        console.log(`   Connected:    ${status.connected}`);
        console.log(`   Agent ID:     ${status.agentId}`);
        console.log(`   Swarm ID:     ${status.swarmId}`);
        console.log(`   Relays:       ${status.relays.healthy}/${status.relays.total} healthy`);
        console.log(`   Avg Latency:  ${status.relays.avgLatency.toFixed(0)}ms`);
        console.log(`\n👥 Live Members: ${swarmInstance.getLiveMemberCount()}`);
        for (const member of liveMembers) {
          const status = member.isAlive ? '🟢' : '🔴';
          const age = Math.round((Date.now() - member.lastSeen) / 1000);
          console.log(`   ${status} ${member.agentId} (${member.capabilities.join(', ')}) - ${age}s ago`);
        }
      }
    });

  // List members
  swarm
    .command('members')
    .description('List swarm members')
    .option('-a, --all', 'Include offline members')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: { all?: boolean; json?: boolean }) => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      const members = swarmInstance.getLiveMembers();
      const filtered = options.all ? members : members.filter(m => m.isAlive);

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        console.log(`\n👥 Swarm Members (${filtered.length})`);
        for (const member of filtered) {
          const status = member.isAlive ? '🟢 Online' : '🔴 Offline';
          const age = Math.round((Date.now() - member.lastSeen) / 1000);
          console.log(`\n   ${member.agentId}`);
          console.log(`   Status:       ${status}`);
          console.log(`   Capabilities: ${member.capabilities.join(', ')}`);
          console.log(`   Last Seen:    ${age}s ago`);
        }
      }
    });

  // Publish message to topic
  swarm
    .command('publish <topic> <message>')
    .description('Publish a message to a topic')
    .option('-j, --json', 'Parse message as JSON')
    .action(async (topic: string, message: string, options: { json?: boolean }) => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      try {
        const payload = options.json ? JSON.parse(message) : { text: message };
        const messageId = await swarmInstance.publish(topic, payload);
        console.log(`✅ Published to ${topic}`);
        console.log(`   Message ID: ${messageId}`);
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Subscribe to topic
  swarm
    .command('subscribe <topic>')
    .description('Subscribe to a topic and print messages')
    .action(async (topic: string) => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      console.log(`📡 Subscribed to ${topic}. Waiting for messages...`);
      swarmInstance.subscribe(topic, (data, from) => {
        console.log(`\n[${new Date().toISOString()}] From: ${from}`);
        console.log(JSON.stringify(data, null, 2));
      });

      // Keep alive
      process.on('SIGINT', () => {
        swarmInstance?.disconnect();
        process.exit(0);
      });
      await new Promise(() => {});
    });

  // Sync Q-table
  swarm
    .command('sync-qtable')
    .description('Sync a Q-table to the swarm')
    .requiredOption('-f, --file <path>', 'Path to Q-table JSON file')
    .action(async (options: { file: string }) => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      try {
        const fs = await import('fs');
        const data = fs.readFileSync(options.file, 'utf-8');
        const qTable = JSON.parse(data);

        if (!Array.isArray(qTable) || !Array.isArray(qTable[0])) {
          throw new Error('Q-table must be a 2D array');
        }

        const pointer = await swarmInstance.syncQTable(qTable);
        console.log(`✅ Q-table synced`);
        console.log(`   CID:        ${pointer.cid}`);
        console.log(`   Dimensions: ${pointer.dimensions}`);
        console.log(`   Checksum:   ${pointer.checksum}`);
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Sync memory vectors
  swarm
    .command('sync-memory')
    .description('Sync memory vectors to the swarm')
    .requiredOption('-f, --file <path>', 'Path to vectors JSON file')
    .option('-n, --namespace <ns>', 'Memory namespace', 'default')
    .action(async (options: { file: string; namespace: string }) => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      try {
        const fs = await import('fs');
        const data = fs.readFileSync(options.file, 'utf-8');
        const vectors = JSON.parse(data);

        if (!Array.isArray(vectors) || !Array.isArray(vectors[0])) {
          throw new Error('Vectors must be a 2D array');
        }

        const pointer = await swarmInstance.syncMemory(vectors, options.namespace);
        console.log(`✅ Memory vectors synced`);
        console.log(`   CID:        ${pointer.cid}`);
        console.log(`   Namespace:  ${options.namespace}`);
        console.log(`   Dimensions: ${pointer.dimensions}`);
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Submit task
  swarm
    .command('submit-task')
    .description('Submit a task for execution')
    .requiredOption('-m, --module <cid>', 'WASM module CID')
    .requiredOption('-i, --input <cid>', 'Input data CID')
    .option('-e, --entrypoint <fn>', 'Entrypoint function', 'main')
    .option('-f, --fuel <n>', 'Fuel limit', '1000000')
    .option('-M, --memory <mb>', 'Memory limit in MB', '64')
    .option('-t, --timeout <ms>', 'Timeout in ms', '30000')
    .action(async (options: {
      module: string;
      input: string;
      entrypoint: string;
      fuel: string;
      memory: string;
      timeout: string;
    }) => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      try {
        const taskId = await swarmInstance.submitTask({
          taskId: `task-${Date.now().toString(36)}`,
          moduleCID: options.module,
          inputCID: options.input,
          entrypoint: options.entrypoint,
          outputSchemaHash: '',
          budgets: {
            fuelLimit: parseInt(options.fuel),
            memoryMB: parseInt(options.memory),
            timeoutMs: parseInt(options.timeout),
          },
        });

        console.log(`✅ Task submitted`);
        console.log(`   Message ID: ${taskId}`);
        console.log(`   Module:     ${options.module}`);
        console.log(`   Input:      ${options.input}`);
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Start executor
  swarm
    .command('executor')
    .description('Start task executor daemon')
    .action(async () => {
      if (!swarmInstance) {
        console.error('Not connected to swarm. Run: swarm connect');
        process.exit(1);
      }

      swarmInstance.startTaskExecutor();
      console.log(`✅ Task executor started`);
      console.log(`   Listening for tasks...`);

      process.on('SIGINT', () => {
        swarmInstance?.stopTaskExecutor();
        swarmInstance?.disconnect();
        process.exit(0);
      });
      await new Promise(() => {});
    });

  // Disconnect
  swarm
    .command('disconnect')
    .description('Disconnect from the swarm')
    .action(async () => {
      if (swarmInstance) {
        swarmInstance.disconnect();
        swarmInstance = null;
        console.log('✅ Disconnected from swarm');
      } else {
        console.log('Not connected to swarm');
      }
    });

  // Generate new swarm key
  swarm
    .command('keygen')
    .description('Generate a new swarm key')
    .action(async () => {
      const crypto = await import('crypto');
      const key = crypto.randomBytes(32).toString('base64');
      console.log(`🔑 New Swarm Key:`);
      console.log(`   ${key}`);
      console.log(`\nUse with:`);
      console.log(`   npx ${packageSpec()} swarm connect -k "${key}"`);
    });

  return swarm;
}

// Export singleton getter for hooks/MCP integration
export function getSwarmInstance(): P2PSwarmV2 | null {
  return swarmInstance;
}

export function setSwarmInstance(instance: P2PSwarmV2): void {
  swarmInstance = instance;
}
