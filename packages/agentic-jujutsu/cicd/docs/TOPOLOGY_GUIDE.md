# Coordination Topology Guide

Complete guide to selecting and optimizing coordination topologies for your CI/CD workflows.

## 📋 Table of Contents

- [Overview](#overview)
- [Available Topologies](#available-topologies)
- [Decision Matrix](#decision-matrix)
- [Performance Characteristics](#performance-characteristics)
- [Use Case Examples](#use-case-examples)
- [Optimization Guide](#optimization-guide)
- [API Reference](#api-reference)

## 🎯 Overview

The CI/CD module supports **5 different coordination topologies**, each optimized for specific workflow characteristics:

| Topology | Best For | Parallelism | Fault Tolerance | Complexity |
|----------|----------|-------------|-----------------|------------|
| **Sequential** | Dependencies, simple tasks | None | Low | Very Low |
| **Mesh** | Independent tasks, distributed | High | Very High | Medium |
| **Hierarchical** | Complex workflows, supervision | Medium | Medium | Low |
| **Adaptive** | Variable workloads, learning | Auto | High | Low |
| **Gossip** | Large scale (100+ tasks) | Very High | Very High | High |

## 🏗️ Available Topologies

### 1. Sequential Topology

**Characteristics:**
- ✅ Tasks execute one at a time in order
- ✅ Simple, predictable execution
- ✅ Easy debugging and tracing
- ✅ Perfect for dependent tasks
- ❌ No parallelism
- ❌ Slow for independent tasks

**When to Use:**
- Tasks have dependencies (task B needs task A's output)
- Few tasks (≤ 3)
- Debugging workflow issues
- Simple CI/CD pipelines

**Example:**
```javascript
const { EnhancedOrchestrator } = require('@agentic-jujutsu/cicd');

const orchestrator = new EnhancedOrchestrator({
  topology: 'sequential'
});

await orchestrator.executeWorkflow({
  name: 'deployment-pipeline',
  steps: [
    { name: 'build', action: async () => buildApp() },
    { name: 'test', action: async () => runTests() },
    { name: 'deploy', action: async () => deployApp() }
  ]
});
```

### 2. Mesh Topology

**Characteristics:**
- ✅ Peer-to-peer coordination (no central controller)
- ✅ Lock-free operations (23x faster than Git)
- ✅ High fault tolerance (majority voting)
- ✅ Excellent for distributed systems
- ❌ Overhead for small task sets
- ❌ Eventually consistent

**When to Use:**
- Many independent tasks (≥ 5)
- Homogeneous workload (all tasks similar)
- Need fault tolerance
- Distributed CI/CD across multiple runners

**Example:**
```javascript
await orchestrator.executeWorkflow({
  name: 'parallel-tests',
  steps: [
    { name: 'unit-tests', action: async () => runUnitTests() },
    { name: 'integration-tests', action: async () => runIntegrationTests() },
    { name: 'e2e-tests', action: async () => runE2ETests() },
    { name: 'security-scan', action: async () => securityScan() },
    { name: 'performance-test', action: async () => perfTest() }
  ]
}, { topology: 'mesh' });
```

### 3. Hierarchical Topology (Queen-Led)

**Characteristics:**
- ✅ Central queen coordinates worker agents
- ✅ Task delegation and specialization
- ✅ Automatic retry logic
- ✅ Supervised execution
- ❌ Queen can be bottleneck
- ❌ Medium parallelism (respects maxConcurrent)

**When to Use:**
- Complex heterogeneous tasks
- Need supervision and retries
- Different task types requiring specialization
- CI/CD with error recovery

**Example:**
```javascript
await orchestrator.executeWorkflow({
  name: 'multi-platform-build',
  steps: [
    { name: 'build-linux', action: async () => buildLinux(), priority: 'high' },
    { name: 'build-macos', action: async () => buildMacOS(), priority: 'high' },
    { name: 'build-windows', action: async () => buildWindows(), priority: 'medium' },
    { name: 'build-docker', action: async () => buildDocker(), priority: 'medium' },
    { name: 'upload-artifacts', action: async () => uploadAll(), priority: 'low' }
  ]
}, { topology: 'hierarchical' });
```

### 4. Adaptive Topology

**Characteristics:**
- ✅ Automatically selects best topology
- ✅ Learns from execution history
- ✅ Self-optimizing over time
- ✅ Handles variable workloads
- ❌ Selection overhead
- ❌ Needs warmup period for learning

**When to Use:**
- Unknown or variable workloads
- Want automatic optimization
- Long-running CI/CD systems that can learn
- Don't want to manually select topology

**Example:**
```javascript
const orchestrator = new EnhancedOrchestrator({
  topology: 'adaptive'  // Will auto-select best topology
});

// First run: analyzes tasks and selects topology
await orchestrator.executeWorkflow(workflow1);

// Second run: learns from first run, may switch topology
await orchestrator.executeWorkflow(workflow2);

// Over time: converges to optimal topology for your workload
```

### 5. Gossip Topology

**Characteristics:**
- ✅ Eventually consistent state propagation
- ✅ Excellent scalability (1000+ agents)
- ✅ Network partition tolerant
- ✅ Epidemic-style information spread
- ❌ Eventual consistency (not immediate)
- ❌ Convergence delay

**When to Use:**
- Large scale (50+ tasks)
- Can tolerate eventual consistency
- Need partition tolerance
- Distributed CI/CD across regions

**Example:**
```javascript
// Large-scale testing across 100 test suites
const testSuites = Array.from({ length: 100 }, (_, i) => ({
  name: `test-suite-${i}`,
  action: async () => runTestSuite(i)
}));

await orchestrator.executeWorkflow({
  name: 'massive-test-run',
  steps: testSuites
}, { topology: 'gossip' });
```

## 🎯 Decision Matrix

### Quick Selection Guide

```
Task Count?
  ├─ ≤ 3 tasks → Sequential
  ├─ 4-10 tasks → Check dependencies
  │   ├─ Has dependencies → Sequential
  │   ├─ No dependencies, homogeneous → Mesh
  │   └─ No dependencies, heterogeneous → Hierarchical
  ├─ 11-50 tasks → Adaptive or Mesh
  └─ > 50 tasks → Gossip or Adaptive
```

### Detailed Decision Matrix

| Criteria | Sequential | Mesh | Hierarchical | Adaptive | Gossip |
|----------|-----------|------|--------------|----------|--------|
| **Task Count** | ≤ 3 | 5-20 | 5-30 | Any | 50+ |
| **Dependencies** | ✅ Yes | ❌ No | ⚠️ Some | ✅ Any | ❌ No |
| **Homogeneity** | Any | ✅ Yes | ❌ No | Any | ✅ Yes |
| **Failure Rate** | Low | Medium | ✅ High | Medium | ✅ High |
| **Consistency** | ✅ Strong | ⚠️ Eventual | ✅ Strong | Varies | ⚠️ Eventual |
| **Latency** | High | Low | Medium | Varies | Medium |
| **Throughput** | Low | ✅ High | Medium | ✅ High | ✅ Very High |
| **Debugging** | ✅ Easy | Medium | ✅ Easy | Medium | Hard |

## 📊 Performance Characteristics

### Speed (Lower is Better)

**Small Workload (3 tasks):**
- Sequential: ~100ms
- Hierarchical: ~50ms
- Mesh: ~40ms
- Adaptive: ~45ms
- Gossip: ~60ms

**Medium Workload (10 tasks):**
- Sequential: ~500ms
- Hierarchical: ~150ms
- Mesh: ~100ms
- Adaptive: ~110ms
- Gossip: ~120ms

**Large Workload (50 tasks):**
- Sequential: ~2500ms
- Hierarchical: ~600ms
- Mesh: ~300ms
- Adaptive: ~280ms
- Gossip: ~250ms ✅

### Fault Tolerance (Higher is Better)

- Sequential: 40% (stops on first failure)
- Hierarchical: 75% (retries transient failures)
- Mesh: 85% (majority voting, consensus)
- Adaptive: 80% (depends on selected topology)
- Gossip: 90% (epidemic spread, partition tolerant)

### Scalability (Tasks Supported)

- Sequential: 1-10 tasks
- Hierarchical: 5-50 tasks
- Mesh: 5-100 tasks
- Adaptive: 1-1000 tasks
- Gossip: 10-10,000+ tasks ✅

## 💡 Use Case Examples

### Example 1: Basic CI/CD Pipeline

**Scenario:** Build → Test → Deploy (dependencies)

**Best Topology:** Sequential

**Reason:** Each step depends on the previous one completing successfully.

```javascript
await orchestrator.executeWorkflow({
  name: 'basic-cicd',
  steps: [
    { name: 'install', action: async () => npmInstall() },
    { name: 'build', action: async () => npmBuild() },
    { name: 'test', action: async () => npmTest() },
    { name: 'deploy', action: async () => deployToProduction() }
  ]
}, { topology: 'sequential' });
```

### Example 2: Multi-Platform Test Matrix

**Scenario:** Test on Linux, macOS, Windows in parallel

**Best Topology:** Mesh

**Reason:** Independent tests, homogeneous tasks, need fault tolerance.

```javascript
await orchestrator.executeWorkflow({
  name: 'test-matrix',
  steps: [
    { name: 'test-linux', action: async () => testOnLinux() },
    { name: 'test-macos', action: async () => testOnMacOS() },
    { name: 'test-windows', action: async () => testOnWindows() }
  ]
}, { topology: 'mesh' });
```

### Example 3: Complex Multi-Service Deployment

**Scenario:** Deploy frontend, backend, database, cache with different priorities

**Best Topology:** Hierarchical

**Reason:** Heterogeneous tasks, need supervision, different priorities.

```javascript
await orchestrator.executeWorkflow({
  name: 'service-deployment',
  steps: [
    { name: 'deploy-db', action: async () => deployDB(), priority: 'high' },
    { name: 'deploy-cache', action: async () => deployCache(), priority: 'high' },
    { name: 'deploy-backend', action: async () => deployBackend(), priority: 'medium' },
    { name: 'deploy-frontend', action: async () => deployFrontend(), priority: 'low' },
    { name: 'health-check', action: async () => healthCheck(), priority: 'low' }
  ]
}, { topology: 'hierarchical' });
```

### Example 4: Unknown Workload

**Scenario:** CI/CD that runs different workflows each time

**Best Topology:** Adaptive

**Reason:** Variable characteristics, let system learn optimal approach.

```javascript
const orchestrator = new EnhancedOrchestrator({
  topology: 'adaptive',
  enableLearning: true
});

// System will learn and optimize over time
await orchestrator.executeWorkflow(variableWorkflow);
```

### Example 5: Massive Distributed Testing

**Scenario:** 500 test suites across multiple regions

**Best Topology:** Gossip

**Reason:** Large scale, eventual consistency acceptable.

```javascript
const testSuites = Array.from({ length: 500 }, (_, i) => ({
  name: `suite-${i}`,
  action: async () => runTestSuite(i)
}));

await orchestrator.executeWorkflow({
  name: 'massive-tests',
  steps: testSuites
}, { topology: 'gossip', context: { gossipFanout: 4 } });
```

## ⚡ Optimization Guide

### Sequential Topology Optimization

```javascript
// Already optimal for dependencies
// Consider switching if tasks are independent
const recommendation = await orchestrator.topologyManager.recommendTopology(tasks);
```

### Mesh Topology Optimization

```javascript
// Reduce mesh density for large task sets
const mesh = new MeshTopology({
  maxConcurrent: 10,  // Limit concurrent peers
  partialMesh: true   // Don't connect every peer
});
```

### Hierarchical Topology Optimization

```javascript
// Adjust worker pool size
const hierarchical = new HierarchicalTopology({
  maxConcurrent: 5,   // More workers = faster, but more overhead
  retryTransient: true // Enable retries for transient errors
});
```

### Adaptive Topology Optimization

```javascript
// Give it time to learn (10+ executions)
// Check which topology it's selecting
const stats = orchestrator.topologyManager.getStats();
console.log('Most used:', stats.mostUsedTopology);

// If converged, use that topology directly
if (stats.topologyUsage[stats.mostUsedTopology] > 0.8) {
  // Use mostUsedTopology directly for better performance
}
```

### Gossip Topology Optimization

```javascript
// Tune gossip parameters
const gossip = new GossipTopology({
  gossipFanout: 3,      // How many peers to gossip to (3-5 optimal)
  gossipInterval: 100   // ms between rounds (lower = faster convergence)
});
```

## 📚 API Reference

### EnhancedOrchestrator

```javascript
const orchestrator = new EnhancedOrchestrator({
  topology: 'adaptive',    // Default topology
  enableAST: true,         // Enable AST analysis
  enableLearning: true,    // Enable ReasoningBank
  maxParallel: 5          // Max concurrent tasks
});

// Execute workflow
await orchestrator.executeWorkflow(workflow, {
  topology: 'mesh',        // Override default
  context: { custom: 'data' }
});

// Benchmark all topologies
const benchmark = await orchestrator.benchmark(workflow);
console.log('Winner:', benchmark.winner.topology);

// Get optimizations
const opts = await orchestrator.getOptimizations(workflow);
```

### TopologyManager

```javascript
const manager = new TopologyManager({
  defaultTopology: 'adaptive',
  maxConcurrent: 10
});

// Execute with specific topology
await manager.execute(tasks, { topology: 'mesh' });

// Get recommendation
const rec = manager.recommendTopology(tasks);
console.log('Best topology:', rec.bestTopology);
console.log('Reasons:', rec.recommendations[0].reasons);

// Benchmark all
const results = await manager.benchmark(tasks);
```

## 🎓 Best Practices

1. **Start with Adaptive** - Let the system learn your workload
2. **Monitor Performance** - Track execution times and success rates
3. **Consider Dependencies** - Sequential for dependent tasks, parallel for independent
4. **Scale Appropriately** - Use Gossip for 50+ tasks
5. **Enable Learning** - ReasoningBank improves over time
6. **Benchmark First** - Test before production deployment

## 📈 Performance Tips

- **Small tasks (<5):** Use Sequential to avoid coordination overhead
- **Medium tasks (5-20):** Use Mesh or Hierarchical
- **Large tasks (20-50):** Use Adaptive or Mesh
- **Massive tasks (50+):** Use Gossip
- **Dependencies:** Always use Sequential
- **Heterogeneous:** Prefer Hierarchical
- **Fault-prone:** Use Mesh or Gossip (high fault tolerance)

## 🔍 Debugging

Enable verbose logging to see topology decisions:

```javascript
const orchestrator = new EnhancedOrchestrator({
  topology: 'adaptive',
  verbose: true  // Logs all topology decisions
});

// Check stats after execution
const stats = await orchestrator.getStats();
console.log('Topology used:', stats.enhanced.topologiesUsed);
```

## 📊 Metrics to Track

- **Execution Duration:** Total time for workflow
- **Success Rate:** Percentage of successful tasks
- **Topology Usage:** Which topology is selected most
- **Convergence Time:** (Gossip only) Time to reach consistency
- **Queen Decisions:** (Hierarchical only) Number of strategic decisions
- **Consensus Rate:** (Mesh only) Percentage agreement among peers

---

**Next Steps:**
- See [EXAMPLES.md](EXAMPLES.md) for complete code examples
- See [README.md](README.md) for installation and setup
- See [OPTIMIZATION_REPORT.md](OPTIMIZATION_REPORT.md) for performance details
