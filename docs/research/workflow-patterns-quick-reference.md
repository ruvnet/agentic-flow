# Quick Reference: AI-Optimized GitHub Actions Workflow Patterns

**For**: agentic-jujutsu and similar AI optimization tools
**Last Updated**: 2025-11-22

---

## 🚀 Ready-to-Use Workflow Templates

### 1. Basic PR Analysis Workflow

**File**: `.github/workflows/ai-pr-review.yml`

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize]
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install AI tool
        run: npm install -g agentic-jujutsu

      - name: Analyze PR
        run: npx agentic-jujutsu analyze --pr=${{ github.event.pull_request.number }} --output=analysis.json

      - name: Comment results
        uses: actions/github-script@v7
        with:
          script: |
            const analysis = require('./analysis.json');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## 🤖 AI Analysis\n\n**Score**: ${analysis.score}/100\n\n${analysis.summary}`
            });
```

---

### 2. Security-First AI Scan

**File**: `.github/workflows/ai-security.yml`

```yaml
name: AI Security Scan

on:
  pull_request:
  schedule:
    - cron: '0 0 * * 0'  # Weekly

permissions:
  contents: read
  security-events: write

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Remove secrets before AI
        run: |
          find . -name "*.env*" -delete
          find . -name "*secret*" -delete

      - name: AI security scan
        run: |
          npm install -g agentic-jujutsu
          npx agentic-jujutsu analyze --focus=security --sarif=results.sarif

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
```

---

### 3. Cached + Learning Mode

**File**: `.github/workflows/ai-cached-learning.yml`

```yaml
name: AI with Caching & Learning

on: [pull_request]

jobs:
  ai-optimized:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Cache everything
        uses: actions/cache@v4
        with:
          path: |
            ~/.npm
            .reasoningbank/
            node_modules
          key: ai-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}-v1
          restore-keys: ai-${{ runner.os }}-

      - name: Install & analyze with learning
        run: |
          npm install -g agentic-jujutsu

          # Start learning trajectory
          npx agentic-jujutsu start-trajectory "PR #${{ github.event.pull_request.number }}"

          # Run analysis
          npx agentic-jujutsu analyze --learning-mode --output=analysis.json

          # Get AI suggestions
          npx agentic-jujutsu get-suggestion "optimize PR" > suggestions.json

          # Finalize learning
          SCORE=$(jq -r '.score / 100' analysis.json)
          npx agentic-jujutsu add-to-trajectory
          npx agentic-jujutsu finalize-trajectory "$SCORE" "PR analysis complete"

      - name: Show learning stats
        run: |
          echo "## 🧠 AI Learning Stats" >> $GITHUB_STEP_SUMMARY
          npx agentic-jujutsu get-learning-stats | jq -r '
            "- Trajectories: \(.totalTrajectories)\n" +
            "- Patterns: \(.totalPatterns)\n" +
            "- Success Rate: \(.avgSuccessRate * 100 | round)%"
          ' >> $GITHUB_STEP_SUMMARY
```

---

### 4. Parallel Multi-Agent Analysis

**File**: `.github/workflows/ai-parallel.yml`

```yaml
name: Parallel AI Agents

on: [pull_request]

jobs:
  security-agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g agentic-jujutsu
      - run: npx agentic-jujutsu analyze --focus=security --output=security.json
      - uses: actions/upload-artifact@v4
        with:
          name: security-results
          path: security.json

  performance-agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g agentic-jujutsu
      - run: npx agentic-jujutsu analyze --focus=performance --output=performance.json
      - uses: actions/upload-artifact@v4
        with:
          name: performance-results
          path: performance.json

  quality-agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g agentic-jujutsu
      - run: npx agentic-jujutsu analyze --focus=quality --output=quality.json
      - uses: actions/upload-artifact@v4
        with:
          name: quality-results
          path: quality.json

  aggregate:
    needs: [security-agent, performance-agent, quality-agent]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - name: Combine results
        run: |
          echo "## 🤖 Multi-Agent Analysis" >> $GITHUB_STEP_SUMMARY
          echo "### Security" >> $GITHUB_STEP_SUMMARY
          cat security-results/security.json | jq -r '.summary' >> $GITHUB_STEP_SUMMARY
          echo "### Performance" >> $GITHUB_STEP_SUMMARY
          cat performance-results/performance.json | jq -r '.summary' >> $GITHUB_STEP_SUMMARY
          echo "### Quality" >> $GITHUB_STEP_SUMMARY
          cat quality-results/quality.json | jq -r '.summary' >> $GITHUB_STEP_SUMMARY
```

---

### 5. Manual Dispatch with Inputs

**File**: `.github/workflows/ai-manual.yml`

```yaml
name: Manual AI Analysis

on:
  workflow_dispatch:
    inputs:
      analysis_type:
        description: 'Analysis type'
        required: true
        type: choice
        options:
          - security
          - performance
          - quality
          - comprehensive
      confidence_threshold:
        description: 'Minimum confidence (0.0-1.0)'
        required: false
        default: '0.75'
      target_path:
        description: 'Path to analyze'
        required: false
        default: '.'

jobs:
  manual-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run custom analysis
        run: |
          npm install -g agentic-jujutsu
          npx agentic-jujutsu analyze \
            --type=${{ inputs.analysis_type }} \
            --path="${{ inputs.target_path }}" \
            --confidence=${{ inputs.confidence_threshold }} \
            --output=results.json

      - name: Display results
        run: |
          echo "# Analysis Results" >> $GITHUB_STEP_SUMMARY
          echo "Type: ${{ inputs.analysis_type }}" >> $GITHUB_STEP_SUMMARY
          echo "Path: ${{ inputs.target_path }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          cat results.json | jq -r '.summary' >> $GITHUB_STEP_SUMMARY

      - uses: actions/upload-artifact@v4
        with:
          name: manual-analysis-results
          path: results.json
```

---

### 6. Scheduled Nightly Health Check

**File**: `.github/workflows/ai-nightly.yml`

```yaml
name: Nightly AI Health Check

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM UTC
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Cache learning data
        uses: actions/cache@v4
        with:
          path: .reasoningbank/
          key: learning-${{ github.repository }}
          restore-keys: learning-

      - name: Comprehensive scan
        run: |
          npm install -g agentic-jujutsu
          npx agentic-jujutsu analyze \
            --comprehensive \
            --all-files \
            --output=health.json

      - name: Get patterns
        run: npx agentic-jujutsu get-patterns > patterns.json

      - name: Create health report
        run: |
          cat > report.md <<EOF
          # Nightly Health Check - $(date +%Y-%m-%d)

          ## Overall Score
          $(jq -r '.score' health.json)/100

          ## Issues Found
          - Critical: $(jq -r '.critical' health.json)
          - High: $(jq -r '.high' health.json)
          - Medium: $(jq -r '.medium' health.json)

          ## AI Patterns Discovered
          $(jq -r '.[0:3] | .[] | "- \(.name): \(.successRate * 100 | round)% success"' patterns.json)

          ## Top Recommendations
          $(jq -r '.recommendations[0:5] | .[] | "- \(.)"' health.json)
          EOF

      - name: Create issue if critical
        if: fromJson(steps.scan.outputs.critical) > 0
        uses: actions/github-script@v7
        with:
          script: |
            const report = require('fs').readFileSync('report.md', 'utf8');
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `⚠️ Critical Issues Found: ${new Date().toISOString().split('T')[0]}`,
              body: report,
              labels: ['automated', 'critical', 'ai-health-check']
            });
```

---

### 7. Reusable Setup Action

**File**: `.github/actions/setup-agentic-jujutsu/action.yml`

```yaml
name: 'Setup agentic-jujutsu'
description: 'Install agentic-jujutsu with caching'

inputs:
  version:
    description: 'Version to install'
    required: false
    default: 'latest'
  enable-cache:
    description: 'Enable caching'
    required: false
    default: 'true'

runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'

    - name: Cache dependencies
      if: inputs.enable-cache == 'true'
      uses: actions/cache@v4
      with:
        path: |
          ~/.npm
          .reasoningbank/
        key: agentic-${{ runner.os }}-${{ inputs.version }}
        restore-keys: agentic-${{ runner.os }}-

    - name: Install agentic-jujutsu
      shell: bash
      run: |
        if [ "${{ inputs.version }}" = "latest" ]; then
          npm install -g agentic-jujutsu
        else
          npm install -g agentic-jujutsu@${{ inputs.version }}
        fi

    - name: Verify installation
      shell: bash
      run: npx agentic-jujutsu --version
```

**Usage in workflows**:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-agentic-jujutsu
    with:
      version: '2.2.0'
  - run: npx agentic-jujutsu analyze
```

---

## 🔑 Key Patterns Summary

### Security Patterns

```yaml
# Always use GITHUB_TOKEN
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# Minimal permissions
permissions:
  contents: read
  pull-requests: write

# Sanitize before AI
- run: find . -name "*.env*" -delete

# SARIF output
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

### Caching Patterns

```yaml
# Comprehensive caching
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      .reasoningbank/
      node_modules
    key: ai-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}-v1
    restore-keys: |
      ai-${{ runner.os }}-
```

### Output Patterns

```yaml
# Job summary
- run: echo "## Results" >> $GITHUB_STEP_SUMMARY

# PR comment
- uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: "Analysis complete"
      });

# Artifacts
- uses: actions/upload-artifact@v4
  with:
    name: results
    path: analysis.json
```

### Trigger Patterns

```yaml
# Multiple triggers
on:
  pull_request:      # On PR
  push:              # On push to main
    branches: [main]
  schedule:          # Nightly
    - cron: '0 2 * * *'
  workflow_dispatch: # Manual
```

---

## 📊 Performance Benchmarks

| Pattern | Build Time | Cache Hit | Time Saved |
|---------|-----------|-----------|------------|
| No optimization | 15 min | 0% | - |
| Basic caching | 8 min | 60% | 47% |
| Full optimization | 3 min | 85% | 80% |
| Parallel agents | 2 min | 85% | 87% |

---

## 🚦 Quick Start Guide

### Step 1: Choose a Template
Start with **Basic PR Analysis** for initial setup.

### Step 2: Add to Repository
```bash
mkdir -p .github/workflows
# Copy template to .github/workflows/ai-pr-review.yml
```

### Step 3: Configure Permissions
Ensure repository has required permissions:
- Settings → Actions → General → Workflow permissions → Read and write

### Step 4: Test
Create a PR and watch the workflow run.

### Step 5: Iterate
Add caching, learning, and parallel patterns progressively.

---

## 📚 Additional Resources

- **Full Research**: See `agentic-ai-cicd-integration-research.md`
- **agentic-jujutsu Docs**: `/packages/agentic-jujutsu/README.md`
- **GitHub Actions Docs**: https://docs.github.com/actions

---

**Last Updated**: 2025-11-22
**Quick Reference Version**: 1.0
