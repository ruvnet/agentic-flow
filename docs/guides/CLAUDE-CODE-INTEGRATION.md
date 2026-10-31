# Claude Code Integration with Agentic Flow

Use Claude Code with OpenRouter, Gemini, or ONNX providers through agentic-flow proxy.

## Quick Start

### Option 1: Auto-Start Proxy + Spawn Claude Code

```bash
# OpenRouter (99% cost savings)
npx agentic-flow claude-code --provider openrouter "Write a Python function"

# Gemini (FREE tier available)
npx agentic-flow claude-code --provider gemini "Create a REST API"

# Anthropic (direct, no proxy)
npx agentic-flow claude-code --provider anthropic "Help me debug"
```

This command:
1. ✅ Checks if proxy is running
2. ✅ Auto-starts proxy if needed (background)
3. ✅ Sets `ANTHROPIC_BASE_URL` to proxy endpoint
4. ✅ Configures provider-specific API keys
5. ✅ Spawns Claude Code with environment configured
6. ✅ Cleans up proxy on exit (optional with `--keep-proxy`)

---

### Option 2: Manual Proxy + Inline Environment Variables

**Terminal 1 - Start Proxy:**
```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx agentic-flow proxy --provider openrouter --port 3000
# Prints: export ANTHROPIC_API_KEY=sk-ant-proxy-...  (a new token every run)
```

**Terminal 2 - Use Claude Code:**
```bash
# Inline environment variables (cleanest native approach)
ANTHROPIC_BASE_URL=http://localhost:3000 \
ANTHROPIC_API_KEY='<token printed by the proxy>' \
claude "Write a Python function to sort a list"
```

The provider key stays with the proxy; Claude Code only needs the proxy token.

**Authentication (3.0.0+).** The proxy binds `127.0.0.1` and rejects any
`/v1/messages` request without its token, so nobody else on your network can
spend your provider key. On start it prints a random per-run token; pass it as
`ANTHROPIC_API_KEY` (sent as `x-api-key`) or as `Authorization: Bearer`. To
keep the same token across restarts, set `AGENTIC_FLOW_PROXY_TOKEN` before
starting the proxy and use that value. `AGENTIC_FLOW_PROXY_HOST` changes the
bind address; only widen it on a network you trust. `/health` needs no token.

---

### Option 3: Bash Wrapper Script

Copy `scripts/claude-code` to your PATH:

```bash
# Install script
cp node_modules/agentic-flow/scripts/claude-code ~/bin/
chmod +x ~/bin/claude-code

# Usage
claude-code openrouter "Write a Python function"
claude-code gemini "Create a REST API"
claude-code anthropic "Help me debug"
```

**Script Features:**
- Automatically sets `ANTHROPIC_BASE_URL` based on provider
- Validates API keys before running
- Supports custom proxy port via `AGENTIC_FLOW_PORT` env var
- Clean one-liner interface

---

## CLI Options

### `npx agentic-flow claude-code [OPTIONS] [prompt]`

**Options:**
- `--provider <provider>` - Provider to use (`anthropic`, `openrouter`, `gemini`, `onnx`) [default: `anthropic`]
- `--port <port>` - Proxy server port [default: `3000`]
- `--model <model>` - Override default model for provider
- `--keep-proxy` - Keep proxy running after Claude Code exits
- `--no-auto-start` - Don't auto-start proxy (assumes already running)

**All other arguments are passed directly to Claude Code.**

---

## Examples

### Simple Code Generation

```bash
# OpenRouter GPT-4o-mini (fast + cheap)
npx agentic-flow claude-code --provider openrouter \
  "Write a Python function to reverse a string"

# Gemini 2.0 Flash (FREE + fast)
npx agentic-flow claude-code --provider gemini \
  "Create a simple REST API with Flask"

# Direct Anthropic Claude Sonnet 4.5
npx agentic-flow claude-code --provider anthropic \
  "Help me implement OAuth2 authentication"
```

### With Custom Model

```bash
# Use specific OpenRouter model
npx agentic-flow claude-code \
  --provider openrouter \
  --model "meta-llama/llama-3.3-70b-instruct" \
  "Write a complex sorting algorithm"

# Use specific Gemini model
npx agentic-flow claude-code \
  --provider gemini \
  --model "gemini-2.5-flash-thinking-exp-01-21" \
  "Solve this algorithm problem"
```

### With Custom Port

```bash
# Start proxy on custom port
npx agentic-flow proxy --provider openrouter --port 8080

# Use Claude Code with custom port
npx agentic-flow claude-code \
  --provider openrouter \
  --port 8080 \
  --no-auto-start \
  "Write code"
```

### Keep Proxy Running

```bash
# Useful for multiple Claude Code sessions
npx agentic-flow claude-code \
  --provider openrouter \
  --keep-proxy \
  "First task"

# Proxy still running, no auto-start needed
npx agentic-flow claude-code \
  --provider openrouter \
  --no-auto-start \
  "Second task"
```

---

## Provider Configuration

### OpenRouter

**Requirements:**
- `OPENROUTER_API_KEY` environment variable

**Default Model:** `meta-llama/llama-3.1-8b-instruct`

**Popular Models:**
- `openai/gpt-4o-mini` - Fast, cheap, high quality
- `deepseek/deepseek-chat` - Great for coding
- `meta-llama/llama-3.3-70b-instruct` - Open source
- `anthropic/claude-3.5-sonnet` - Via OpenRouter

**Cost Savings:** ~90-99% vs direct Anthropic API

### Gemini

**Requirements:**
- `GOOGLE_GEMINI_API_KEY` environment variable

**Default Model:** `gemini-2.0-flash-exp`

**Available Models:**
- `gemini-2.0-flash-exp` - FREE tier, fast
- `gemini-2.5-flash-thinking-exp-01-21` - Advanced reasoning

**Cost Savings:** FREE tier available!

### Anthropic (Direct)

**Requirements:**
- `ANTHROPIC_API_KEY` environment variable

**Models:** All Claude models (Opus, Sonnet, Haiku)

**No proxy needed** - Direct API communication

### ONNX (Local)

**Requirements:**
- None (runs locally)

**Models:** Local ONNX models (Phi-4, etc.)

**Privacy:** 100% offline, no API calls

---

## How It Works

### Architecture

```
┌──────────────┐         ┌─────────────────┐         ┌──────────────┐
│ Claude Code  │────────>│ Agentic Flow    │────────>│ OpenRouter/  │
│              │         │ Proxy Server    │         │ Gemini API   │
│ (client)     │         │ (localhost:3000)│         │              │
└──────────────┘         └─────────────────┘         └──────────────┘
     │                           │                          │
     │ ANTHROPIC_BASE_URL        │ API Translation          │
     │ = http://localhost:3000   │ Format Conversion        │
     │                           │ Tool Calling             │
     └───────────────────────────┴──────────────────────────┘
```

### Request Flow

1. **User runs:** `npx agentic-flow claude-code --provider openrouter "task"`

2. **Wrapper checks:**
   - Is proxy running on port 3000?
   - Is `OPENROUTER_API_KEY` set?

3. **Wrapper starts proxy (if needed):**
   ```bash
   node dist/proxy/anthropic-to-openrouter.js
   ```

4. **Wrapper spawns Claude Code with env:**
   ```bash
   ANTHROPIC_BASE_URL=http://localhost:3000
   ANTHROPIC_API_KEY=<the proxy's per-run token>
   claude "task"
   ```

5. **Claude Code sends request to proxy:**
   - Uses Anthropic Messages API format
   - Sends to `http://localhost:3000/v1/messages`

6. **Proxy translates request:**
   - Converts Anthropic format → OpenAI format
   - Injects provider-specific instructions
   - Applies model-specific max_tokens
   - Forwards to OpenRouter/Gemini API

7. **Provider responds:**
   - OpenRouter/Gemini returns response
   - Proxy converts back to Anthropic format
   - Claude Code displays result

---

## Troubleshooting

### Proxy Won't Start

**Error:** `Proxy startup timeout`

**Solution:**
```bash
# Check if port is in use
lsof -i :3000

# Kill process if needed
kill -9 <PID>

# Use custom port
npx agentic-flow claude-code --provider openrouter --port 3001 "task"
```

### API Key Not Found

**Error:** `❌ Error: Missing API key for openrouter`

**Solution:**
```bash
# Set API key
export OPENROUTER_API_KEY=sk-or-v1-xxxxx

# Or use inline
OPENROUTER_API_KEY=sk-or-v1-xxxxx \
npx agentic-flow claude-code --provider openrouter "task"
```

### Claude Code Not Found

**Error:** `claude: command not found`

**Solution:**
```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Or use npx
npx @anthropic-ai/claude-code --version
```

### Proxy Returns Errors

**Check proxy logs:**
```bash
# Start proxy manually with verbose logging
VERBOSE=true npx agentic-flow proxy --provider openrouter

# In another terminal, test with curl
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: <token printed by the proxy>" \
  -d '{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"hello"}],"max_tokens":100}'
```

---

## Validation

### Test All Providers

```bash
# Test OpenRouter
npx agentic-flow claude-code --provider openrouter "print hello world in python"

# Test Gemini
npx agentic-flow claude-code --provider gemini "print hello world in python"

# Test Anthropic
npx agentic-flow claude-code --provider anthropic "print hello world in python"
```

### Expected Results

All providers should return clean Python code:

```python
print("Hello, World!")
```

**No XML tags** like `<file_write>` should appear in simple code generation tasks.

---

## Advanced Usage

### Custom Proxy Configuration

```typescript
// Start programmatic proxy
import { AnthropicToOpenRouterProxy } from 'agentic-flow/dist/proxy/anthropic-to-openrouter.js';

const proxy = new AnthropicToOpenRouterProxy({
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-4o-mini'
});

proxy.start(3000);
```

### Environment Variable Presets

Create `~/.agentic-flow-presets`. The proxies require a token, so give each
one a fixed token with `AGENTIC_FLOW_PROXY_TOKEN` when you start it and reuse
it here:

```bash
# Start the proxies with a stable token, e.g.
#   AGENTIC_FLOW_PROXY_TOKEN=$AF_PROXY_TOKEN npx agentic-flow proxy --provider openrouter --port 3000
#   AGENTIC_FLOW_PROXY_TOKEN=$AF_PROXY_TOKEN npx agentic-flow proxy --provider gemini --port 3001
export AF_PROXY_TOKEN="sk-ant-proxy-$(openssl rand -hex 32)"

# OpenRouter preset
alias claude-openrouter='ANTHROPIC_BASE_URL=http://localhost:3000 ANTHROPIC_API_KEY=$AF_PROXY_TOKEN claude'

# Gemini preset
alias claude-gemini='ANTHROPIC_BASE_URL=http://localhost:3001 ANTHROPIC_API_KEY=$AF_PROXY_TOKEN claude'

# Usage
claude-openrouter "Write code"
claude-gemini "Write code"
```

---

## Related Documentation

- [Provider Instruction Optimization](./PROVIDER_INSTRUCTION_OPTIMIZATION.md)
- [OpenRouter Deployment Guide](./OPENROUTER_DEPLOYMENT.md)
- [Validation Results](../../VALIDATION-RESULTS.md)

---

## Changelog

**v1.1.13** - Initial claude-code integration
- Added `npx agentic-flow claude-code` command
- Auto-start proxy functionality
- Provider detection and baseURL export
- Bash wrapper script for convenience
- 100% success rate across all providers

---

## Support

**GitHub Issues:** https://github.com/ruvnet/agentic-flow/issues

**Documentation:** https://github.com/ruvnet/agentic-flow#readme
