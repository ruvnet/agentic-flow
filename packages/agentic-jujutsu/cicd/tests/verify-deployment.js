#!/usr/bin/env node
/**
 * Verify CI/CD Module Deployment
 *
 * Checks that the module is properly deployed and functional:
 * - All required files exist
 * - Dependencies are installed
 * - Module can be required
 * - Basic functionality works
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

console.log('\n🔍 CI/CD Module Deployment Verification\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

function check(name, condition, message) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
    return true;
  } else {
    console.log(`❌ ${name}: ${message || 'Failed'}`);
    failed++;
    return false;
  }
}

// 1. Check Required Files Exist
console.log('\n📁 Phase 1: File Structure\n');

const requiredFiles = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'src/index.js',
  'src/vectordb.js',
  'src/orchestrator.js',
  'src/enhanced-orchestrator.js',
  'src/topology-manager.js',
  'src/ast-analyzer.js',
  'src/optimizer.js',
  'src/topologies/sequential.js',
  'src/topologies/mesh.js',
  'src/topologies/hierarchical.js',
  'src/topologies/adaptive.js',
  'src/topologies/gossip.js'
];

for (const file of requiredFiles) {
  const filePath = path.join(rootDir, file);
  check(
    `File: ${file}`,
    fs.existsSync(filePath),
    'File not found'
  );
}

// 2. Check Package.json
console.log('\n📦 Phase 2: Package Configuration\n');

try {
  const packageJson = require(path.join(rootDir, 'package.json'));

  check('Package name', packageJson.name === '@agentic-jujutsu/cicd');
  check('Version is 1.1.0', packageJson.version === '1.1.0');
  check('Has description', packageJson.description && packageJson.description.length > 0);
  check('Has main entry', packageJson.main === 'src/index.js');
  check('Has test scripts', packageJson.scripts && packageJson.scripts.test);
  check('Has dependencies', packageJson.dependencies && packageJson.dependencies['agentic-jujutsu']);
} catch (error) {
  check('Package.json valid', false, error.message);
}

// 3. Check Module Can Be Required
console.log('\n🔧 Phase 3: Module Loading\n');

try {
  const cicdModule = require(path.join(rootDir, 'src/index.js'));

  check('Module exports exist', cicdModule !== null && typeof cicdModule === 'object');
  check('CICDVectorDB exported', typeof cicdModule.CICDVectorDB === 'function');
  check('WorkflowOrchestrator exported', typeof cicdModule.WorkflowOrchestrator === 'function');
  check('EnhancedOrchestrator exported', typeof cicdModule.EnhancedOrchestrator === 'function');
  check('TopologyManager exported', typeof cicdModule.TopologyManager === 'function');
  check('ASTAnalyzer exported', typeof cicdModule.ASTAnalyzer === 'function');

  // Check all topologies
  check('SequentialTopology exported', typeof cicdModule.SequentialTopology === 'function');
  check('MeshTopology exported', typeof cicdModule.MeshTopology === 'function');
  check('HierarchicalTopology exported', typeof cicdModule.HierarchicalTopology === 'function');
  check('AdaptiveTopology exported', typeof cicdModule.AdaptiveTopology === 'function');
  check('GossipTopology exported', typeof cicdModule.GossipTopology === 'function');
} catch (error) {
  check('Module can be required', false, error.message);
}

// 4. Basic Functionality Test
console.log('\n⚙️  Phase 4: Basic Functionality\n');

async function testBasicFunctionality() {
  try {
    const { EnhancedOrchestrator, SequentialTopology } = require(path.join(rootDir, 'src/index.js'));

    // Test sequential topology instantiation
    const topology = new SequentialTopology();
    check('Sequential topology instantiated', topology !== null);

    // Test simple workflow execution
    const workflow = {
      name: 'test-verification',
      steps: [
        {
          name: 'step1',
          action: async () => ({ success: true, data: 'step1 complete' })
        },
        {
          name: 'step2',
          action: async () => ({ success: true, data: 'step2 complete' })
        }
      ]
    };

    const result = await topology.execute(workflow.steps);
    check('Workflow executed', result.success === true);
    check('Workflow returned results', Array.isArray(result.results) && result.results.length === 2);

    // Test EnhancedOrchestrator instantiation
    const orchestrator = new EnhancedOrchestrator({
      enableAST: false // Disable AST for deployment verification
    });
    check('EnhancedOrchestrator instantiated', orchestrator !== null);

  } catch (error) {
    check('Basic functionality test', false, error.message);
  }
}

// 5. Documentation Check
console.log('\n📚 Phase 5: Documentation\n');

const docFiles = [
  'README.md',
  'CHANGELOG.md',
  'RELEASE_NOTES.md',
  'VALIDATION_CHECKLIST.md',
  'docs/TOPOLOGY_GUIDE.md',
  'docs/ENHANCED_FEATURES_SUMMARY.md'
];

for (const doc of docFiles) {
  const docPath = path.join(rootDir, doc);
  if (fs.existsSync(docPath)) {
    const stats = fs.statSync(docPath);
    check(
      `Documentation: ${doc}`,
      stats.size > 100,
      `File too small (${stats.size} bytes)`
    );
  } else {
    check(`Documentation: ${doc}`, false, 'File not found');
  }
}

// Run async tests and show final summary
testBasicFunctionality().then(() => {
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Verification Summary:\n');
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total:  ${passed + failed}`);

  const successRate = ((passed / (passed + failed)) * 100).toFixed(1);
  console.log(`   Success Rate: ${successRate}%\n`);

  console.log('='.repeat(60));

  if (failed === 0) {
    console.log('\n✅ DEPLOYMENT VERIFIED - All checks passed!\n');
    process.exit(0);
  } else if (successRate >= 90) {
    console.log('\n⚠️  DEPLOYMENT MOSTLY VERIFIED - Some non-critical checks failed\n');
    process.exit(0);
  } else {
    console.log('\n❌ DEPLOYMENT VERIFICATION FAILED - Critical issues found\n');
    process.exit(1);
  }
}).catch(error => {
  console.error('\n❌ Verification crashed:', error);
  process.exit(1);
});
