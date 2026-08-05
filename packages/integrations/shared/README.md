# Agentic Flow - Shared Bridges Package

TypeScript bridges connecting agent-booster, reasoningbank, agentdb, and QUIC components for seamless integration in agentic-flow patterns.

## Features

- **AgentBoosterBridge**: Ultra-fast code editing (52x faster than Morph LLM)
- **ReasoningBankBridge**: Reinforcement learning with 9 RL algorithms
- **AgentDBBridge**: Frontier memory features with 150x faster vector search
- **QuicBridge**: High-performance networking with connection pooling

## Performance Targets

| Bridge | Target | Description |
|--------|--------|-------------|
| AgentBooster | <5ms | Overhead per edit operation |
| ReasoningBank | <100ms | Query latency |
| AgentDB | <50ms | Vector search latency |
| QUIC | <10ms | Send operation latency |

## Installation

```bash
npm install @agentic-flow/integrations-shared
```

## Quick Start

### AgentBooster Bridge

```typescript
import { AgentBoosterBridge } from '@agentic-flow/integrations-shared';

const bridge = new AgentBoosterBridge({
  enableASTOptimization: true,
});

await bridge.initialize();

// Edit code
const result = await bridge.edit({
  oldCode: 'const x = 1;',
  newCode: 'const x = 2;',
  language: 'typescript',
});

console.log('Success:', result.success);
console.log('Latency:', result.metrics.latencyMs, 'ms');

// Batch edit
const batchResult = await bridge.batchEdit({
  files: [
    { path: 'file1.ts', oldCode: '...', newCode: '...' },
    { path: 'file2.ts', oldCode: '...', newCode: '...' },
  ],
});

// Parse AST
const astResult = await bridge.parseAST('const x = 1;', 'typescript');
```

### ReasoningBank Bridge

```typescript
import { ReasoningBankBridge, RLAlgorithm } from '@agentic-flow/integrations-shared';

const bridge = new ReasoningBankBridge({
  algorithm: RLAlgorithm.DECISION_TRANSFORMER,
  enableWASM: true,
});

await bridge.initialize();

// Store trajectory for learning
await bridge.storeTrajectory({
  task: 'code-review',
  actions: ['analyze', 'suggest', 'apply'],
  observations: ['low-quality-code', 'improved-code', 'tests-pass'],
  reward: 1.0,
  metadata: { language: 'typescript' },
});

// Query similar trajectories
const queryResult = await bridge.query({
  task: 'code-review',
  topK: 5,
  threshold: 0.7,
});

console.log('Found', queryResult.data?.length, 'similar trajectories');

// Run learning iteration
const learnResult = await bridge.learn(100);
console.log('Learning completed:', learnResult.data);
```

### AgentDB Bridge

```typescript
import { AgentDBBridge } from '@agentic-flow/integrations-shared';

const bridge = new AgentDBBridge({
  dbPath: './my-vectors.db',
  enableWASM: true,
  enableHNSW: true,
});

await bridge.initialize();

// Insert vector
const insertResult = await bridge.insert({
  vector: [0.1, 0.2, 0.3, 0.4],
  metadata: { type: 'code-pattern', language: 'typescript' },
});

console.log('Vector ID:', insertResult.data);

// Search similar vectors
const searchResult = await bridge.search({
  query: [0.15, 0.25, 0.35, 0.45],
  k: 5,
  threshold: 0.7,
  filters: { language: 'typescript' },
});

console.log('Found', searchResult.data?.length, 'similar vectors');
console.log('Search latency:', searchResult.metrics.latencyMs, 'ms');

// Store pattern
await bridge.patternStore({
  pattern: 'async-error-handling',
  category: 'best-practices',
  embedding: [0.1, 0.2, 0.3, 0.4],
});

// Close when done
await bridge.close();
```

### QUIC Bridge

```typescript
import { QuicBridge } from '@agentic-flow/integrations-shared';

const bridge = new QuicBridge({
  host: 'localhost',
  port: 4433,
  poolSize: 5,
  enableTLS: true,
});

await bridge.initialize();

// Send data
const sendResult = await bridge.send(Buffer.from('Hello QUIC!'));
console.log('Sent', sendResult.data, 'bytes');

// Receive data
const receiveResult = await bridge.receive();
console.log('Received:', receiveResult.data?.toString());

// Create bidirectional stream
const streamResult = await bridge.stream(Buffer.from('Stream data'));
console.log('Stream ID:', streamResult.data?.streamId);

// Check connection pool
const connections = bridge.getConnections();
console.log('Active connections:', connections.length);

// Close when done
await bridge.close();
```

## Metrics and Monitoring

All bridges provide detailed metrics:

```typescript
// Get metrics from any bridge
const metrics = bridge.getMetrics();

console.log('Latency:', metrics.latencyMs);
console.log('Success rate:', metrics.successRate);

// AgentBooster specific
console.log('Files processed:', metrics.filesProcessed);
console.log('Lines processed:', metrics.linesProcessed);

// ReasoningBank specific
console.log('Trajectories stored:', metrics.trajectoriesStored);
console.log('Algorithm:', metrics.algorithm);

// AgentDB specific
console.log('Vectors indexed:', metrics.vectorsIndexed);
console.log('Results found:', metrics.resultsFound);

// QUIC specific
console.log('Bytes sent:', metrics.bytesSent);
console.log('Bytes received:', metrics.bytesReceived);
console.log('Active connections:', metrics.activeConnections);

// Reset metrics
bridge.resetMetrics();
```

## Error Handling

All operations return a `BridgeResult` with consistent error handling:

```typescript
const result = await bridge.someOperation();

if (result.success) {
  console.log('Operation succeeded:', result.data);
  console.log('Latency:', result.metrics.latencyMs, 'ms');
} else {
  console.error('Operation failed:', result.error);
  console.log('Time taken:', result.metrics.latencyMs, 'ms');
}
```

Custom error types:

```typescript
import { BridgeError, BridgeErrorCode } from '@agentic-flow/integrations-shared';

try {
  await bridge.someOperation();
} catch (error) {
  if (error instanceof BridgeError) {
    switch (error.code) {
      case BridgeErrorCode.NOT_INITIALIZED:
        console.error('Bridge not initialized');
        break;
      case BridgeErrorCode.TIMEOUT:
        console.error('Operation timed out');
        break;
      case BridgeErrorCode.CONNECTION_FAILED:
        console.error('Connection failed');
        break;
      // ... handle other error codes
    }
  }
}
```

## Configuration

### Common Options

All bridges support these common configuration options:

```typescript
interface BridgeConfig {
  debug?: boolean;          // Enable debug logging (default: false)
  timeoutMs?: number;       // Operation timeout (default: 30000)
  maxRetries?: number;      // Max retry attempts (default: 3)
  retryDelayMs?: number;    // Retry delay (default: 1000)
}
```

### Bridge-Specific Options

Each bridge has additional configuration options. See TypeScript types for details.

## Testing

Run the test suite:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

## Performance Benchmarking

All bridges are optimized for performance:

- **AgentBooster**: WASM acceleration, AST optimization
- **ReasoningBank**: WASM acceleration, efficient RL algorithms
- **AgentDB**: WASM vector search, HNSW indexing (150x faster)
- **QUIC**: Connection pooling, stream multiplexing

## Architecture

```
packages/integrations/shared/
├── src/
│   ├── bridges/
│   │   ├── AgentBoosterBridge.ts
│   │   ├── ReasoningBankBridge.ts
│   │   ├── AgentDBBridge.ts
│   │   ├── QuicBridge.ts
│   │   └── index.ts
│   ├── types/
│   │   ├── common.ts
│   │   ├── metrics.ts
│   │   └── index.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── retry.ts
│   │   ├── validation.ts
│   │   └── index.ts
│   └── index.ts
├── tests/
│   └── bridges.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Integration with Agentic Flow

These bridges are designed to work seamlessly with agentic-flow integration patterns:

- **Byzantine QUIC**: Byzantine fault tolerance over QUIC
- **Consensus Router**: Distributed consensus algorithms
- **CRDT Gossip**: CRDT-based state synchronization
- **Ephemeral Memory**: Temporary agent memory
- **Self-Improving Codegen**: AI-powered code generation

See the main agentic-flow documentation for integration examples.

## Related Components

- [agent-booster](../../agent-booster): Ultra-fast code editing engine
- [reasoningbank](../../../reasoningbank): Reinforcement learning workspace
- [agentdb](../../agentdb): Frontier memory features with MCP
- [agentic-flow-quic](../../../crates/agentic-flow-quic): QUIC protocol implementation

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass (`npm test`)
2. Code follows TypeScript best practices
3. Performance targets are met
4. Documentation is updated

## License

MIT

## Support

- Issues: https://github.com/ruvnet/agentic-flow/issues
- Documentation: https://github.com/ruvnet/agentic-flow
- Discussions: https://github.com/ruvnet/agentic-flow/discussions
