/**
 * Example: Cost Comparison - Persistent vs Ephemeral Agents
 *
 * This example demonstrates the cost savings of ephemeral agents
 * compared to persistent agents for bursty workloads.
 */

import { EphemeralAgentManager } from '../src/index.js';

interface WorkloadSimulation {
  name: string;
  tasksPerHour: number;
  taskDurationMs: number;
  durationHours: number;
}

async function simulateWorkload(
  manager: EphemeralAgentManager,
  workload: WorkloadSimulation
): Promise<void> {
  console.log(`\n📊 Simulating: ${workload.name}`);
  console.log(`   Tasks per hour: ${workload.tasksPerHour}`);
  console.log(`   Task duration: ${workload.taskDurationMs}ms`);
  console.log(`   Duration: ${workload.durationHours} hours\n`);

  const totalTasks = workload.tasksPerHour * workload.durationHours;
  const taskInterval = (3600000 / workload.tasksPerHour); // ms between tasks

  console.log(`   Processing ${totalTasks} tasks...\n`);

  for (let i = 0; i < totalTasks; i++) {
    await manager.executeTask(
      'worker',
      {
        id: `task-${i}`,
        type: 'work',
        description: `Task ${i}`
      },
      async () => {
        await new Promise(resolve => setTimeout(resolve, workload.taskDurationMs));
        return { success: true };
      },
      { ttl: workload.taskDurationMs + 1000 } // TTL = task duration + 1s buffer
    );

    // Simulate task arrival rate
    if (i < totalTasks - 1) {
      await new Promise(resolve => setTimeout(resolve, taskInterval));
    }
  }
}

async function main() {
  console.log('💰 Cost Comparison: Persistent vs Ephemeral Agents\n');
  console.log('='.repeat(60));

  // Define workload scenarios
  const workloads: WorkloadSimulation[] = [
    {
      name: 'Low Volume (API webhooks)',
      tasksPerHour: 10,
      taskDurationMs: 500,
      durationHours: 1
    },
    {
      name: 'Medium Volume (Background jobs)',
      tasksPerHour: 100,
      taskDurationMs: 1000,
      durationHours: 1
    },
    {
      name: 'High Volume (Data processing)',
      tasksPerHour: 1000,
      taskDurationMs: 100,
      durationHours: 1
    }
  ];

  for (const workload of workloads) {
    const manager = new EphemeralAgentManager({
      tenantId: 'cost-comparison',
      monitor: {
        persistentAgentCostPerHour: 0.10, // $0.10/hour per agent
        ephemeralAgentCostPerHour: 0.01 // $0.01/hour per agent
      }
    });

    await simulateWorkload(manager, workload);

    const stats = manager.getResourceStats();

    console.log('   📈 Results:');
    console.log(`   ─────────────────────────────────────────────────────`);
    console.log(`   Persistent Agent Cost:  $${stats.costSavings.persistentAgentCost.toFixed(4)}`);
    console.log(`   Ephemeral Agent Cost:   $${stats.costSavings.ephemeralAgentCost.toFixed(4)}`);
    console.log(`   💸 Savings:             ${stats.costSavings.savingsPercent.toFixed(1)}% ($${stats.costSavings.savingsAmount.toFixed(4)})`);
    console.log(`   ⏱️  Uptime:              ${stats.costSavings.uptimePercent.toFixed(2)}%`);
    console.log(`   🚀 Spawn Rate:          ${manager.exportMetrics().monitor.spawnRate.toFixed(2)}/sec`);

    await manager.shutdown();
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Cost comparison complete!\n');

  console.log('📋 Summary:');
  console.log('   - Ephemeral agents provide 90%+ cost savings for bursty workloads');
  console.log('   - Best for: API handlers, webhooks, batch jobs, data processing');
  console.log('   - Worst for: Long-running services, real-time streaming');
  console.log('   - Break-even point: ~10% uptime\n');
}

main().catch(console.error);
