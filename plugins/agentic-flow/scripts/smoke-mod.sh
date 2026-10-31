#!/usr/bin/env bash
# Structural contract for the agentic-flow mod (plugins/agentic-flow/hooks).
# Checks without running Claude Code; the engine-level checks are
# `claude plugin validate plugins/agentic-flow` and `claude plugin test plugins/agentic-flow`.
#
# Run: bash plugins/agentic-flow/scripts/smoke-mod.sh
# Exit 0 = contract holds, 1 = any violation.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$PLUGIN_DIR/hooks"
HOOKS_JSON="$HOOKS_DIR/hooks.json"

fail=0
pass() { printf '  ok   %s\n' "$1"; }
err()  { printf '  FAIL %s\n' "$1"; fail=1; }

echo "== agentic-flow mod contract =="

# 1. hooks.json names one module.
jq -e . "$HOOKS_JSON" >/dev/null 2>&1 && pass "hooks.json is valid JSON" || err "hooks.json missing or invalid"
[ "$(jq -c '.modules' "$HOOKS_JSON" 2>/dev/null)" = '["./register.ts"]' ] && pass 'modules == ["./register.ts"]' || err 'hooks.json must list exactly ["./register.ts"]'

# 2. Module files exist and stay small.
for f in register.ts guard.ts options.ts status.ts; do
  if [ -f "$HOOKS_DIR/$f" ]; then
    lines=$(wc -l < "$HOOKS_DIR/$f")
    [ "$lines" -lt 500 ] && pass "hooks/$f ($lines lines)" || err "hooks/$f is $lines lines (limit 500)"
  else
    err "hooks/$f missing"
  fi
done
grep -q "export const register: Register" "$HOOKS_DIR/register.ts" && pass "register.ts exports register: Register" || err "register.ts must export register: Register"

# 3. Sandbox-clean: sibling or 'claude-code' type imports only; nothing Node-shaped.
bad=$(grep -nE '^\s*import\b' "$HOOKS_DIR"/*.ts | grep -vE "from '(\./[a-z-]+|claude-code)'" || true)
[ -z "$bad" ] && pass "imports are ./<sibling> or 'claude-code' only" || err "forbidden import: $bad"
bad=$(grep -nE "\brequire\s*\(|\bimport\s*\(|\bprocess\.|from 'node:|\\\$\[" "$HOOKS_DIR"/*.ts || true)
[ -z "$bad" ] && pass "no require/import()/process/computed \$[x]" || err "sandbox violation: $bad"
bad=$(grep -nE "^\s*import\s+\{[^}]*\}\s+from 'claude-code'" "$HOOKS_DIR"/*.ts || true)
[ -z "$bad" ] && pass "'claude-code' imported for types only" || err "value import from 'claude-code': $bad"

# 4. Loader rules: `$` only in register.ts; literal env names; one bare on() per event.
bad=$(grep -lE '\$\.' "$HOOKS_DIR"/guard.ts "$HOOKS_DIR"/options.ts "$HOOKS_DIR"/status.ts 2>/dev/null || true)
[ -z "$bad" ] && pass "\$ is used only in register.ts" || err "\$ used outside register.ts: $bad"
bad=$(grep -nE '\$\.env\.(get|set)\(\s*[^'"'"'"]' "$HOOKS_DIR"/*.ts || true)
[ -z "$bad" ] && pass "\$.env names are literals" || err "computed \$.env name: $bad"
dups=$(grep -oE "on\('[a-z.]+', (async )?\(" "$HOOKS_DIR/register.ts" | sed -E "s/on\('([a-z.]+)'.*/\1/" | sort | uniq -d)
[ -z "$dups" ] && pass "at most one bare on(event) per event" || err "several bare registrations of: $dups"

# 5. The guard: a matcher on the agent tool, fail closed.
grep -q "on('tool.call', { tool: AGENT_TOOL }" "$HOOKS_DIR/register.ts" && pass "tool.call guard is matched to agentic_flow_agent" || err "tool.call guard must match AGENT_TOOL"
grep -q "\.catch(" "$HOOKS_DIR/register.ts" && pass "tool.call guard has a .catch (fail closed)" || err "tool.call guard needs a .catch handler"
grep -qi "not a sandbox" "$HOOKS_DIR/guard.ts" && pass "guard says it is not a sandbox" || err "guard.ts must say it is not a sandbox"

# 6. Tests ship with the guard.
for f in tests/guard.test.ts tests/mod.test.ts; do
  [ -f "$PLUGIN_DIR/$f" ] && pass "$f exists" || err "$f missing"
done

echo
[ "$fail" -eq 0 ] && echo "agentic-flow mod contract holds" || echo "agentic-flow mod contract violated"
exit "$fail"
