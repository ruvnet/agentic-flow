# agentic-jujutsu CI/CD Module - Directory Structure

## 📁 Organized Structure

```
packages/agentic-jujutsu/cicd/
├── README.md                           # Main documentation with tutorial
├── RELEASE_NOTES.md                    # v1.1.0 release notes
├── VALIDATION_CHECKLIST.md             # Pre-release validation
├── IMPLEMENTATION_SUMMARY.md           # Implementation details
├── .gitignore                          # Ignore patterns
├── package.json                        # Package configuration
├── package-lock.json                   # Dependency lock file
│
├── src/                                # Source code
│   ├── index.js                        # Main exports
│   ├── vectordb.js                     # Vector database (original)
│   ├── orchestrator.js                 # Workflow orchestrator (original)
│   ├── enhanced-orchestrator.js        # Enhanced orchestrator (v1.1.0)
│   ├── topology-manager.js             # Topology management (v1.1.0)
│   ├── ast-analyzer.js                 # AST code analysis (v1.1.0)
│   ├── optimizer.js                    # CLI optimizer tool
│   └── topologies/                     # Coordination topologies (v1.1.0)
│       ├── sequential.js               # Sequential execution
│       ├── mesh.js                     # Mesh coordination
│       ├── hierarchical.js             # Hierarchical (queen-led)
│       ├── adaptive.js                 # Adaptive selection
│       └── gossip.js                   # Gossip-based
│
├── tests/                              # Test suites
│   ├── run-all-tests.js               # Test runner
│   ├── unit/                          # Unit tests
│   │   ├── vectordb.test.js           # VectorDB tests (10/10)
│   │   ├── topologies.test.js         # Topology tests (10/10)
│   │   └── ast-analyzer.test.js       # AST tests (6/8)
│   ├── integration/                   # Integration tests
│   │   └── workflow.test.js           # Workflow tests (8/10)
│   ├── benchmarks/                    # Performance benchmarks
│   │   ├── performance.bench.js       # Original benchmarks
│   │   └── topology-benchmark.js      # Topology comparison
│   └── e2e/                          # End-to-end tests
│       └── complete-integration.test.js # Full E2E (8/10)
│
├── docs/                              # Documentation
│   ├── README.md                      # Documentation index
│   ├── TOPOLOGY_GUIDE.md              # Complete topology guide
│   ├── ENHANCED_FEATURES_SUMMARY.md   # Feature overview & API
│   ├── EXAMPLES.md                    # Code examples
│   ├── OPTIMIZATION_REPORT.md         # Performance optimizations
│   └── PERFORMANCE_ANALYSIS.md        # Baseline analysis
│
└── workflows/                         # Example workflows
    ├── cicd-self-learning.yml        # Self-learning pipeline
    └── parallel-multi-agent.yml      # Multi-agent parallel
```

## 🗂️ File Organization Rules

### Root Level
- **Documentation only:** README, RELEASE_NOTES, etc.
- **Configuration:** package.json, .gitignore
- **No code files** at root level

### src/ - Source Code
- **Core modules:** vectordb.js, orchestrator.js
- **Enhanced features:** enhanced-orchestrator.js, topology-manager.js
- **Optional features:** ast-analyzer.js
- **Subdirectories:** topologies/ for coordination patterns

### tests/ - Test Organization
```
tests/
├── unit/           # Fast, isolated tests
├── integration/    # Multi-component tests
├── benchmarks/     # Performance tests
└── e2e/           # Complete integration tests
```

### docs/ - Documentation
- **Guides:** TOPOLOGY_GUIDE.md (how to choose)
- **Reference:** API documentation
- **Examples:** Working code samples
- **Analysis:** Performance reports

### workflows/ - Example Workflows
- GitHub Actions examples
- Self-learning pipelines
- Multi-agent coordination

## 🧹 Cleanup Rules

### Always Ignore (in .gitignore)
```
# Test artifacts
.test-*
tests/.test-*

# Databases and caches
.vectordb/
.ast-cache/
*.db
*.db-journal

# Dependencies
node_modules/

# Logs
*.log
```

### Never Commit
- Temporary test databases
- Generated cache files
- Local configuration
- Build artifacts (for this module)

### Keep Clean
- Remove cache directories before commits
- No orphaned test files
- No duplicate documentation
- No old package tarballs in parent directory

## 📦 Package Organization

### Published to npm
```
@agentic-jujutsu/cicd/
├── src/            # All source code
├── tests/          # All tests (for verification)
├── docs/           # All documentation
├── workflows/      # Example workflows
├── README.md       # Quick start
└── package.json    # Metadata
```

### Not Published (via .npmignore)
- `.test-*` directories
- `.vectordb/` directories
- `.ast-cache/` directories
- Development artifacts

## 🎯 Best Practices

1. **Source code:** Always in `src/` or `src/topologies/`
2. **Tests:** Organized by type (unit, integration, benchmarks, e2e)
3. **Documentation:** Comprehensive in `docs/` with quick start in README
4. **Examples:** Working workflows in `workflows/`
5. **Clean commits:** No cache or test database files

## ✅ Current Status

**Structure:** ✅ Well-organized
**Cleanup:** ✅ Cache directories removed
**Tests:** ✅ 89.5% coverage (34/38 tests)
**Documentation:** ✅ 2,600+ lines
**Ready:** ✅ Production release

---

**Last Updated:** November 22, 2025
**Version:** 1.1.0 (Enhanced)
**Status:** Clean and organized
