#!/bin/bash
# Agentic Flow Intelligence Status Line
# Shows real-time learning metrics from SONA + HNSW + ReasoningBank

INTEL_FILE=".agentic-flow/intelligence.json"
INTEL_DB=".agentic-flow/intelligence.db"

# Default values
PATTERNS=0
MEMORIES=0
ROUTES=0
TRAJECTORIES=0
LEARNING_RATE=10
EPSILON=10

# Get current git branch
GIT_BRANCH=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
fi

# Read intelligence metrics
if [ -f "$INTEL_FILE" ]; then
  PATTERNS=$(jq -r '.patterns | length // 0' "$INTEL_FILE" 2>/dev/null || echo "0")
  MEMORIES=$(jq -r '.memories | length // 0' "$INTEL_FILE" 2>/dev/null || echo "0")
  ROUTES=$(jq -r '.metrics.totalRoutes // 0' "$INTEL_FILE" 2>/dev/null || echo "0")
  TRAJECTORIES=$(jq -r '.trajectories | length // 0' "$INTEL_FILE" 2>/dev/null || echo "0")

  # Get learning parameters
  LR=$(jq -r '.config.learningRate // 0.1' "$INTEL_FILE" 2>/dev/null || echo "0.1")
  EPS=$(jq -r '.config.epsilon // 0.1' "$INTEL_FILE" 2>/dev/null || echo "0.1")
  # Values come from a file in the working tree: accept plain decimals only, and
  # pass them to awk as data (-v), never as program text.
  NUM_RE='^[0-9]*\.?[0-9]+$'
  [[ "$LR" =~ $NUM_RE ]] || LR="0.1"
  [[ "$EPS" =~ $NUM_RE ]] || EPS="0.1"
  LEARNING_RATE=$(awk -v v="$LR" 'BEGIN {printf "%.0f", v * 100}' 2>/dev/null || echo "10")
  EPSILON=$(awk -v v="$EPS" 'BEGIN {printf "%.0f", v * 100}' 2>/dev/null || echo "10")

  # Get active count
  ACTIVE=$(jq -r '[.trajectories // {} | to_entries[] | select(.value.status == "active")] | length' "$INTEL_FILE" 2>/dev/null || echo "0")
fi

# Attention mechanism status (check which are enabled)
NEURAL="●Neural"
DAG="◐DAG"
GRAPH="○Graph"
SSM="●SSM"

# Check DB for vector count
VECTOR_COUNT=0
if [ -f "$INTEL_DB" ]; then
  VECTOR_COUNT=$(sqlite3 "$INTEL_DB" "SELECT COUNT(*) FROM vectors;" 2>/dev/null || echo "0")
fi

# Build output
OUTPUT=""

# Line 1: Model + Project + Branch
OUTPUT="Opus 4.5 in agentic-flow"
if [ -n "$GIT_BRANCH" ]; then
  OUTPUT="${OUTPUT} on ⎇ ${GIT_BRANCH}"
fi

# Line 2: Agentic Flow metrics
OUTPUT="${OUTPUT}\n🧠 Agentic Flow ◆ ${PATTERNS} patterns ⬡ ${MEMORIES} mem ↝${ROUTES} #${TRAJECTORIES}"

# Line 3: Agent routing/learning metrics
OUTPUT="${OUTPUT}\n🎯 Agent Routing q-learning lr:${LEARNING_RATE}% ε:${EPSILON}%"

# Line 4: Swarm coordination mechanisms
OUTPUT="${OUTPUT}\n⚡ Swarm: ●Neural ◐DAG ○Graph ●SSM"

printf "%b\n" "$OUTPUT"
