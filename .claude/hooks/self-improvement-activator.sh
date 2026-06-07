#!/usr/bin/env bash
# Self-improvement activator for sports betting bot
# Runs on UserPromptSubmit — checks for pending learnings and reminds to log new ones

LEARNINGS_DIR="${CLAUDE_PROJECT_DIR:-.}/.learnings"

[ -d "$LEARNINGS_DIR" ] || exit 0

pending=$(grep -h "\*\*Status\*\*: pending" "$LEARNINGS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')

if [ "$pending" -gt 0 ]; then
  echo "[self-improve] $pending pending item(s) in .learnings/ — review before major changes (grep -h 'Status.*pending' .learnings/*.md)"
fi
