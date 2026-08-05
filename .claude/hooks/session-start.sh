#!/bin/bash
# Session start hook — installs project dependencies and awesome-claude-code
# Runs only in Claude Code remote (web) environments

set -euo pipefail

# Only run in remote environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "[session-start] Installing Node.js dependencies..."
cd "$PROJECT_DIR"
npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -5

echo "[session-start] Installing awesome-claude-code..."
pip install --quiet "git+https://github.com/hesreallyhim/awesome-claude-code.git" 2>&1 | tail -3

echo "[session-start] Setup complete."
