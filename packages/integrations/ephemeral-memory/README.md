# Ephemeral Memory - Pattern 4 Integration

> On-demand agent spawning with persistent memory. Achieve **90%+ cost savings** with **<50ms spawn times**.

## Overview

Ephemeral Memory combines short-lived agents (ephemeral) with long-lived storage (persistent memory) to dramatically reduce infrastructure costs while maintaining continuity across agent lifecycles.

### Key Benefits

- **90%+ Resource Savings**: Only pay for agents when they're working
- **<50ms Spawn Time**: Lightning-fast agent creation
- **10K+ Spawns/Second**: Scale to massive workloads
- **Persistent Context**: Memory survives agent termination
- **Automatic Cleanup**: No resource leaks
- **Semantic Search**: Find relevant past memories

## Quick Start

### Installation

```bash
npm install @agentic-flow/ephemeral-memory
```

### Basic Usage

```typescript
import { EphemeralAgentManager } from '@agentic-flow/ephemeral-memory';

// Initialize manager
const manager = new EphemeralAgentManager({
  tenantId: 'my-app',
  dbPath: './memory.db'
});

// Execute task with ephemeral agent
const result = await manager.executeTask(
  'data-processor',
  { id: '1', type: 'process', description: 'Process data' },
  async (context) => {
    // Access memory
    const lastRun = await context.memory.read('last_run');

    // Do work
    const data = await processData();

    // Store results
    await context.memory.write(context.agent.id, 'last_run', Date.now());
    await context.memory.write(context.agent.id, 'results', data);

    return data;
  }
);

// Get cost savings
const stats = manager.getResourceStats();
console.log(`Savings: ${stats.costSavings.savingsPercent}%`);
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│          Ephemeral Agents + Persistent Memory        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Request ──► Manager ──► Spawn Agent (< 50ms)       │
│                │                                     │
│                │ Load Context ◄── AgentDB           │
│                │     (Vector search <5ms)            │
│                │                                     │
│          Ephemeral Agent                            │
│                │                                     │
│                ├─► Execute Task (short-lived)       │
│                │                                     │
│                ├─► Store Results ──► AgentDB        │
│                │                                     │
│                └─► Terminate (resources released)   │
│                                                      │
│  Next Request ──► New Agent (with memory context)   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Core Components

### EphemeralAgentManager

Main orchestrator for the ephemeral agent system.

```typescript
const manager = new EphemeralAgentManager({
  tenantId: 'my-app',
  dbPath: './memory.db',
  lifecycle: {
    defaultTTL: 300000, // 5 minutes
    enableAutoCleanup: true
  },
  monitor: {
    persistentAgentCostPerHour: 0.10,
    ephemeralAgentCostPerHour: 0.01
  }
});
```

### MemoryPersistenceLayer

Persistent storage with semantic search.

```typescript
const persistence = new MemoryPersistenceLayer({
  tenantId: 'my-app',
  enableConsolidation: true, // Deduplicate similar memories
  similarityThreshold: 0.95
});

// Store memory
await persistence.setMemory('agent1', 'key', { data: 'value' });

// Search by similarity
const results = await persistence.searchMemories('query text', 5);
```

### AgentLifecycleManager

Manages agent TTL and automatic cleanup.

```typescript
const lifecycle = new AgentLifecycleManager({
  defaultTTL: 300000, // 5 minutes
  gracePeriod: 5000, // 5 seconds for cleanup
  enableAutoCleanup: true
});

// Register agent
const agent = lifecycle.registerAgent('agent1', 'worker', 'tenant1', {
  ttl: 600000, // 10 minutes
  autoTerminate: true
});

// Extend lifetime
lifecycle.extendLifetime('agent1', 300000); // +5 minutes
```

### MemorySynchronizer

Batched memory operations with caching.

```typescript
const sync = new MemorySynchronizer(persistence, {
  batchSize: 100,
  batchInterval: 1000, // 1 second
  cacheSize: 1000,
  cacheTTL: 60000 // 1 minute
});

// Writes are batched automatically
await sync.write('agent1', 'key1', 'value1');
await sync.write('agent1', 'key2', 'value2');

// Reads use cache
const value = await sync.read('key1'); // <5ms cached
```

### ResourceMonitor

Track usage and calculate cost savings.

```typescript
const monitor = new ResourceMonitor({
  persistentAgentCostPerHour: 0.10,
  ephemeralAgentCostPerHour: 0.01
});

// Get cost savings
const savings = monitor.calculateCostSavings(agents);
console.log(`Savings: ${savings.savingsPercent}%`);

// Get recommendations
const recommendations = monitor.getLoadBalancingRecommendations();
if (recommendations.shouldScaleUp) {
  console.log(`Scale up to ${recommendations.recommendedAgentCount} agents`);
}
```

## Examples

### Web Scraper Swarm

Spawn ephemeral scrapers on-demand:

```bash
npm run example:scraper
```

### Data Processing Pipeline

Sequential processing stages with memory sharing:

```bash
npm run example:pipeline
```

### Cost Comparison

Compare persistent vs ephemeral costs:

```bash
npm run example:cost
```

## Performance

### Benchmarks

Run performance benchmarks:

```bash
# Spawn performance (<50ms target)
npm run benchmark

# Load test (10K spawns/second target)
npm run benchmark:load
```

### Performance Requirements

| Metric | Target | Actual |
|--------|--------|--------|
| Spawn Time (P95) | <50ms | ~15-30ms |
| Memory Write | <10ms | ~2-5ms |
| Memory Read (cached) | <5ms | ~0.5-2ms |
| Memory Read (DB) | <50ms | ~10-20ms |
| Resource Savings | 90%+ | 90-98% |
| Throughput | 10K spawns/sec | 5K-15K/sec |

## API Reference

### EphemeralAgentManager

#### Methods

- `spawnAgent(type, task, options?)` - Spawn ephemeral agent
- `terminateAgent(agentId)` - Terminate agent
- `executeTask(type, task, executor, options?)` - Spawn, execute, terminate
- `getMemory(agentId, key)` - Read memory
- `setMemory(agentId, key, value)` - Write memory
- `searchMemories(agentId, query, k?)` - Semantic search
- `listActiveAgents()` - Get all active agents
- `getResourceStats()` - Get statistics
- `exportMetrics()` - Export for monitoring
- `shutdown()` - Cleanup all resources

#### Events

- `agent:spawned` - Agent spawned
- `agent:terminated` - Agent terminated
- `lifecycle` - Lifecycle event
- `alert` - Resource alert

### Configuration

```typescript
interface EphemeralAgentManagerConfig {
  tenantId: string;
  dbPath?: string;
  lifecycle?: {
    defaultTTL?: number; // milliseconds
    checkInterval?: number;
    gracePeriod?: number;
    enableAutoCleanup?: boolean;
  };
  sync?: {
    batchSize?: number;
    batchInterval?: number;
    cacheSize?: number;
    cacheTTL?: number;
  };
  monitor?: {
    persistentAgentCostPerHour?: number;
    ephemeralAgentCostPerHour?: number;
    cpuThreshold?: number;
    memoryThreshold?: number;
  };
}
```

## Monitoring

### Grafana Dashboard

Import the dashboard template:

```bash
cat config/grafana-dashboard.json | \
  curl -X POST http://localhost:3000/api/dashboards/db \
    -H "Content-Type: application/json" \
    -d @-
```

### Metrics Export

Export metrics for Prometheus/Grafana:

```typescript
// Export every 10 seconds
setInterval(() => {
  const metrics = manager.exportMetrics();

  // Send to monitoring system
  prometheus.gauge('ephemeral_agents_active', metrics.manager.activeAgents);
  prometheus.gauge('ephemeral_agents_spawns_total', metrics.monitor.aggregated.totalSpawns);
  prometheus.gauge('ephemeral_cost_savings_percent', metrics.costSavings.savingsPercent);
}, 10000);
```

## Use Cases

### ✅ Best For

- API request handlers
- Webhook processors
- Batch jobs
- Data pipelines
- Web scrapers
- Background tasks
- Scheduled jobs

### ❌ Not Ideal For

- Long-running services
- Real-time streaming
- WebSocket servers
- Continuous monitoring
- Always-on services

### Break-Even Point

Ephemeral agents are cost-effective when uptime is <10%.

## Cost Savings

### Example: API Webhook Handler

```
Scenario: 100 webhooks/hour, 500ms processing time

Persistent Agent:
- Cost: $0.10/hour × 24 hours = $2.40/day
- Uptime: 100%

Ephemeral Agents:
- Active time: 100 webhooks × 500ms = 50 seconds/hour
- Uptime: 1.4%
- Cost: $0.01/hour × 0.014 × 24 hours = $0.0034/day
- Savings: 99.86% ($2.40 → $0.0034)
```

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm test
npm run test:coverage
```

### Lint

```bash
npm run lint
```

## Integration

### With Federation Hub

```typescript
import { FederationHub } from '@agentic-flow/federation';
import { EphemeralAgentManager } from '@agentic-flow/ephemeral-memory';

const hub = new FederationHub({
  endpoint: 'quic://localhost:5000'
});

const manager = new EphemeralAgentManager({
  tenantId: 'federated-app'
});

// Agents automatically sync with hub
```

### With AgentDB

```typescript
import { AgentDB } from 'agentdb';
import { MemoryPersistenceLayer } from '@agentic-flow/ephemeral-memory';

const db = new AgentDB({ dbPath: './memory.db' });

const persistence = new MemoryPersistenceLayer({
  tenantId: 'my-app',
  dbPath: './memory.db'
});
```

## Troubleshooting

### Spawn Time > 50ms

- Check database performance
- Reduce memory preload size
- Disable memory consolidation
- Use in-memory database for testing

### Memory Not Persisting

- Ensure sync is flushed before shutdown
- Check database write permissions
- Verify tenant isolation

### Resource Alerts

```typescript
manager.on('alert', (alert) => {
  if (alert.type === 'memory' && alert.severity === 'critical') {
    // Scale up or optimize memory usage
  }
});
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## License

MIT

## Support

- Documentation: https://github.com/ruvnet/agentic-flow
- Issues: https://github.com/ruvnet/agentic-flow/issues
- Discord: https://discord.gg/agentic-flow
