#!/usr/bin/env bash
# Structural contract for the agentic-flow Claude Code plugin.
#
# Structural only: no network, no credentials, no npm install. It must pass in
# a scrubbed sandbox (temp HOME, only this repo checkout). `claude plugin
# validate` / `claude plugin test` run when `claude` is on PATH, else are skipped.
#
# Run: bash plugins/agentic-flow/scripts/smoke.sh
# Exit 0 = contract holds, 1 = any violation.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/../.." && pwd)"
MANIFEST="$PLUGIN_DIR/.claude-plugin/plugin.json"
MCP_JSON="$PLUGIN_DIR/.mcp.json"
MARKETPLACE="$REPO_ROOT/.claude-plugin/marketplace.json"
PLUGIN_NAME="agentic-flow"
SERVER="agentic-flow"

fail=0
pass() { printf '  ok   %s\n' "$1"; }
err()  { printf '  FAIL %s\n' "$1"; fail=1; }

command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }

echo "== $PLUGIN_NAME plugin contract =="

# 1. Every JSON file parses.
for f in "$MANIFEST" "$MCP_JSON" "$MARKETPLACE" "$PLUGIN_DIR/hooks/hooks.json"; do
  jq -e . "$f" >/dev/null 2>&1 && pass "valid JSON: ${f#"$REPO_ROOT"/}" || err "missing or invalid JSON: ${f#"$REPO_ROOT"/}"
done

# 2. Manifest identity; no component arrays (auto-discovery).
[ "$(jq -r .name "$MANIFEST")" = "$PLUGIN_NAME" ] && pass "plugin.json name == $PLUGIN_NAME" || err "plugin.json name != $PLUGIN_NAME"
VERSION="$(jq -r .version "$MANIFEST")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && pass "plugin.json version $VERSION" || err "plugin.json version '$VERSION' is not x.y.z"
jq -e 'has("skills") or has("commands") or has("agents")' "$MANIFEST" >/dev/null 2>&1 \
  && err "plugin.json declares skills/commands/agents arrays" || pass "plugin.json relies on auto-discovery"
jq -e '.keywords | index("mod") and index("function-hooks")' "$MANIFEST" >/dev/null 2>&1 \
  && pass "keywords include mod and function-hooks" || err "keywords must include mod and function-hooks"

# 3. .mcp.json pin == plugin version; the server starts with `mcp start`.
PIN="$(jq -r --arg s "$SERVER" '.mcpServers[$s].args[]? | select(startswith("agentic-flow@"))' "$MCP_JSON")"
[ "$PIN" = "agentic-flow@$VERSION" ] && pass ".mcp.json pins agentic-flow@$VERSION" || err ".mcp.json pin '${PIN:-<none>}' != agentic-flow@$VERSION"
[ "$(jq -r --arg s "$SERVER" '.mcpServers[$s].args | join(" ")' "$MCP_JSON")" = "-y $PIN mcp start" ] \
  && pass ".mcp.json runs: npx -y $PIN mcp start" || err ".mcp.json args must be: -y agentic-flow@<version> mcp start"

# 4. Every ${user_config.X} is declared with a default; the profile default is non-empty
#    (agentic-flow throws on an empty AGENTIC_FLOW_MCP_PROFILE).
for key in $(grep -oE '\$\{user_config\.[A-Za-z0-9_]+\}' "$MCP_JSON" | sed -E 's/.*\.([A-Za-z0-9_]+)\}/\1/' | sort -u); do
  jq -e --arg k "$key" '.userConfig[$k] | has("default")' "$MANIFEST" >/dev/null 2>&1 \
    && pass "userConfig.$key declared with a default" || err "userConfig.$key used by .mcp.json but not declared with a default"
done
[ "$(jq -r '.userConfig.mcp_profile.default' "$MANIFEST")" = "readonly" ] && pass "mcp_profile defaults to readonly" || err "mcp_profile must default to readonly"

# 5. Security posture.
[ "$(jq -r '.userConfig.allow_bypass_permissions.default' "$MANIFEST")" = "false" ] \
  && pass "allow_bypass_permissions defaults to false" || err "allow_bypass_permissions must default to false"
jq -r '.userConfig.allow_bypass_permissions.description' "$MANIFEST" | grep -q 'Bash, Write, Edit' \
  && pass "bypass option describes the risk" || err "bypass option description must spell out the risk"
for k in openrouter_api_key gemini_api_key; do
  [ "$(jq -r --arg k "$k" '.userConfig[$k].sensitive' "$MANIFEST")" = "true" ] && pass "userConfig.$k is sensitive" || err "userConfig.$k must be sensitive"
done
[ "$(jq -r '.userConfig.guardMode.default' "$MANIFEST")" = "enforce" ] && pass "guardMode defaults to enforce" || err "guardMode must default to enforce"
if grep -hE '^(allowed-tools|tools):' "$PLUGIN_DIR"/skills/*/SKILL.md "$PLUGIN_DIR"/commands/*.md "$PLUGIN_DIR"/agents/*.md 2>/dev/null | grep -qE 'agentic|mcp__|\*'; then
  err "a skill, command or agent pre-approves agentic-flow tools"
else
  pass "no skill, command or agent pre-approves agentic-flow tools"
fi
jq -e 'has("permissions")' "$MANIFEST" >/dev/null 2>&1 && err "plugin.json carries a permissions block" || pass "plugin.json carries no permissions block"
if grep -rnE '(sk-ant-|sk-or-)[A-Za-z0-9-]{8,}|ANTHROPIC_API_KEY=(dummy|test|fake|placeholder|sk-)' "$PLUGIN_DIR" --include='*.json' --include='*.md' --include='*.sh' >/dev/null 2>&1; then
  err "a key or dummy key appears in the plugin"
else
  pass "no keys or dummy keys in the plugin"
fi

# 6. Components: frontmatter, skill name == directory.
for f in "$PLUGIN_DIR"/agents/*.md; do
  head -8 "$f" | grep -qE '^name:' && head -8 "$f" | grep -qE '^description:' && head -8 "$f" | grep -qE '^model:' \
    && pass "agent $(basename "$f")" || err "agent $(basename "$f") needs name, description, model"
done
for f in "$PLUGIN_DIR"/commands/*.md; do
  head -6 "$f" | grep -qE '^description:' && pass "command $(basename "$f")" || err "command $(basename "$f") needs a description"
done
n=0
for d in "$PLUGIN_DIR"/skills/*/; do
  n=$((n + 1)); dir="$(basename "$d")"; s="$d/SKILL.md"
  name="$(awk 'NR==1 && $0!="---"{exit} NR>1 && /^---/{exit} /^name:/{sub(/^name:[ ]*/,""); print; exit}' "$s" 2>/dev/null)"
  [ "$name" = "$dir" ] && head -6 "$s" | grep -qE '^description:' && pass "skill $dir (name matches)" || err "skill $dir: SKILL.md name '$name' must equal the directory and carry a description"
done
[ "$n" -ge 2 ] && pass "skills: $n" || err "skills: $n (expected >= 2)"

# 7. Marketplace indexes this plugin.
jq -e --arg n "$PLUGIN_NAME" '.name == $n and (.plugins[] | select(.name == $n) | .source == "./plugins/agentic-flow")' "$MARKETPLACE" >/dev/null 2>&1 \
  && pass "marketplace.json indexes $PLUGIN_NAME at ./plugins/agentic-flow" || err "marketplace.json must index $PLUGIN_NAME at ./plugins/agentic-flow"

# 8. Docs.
for f in README.md CHANGELOG.md; do [ -s "$PLUGIN_DIR/$f" ] && pass "$f present" || err "$f missing"; done
grep -q "## \[$VERSION\]" "$PLUGIN_DIR/CHANGELOG.md" && pass "CHANGELOG has $VERSION" || err "CHANGELOG lacks a [$VERSION] entry"

# 9. The mod's own contract.
bash "$SCRIPT_DIR/smoke-mod.sh" >/dev/null && pass "smoke-mod.sh passed" || err "smoke-mod.sh failed (run it for details)"

# 10. Engine checks, when Claude Code is installed.
if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$PLUGIN_DIR" >/dev/null 2>&1 && pass "claude plugin validate" || err "claude plugin validate failed"
  claude plugin test "$PLUGIN_DIR" >/dev/null 2>&1 && pass "claude plugin test" || err "claude plugin test failed"
else
  echo "  skip claude plugin validate/test (claude not on PATH)"
fi

echo "======================================="
if [ "$fail" -eq 0 ]; then echo "PASS: $PLUGIN_NAME contract holds"; else echo "FAIL: $PLUGIN_NAME contract violated"; fi
exit "$fail"
