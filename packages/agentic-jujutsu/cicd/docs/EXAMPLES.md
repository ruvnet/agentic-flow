# CI/CD Module Examples

## Example 1: Basic Workflow Execution

```javascript
const { WorkflowOrchestrator } = require('@agentic-jujutsu/cicd');

async function basicExample() {
  const orchestrator = new WorkflowOrchestrator();
  await orchestrator.initialize();

  const result = await orchestrator.executeWorkflow({
    name: 'simple-build',
    steps: [
      {
        name: 'install',
        action: async () => {
          console.log('Installing dependencies...');
          // npm install logic
          return 'Dependencies installed';
        }
      },
      {
        name: 'build',
        action: async () => {
          console.log('Building project...');
          // build logic
          return 'Build successful';
        }
      },
      {
        name: 'test',
        action: async () => {
          console.log('Running tests...');
          // test logic
          return 'All tests passed';
        }
      }
    ]
  });

  console.log('Workflow result:', result);
  await orchestrator.cleanup();
}

basicExample();
```

## Example 2: Learning from Multiple Runs

```javascript
const { CICDVectorDB } = require('@agentic-jujutsu/cicd');

async function learningExample() {
  const db = new CICDVectorDB();
  await db.initialize();

  // Simulate 10 workflow runs
  for (let i = 0; i < 10; i++) {
    await db.storeWorkflow({
      name: 'learning-workflow',
      duration: 3000 + Math.random() * 2000,
      success: Math.random() > 0.1, // 90% success rate
      steps: ['build', 'test', 'deploy'],
      metrics: {
        cacheHits: Math.floor(Math.random() * 10),
        coverage: 80 + Math.random() * 15
      }
    });
  }

  // Get optimizations after learning
  const optimizations = await db.getOptimizations({
    name: 'learning-workflow',
    duration: 4000,
    steps: ['build', 'test', 'deploy']
  });

  console.log('\\nLearning Results:');
  console.log('Recommendations:', optimizations.recommendations.length);
  console.log('Confidence:', (optimizations.confidence * 100).toFixed(1) + '%');
  console.log('Based on:', optimizations.basedOn, 'workflows');

  optimizations.recommendations.forEach((rec, i) => {
    console.log(`\\n${i + 1}. [${rec.priority.toUpperCase()}] ${rec.message}`);
    console.log(`   Expected: ${rec.expectedImprovement}`);
  });

  await db.cleanup();
}

learningExample();
```

## Example 3: Parallel Multi-Agent Execution

```javascript
const { WorkflowOrchestrator } = require('@agentic-jujutsu/cicd');

async function parallelExample() {
  const orchestrator = new WorkflowOrchestrator({
    maxParallel: 5,
    enableLearning: true
  });

  await orchestrator.initialize();

  const result = await orchestrator.executeWorkflow({
    name: 'parallel-analysis',
    steps: [
      { name: 'security-scan', action: async () => 'Security: PASS' },
      { name: 'performance-test', action: async () => 'Performance: PASS' },
      { name: 'code-quality', action: async () => 'Quality: PASS' },
      { name: 'test-coverage', action: async () => 'Coverage: 95%' },
      { name: 'documentation', action: async () => 'Docs: Updated' }
    ]
  });

  console.log(`\\nParallel execution completed in ${result.duration}ms`);
  console.log('All agents:', result.steps.map(s => s.name).join(', '));

  await orchestrator.cleanup();
}

parallelExample();
```

## Example 4: Custom Metrics and Analytics

```javascript
const { CICDVectorDB } = require('@agentic-jujutsu/cicd');

async function analyticsExample() {
  const db = new CICDVectorDB();
  await db.initialize();

  // Store workflow with custom metrics
  const workflowId = await db.storeWorkflow({
    name: 'advanced-pipeline',
    duration: 5000,
    success: true,
    steps: ['lint', 'build', 'test', 'package', 'deploy'],
    metrics: {
      cacheHits: 8,
      cacheMisses: 2,
      parallelJobs: 4,
      cpuUsage: 85,
      memoryUsage: 4096,
      testCount: 250,
      coverage: 92.5,
      lintErrors: 0,
      buildSize: 1024 * 1024 * 5, // 5MB
      deployTime: 45000
    },
    tags: ['production', 'release', 'v1.0.0']
  });

  // Store detailed metrics
  await db.storeMetrics(workflowId, {
    timestamp: Date.now(),
    phase: 'build',
    cpuPeak: 95,
    memoryPeak: 5120,
    diskIO: 1500
  });

  await db.storeMetrics(workflowId, {
    timestamp: Date.now(),
    phase: 'test',
    cpuPeak: 70,
    memoryPeak: 3072,
    testsRun: 250
  });

  // Retrieve metrics
  const metrics = await db.getMetrics(workflowId);
  console.log('\\nDetailed Metrics:', metrics);

  // Query similar workflows
  const similar = await db.querySimilar({
    metrics: {
      coverage: 90,
      testCount: 200
    },
    limit: 5,
    threshold: 0.7
  });

  console.log('\\nSimilar Workflows:', similar.length);

  await db.cleanup();
}

analyticsExample();
```

## Example 5: Error Handling and Recovery

```javascript
const { WorkflowOrchestrator } = require('@agentic-jujutsu/cicd');

async function errorHandlingExample() {
  const orchestrator = new WorkflowOrchestrator({
    enableLearning: true
  });

  await orchestrator.initialize();

  try {
    await orchestrator.executeWorkflow({
      name: 'error-prone-workflow',
      steps: [
        { name: 'step1', action: async () => 'Success' },
        {
          name: 'step2',
          action: async () => {
            throw new Error('Network timeout');
          }
        },
        { name: 'step3', action: async () => 'Should not run' }
      ]
    });
  } catch (error) {
    console.log('\\nWorkflow failed:', error.message);

    // Check if there are patterns of similar failures
    const db = orchestrator.vectordb;
    const stats = await db.getStats();

    console.log('\\nLearning from failure...');
    console.log('Patterns identified:', stats.patterns);

    // The orchestrator has learned from this failure
    // Future recommendations will account for it
  }

  await orchestrator.cleanup();
}

errorHandlingExample();
```

## Example 6: GitHub Actions Integration (JavaScript)

```javascript
// .github/scripts/cicd-analysis.js
const { CICDVectorDB } = require('@agentic-jujutsu/cicd');
const fs = require('fs');

async function analyzeCI() {
  const db = new CICDVectorDB({ dbPath: '.vectordb' });
  await db.initialize();

  // Store current run
  await db.storeWorkflow({
    name: 'CI Pipeline',
    duration: parseInt(process.env.GITHUB_RUN_DURATION || '0'),
    success: process.env.GITHUB_RUN_STATUS === 'success',
    steps: process.env.GITHUB_STEPS.split(','),
    metrics: {
      runner: process.env.RUNNER_OS,
      nodeVersion: process.env.NODE_VERSION,
      cacheHit: process.env.CACHE_HIT === 'true'
    }
  });

  // Get recommendations
  const optimizations = await db.getOptimizations({
    name: 'CI Pipeline',
    duration: 5000
  });

  // Write report
  const report = {
    timestamp: new Date().toISOString(),
    recommendations: optimizations.recommendations,
    confidence: optimizations.confidence,
    basedOn: optimizations.basedOn
  };

  fs.writeFileSync('optimization-report.json', JSON.stringify(report, null, 2));
  console.log('📊 Optimization report generated');

  await db.cleanup();
}

analyzeCI().catch(console.error);
```

## Example 7: Real-time Monitoring

```javascript
const { WorkflowOrchestrator } = require('@agentic-jujutsu/cicd');

async function monitoringExample() {
  const orchestrator = new WorkflowOrchestrator();
  await orchestrator.initialize();

  // Execute workflow with progress monitoring
  const result = await orchestrator.executeWorkflow({
    name: 'monitored-workflow',
    steps: [
      {
        name: 'long-running-task',
        action: async () => {
          // Simulate long task with progress
          for (let i = 0; i <= 100; i += 10) {
            await new Promise(r => setTimeout(r, 100));
            console.log(`Progress: ${i}%`);
          }
          return 'Complete';
        }
      }
    ]
  });

  // Get real-time stats
  const stats = await orchestrator.getStats();
  console.log('\\nOrchestrator Stats:');
  console.log('Database workflows:', stats.database.workflows);
  console.log('Active workflows:', stats.activeWorkflows);

  await orchestrator.cleanup();
}

monitoringExample();
```

## Example 8: Custom Optimization Logic

```javascript
const { CICDVectorDB } = require('@agentic-jujutsu/cicd');

class CustomOptimizer {
  constructor(db) {
    this.db = db;
  }

  async analyzeCache() {
    const stats = await this.db.getStats();
    const workflows = Array.from(this.db.cache.workflows.values());

    const avgCacheHits = workflows.reduce((sum, w) =>
      sum + (w.cacheHits || 0), 0) / workflows.length;

    return {
      recommendation: avgCacheHits > 5 ? 'aggressive' : 'conservative',
      avgHits: avgCacheHits
    };
  }

  async findBottlenecks() {
    const workflows = Array.from(this.db.cache.workflows.values());
    const slowSteps = new Map();

    workflows.forEach(w => {
      (w.steps || []).forEach(step => {
        const current = slowSteps.get(step.name) || { total: 0, count: 0 };
        slowSteps.set(step.name, {
          total: current.total + (step.duration || 0),
          count: current.count + 1
        });
      });
    });

    const bottlenecks = Array.from(slowSteps.entries())
      .map(([name, data]) => ({
        step: name,
        avgDuration: data.total / data.count
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 5);

    return bottlenecks;
  }
}

async function customOptimizationExample() {
  const db = new CICDVectorDB();
  await db.initialize();

  // Store some workflows
  for (let i = 0; i < 10; i++) {
    await db.storeWorkflow({
      name: `workflow-${i}`,
      duration: 3000,
      success: true,
      steps: ['build', 'test', 'deploy'],
      cacheHits: Math.floor(Math.random() * 10)
    });
  }

  const optimizer = new CustomOptimizer(db);

  const cacheAnalysis = await optimizer.analyzeCache();
  console.log('\\nCache Analysis:', cacheAnalysis);

  const bottlenecks = await optimizer.findBottlenecks();
  console.log('\\nBottlenecks:', bottlenecks);

  await db.cleanup();
}

customOptimizationExample();
```

---

## Running Examples

```bash
# Save any example to a file, e.g., example1.js
node example1.js

# Or run directly
node -e "$(cat EXAMPLES.md | grep -A 30 'Example 1')"
```

## Next Steps

1. Check the main [README.md](README.md) for full API documentation
2. Run the test suite: `npm test`
3. Explore the GitHub Actions workflows in `workflows/`
4. Review performance benchmarks: `npm run test:benchmark`
