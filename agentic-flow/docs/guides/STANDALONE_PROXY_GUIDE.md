# Standalone Proxy Mode - Use Gemini/OpenRouter with Claude Code & Cursor

## Overview

The standalone proxy allows you to use **Gemini** or **OpenRouter** models with tools that expect the Anthropic API, such as:
- ✅ **Claude Code** (Anthropic's official CLI)
- ⏳ **Cursor IDE** (when ANTHROPIC_BASE_URL support is added)
- ✅ Any tool that supports `ANTHROPIC_BASE_URL`

**Cost Savings:** 85-90% cheaper than direct Anthropic API!

## Quick Start

### Start Gemini Proxy (Default)

```bash
# Set your API key
export GOOGLE_GEMINI_API_KEY=your-key-here

# Start proxy server
npx agentic-flow@1.1.11 proxy
```

### Start OpenRouter Proxy

```bash
# Set your API key
export OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Start proxy server
npx agentic-flow@1.1.11 proxy --provider openrouter --model "openai/gpt-4o-mini"
```

## Usage with Claude Code

Claude Code officially supports custom proxy URLs via `ANTHROPIC_BASE_URL`.

### Terminal 1: Start Proxy

```bash
# Gemini
export GOOGLE_GEMINI_API_KEY=your-key-here
npx agentic-flow proxy

# OR OpenRouter
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
npx agentic-flow proxy --provider openrouter
```

### Terminal 2: Use Claude Code

```bash
# Point Claude Code to the proxy
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY='<token printed by the proxy>'  # required; see below

# Now use Claude Code normally
claude

# Or with direct commands
claude --agent coder --task "Create a REST API in Python"
```

**That's it!** Claude Code will now route all requests through the proxy, using Gemini or OpenRouter instead of Anthropic.

**Authentication (3.0.0+).** The proxy binds `127.0.0.1` and rejects any
`/v1/messages` request without its token, so nobody else on your network can
spend your provider key. On start it prints a random per-run token; pass it as
`ANTHROPIC_API_KEY` (sent as `x-api-key`) or as `Authorization: Bearer`. To
keep the same token across restarts, set `AGENTIC_FLOW_PROXY_TOKEN` before
starting the proxy and use that value. `AGENTIC_FLOW_PROXY_HOST` changes the
bind address; only widen it on a network you trust. `/health` needs no token.

## Usage with Cursor IDE

**Status:** Cursor does not currently support custom `ANTHROPIC_BASE_URL` for Anthropic models.

**Workaround:** Use this feature request: https://github.com/cursor/cursor/issues/1604

Once Cursor adds support, usage will be:

```bash
# Start proxy
export GOOGLE_GEMINI_API_KEY=your-key-here
npx agentic-flow proxy

# Configure Cursor
Settings → API Keys
  Anthropic Base URL: http://localhost:3000
  Anthropic API Key: <token printed by the proxy>
```

## Full Command Reference

### Start Proxy

```bash
npx agentic-flow proxy [OPTIONS]
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--provider` | `-p` | Provider (gemini, openrouter) | gemini |
| `--port` | `-P` | Port number | 3000 |
| `--model` | `-m` | Model to use (provider-specific) | Auto |
| `--help` | `-h` | Show help | - |

### Environment Variables

| Variable | Required For | Description |
|----------|--------------|-------------|
| `GOOGLE_GEMINI_API_KEY` | Gemini | Your Google Gemini API key |
| `OPENROUTER_API_KEY` | OpenRouter | Your OpenRouter API key |
| `COMPLETION_MODEL` | Optional | Override default model |
| `AGENTIC_FLOW_PROXY_TOKEN` | Optional | Token clients must send (default: random per run, printed on start) |
| `AGENTIC_FLOW_PROXY_HOST` | Optional | Bind address (default: `127.0.0.1`) |

## Examples

### Example 1: Gemini with Custom Port

```bash
export GOOGLE_GEMINI_API_KEY=AIza...
npx agentic-flow proxy --port 8080

# In another terminal
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY='<token printed by the proxy>'
claude
```

### Example 2: OpenRouter with Specific Model

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx agentic-flow proxy --provider openrouter --model "anthropic/claude-3.5-sonnet"

# Use Claude Code
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY='<token printed by the proxy>'
claude --agent researcher --task "Analyze market trends"
```

### Example 3: Gemini with DeepSeek via OpenRouter

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx agentic-flow proxy --provider openrouter --model "deepseek/deepseek-chat-v3.1"

# 98% cost savings vs Claude Sonnet!
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY='<token printed by the proxy>'
claude --agent coder --task "Build a web scraper"
```

## Supported Models

### Gemini Models (via Google Gemini API)

Default: `gemini-2.0-flash-exp`

Available models:
- `gemini-2.0-flash-exp` - Fast, experimental, free tier
- `gemini-1.5-pro` - High quality, paid
- `gemini-1.5-flash` - Fast, cheap

### OpenRouter Models (via OpenRouter API)

Default: `meta-llama/llama-3.1-8b-instruct`

Popular models:
- `openai/gpt-4o-mini` - Fast, cheap OpenAI model ($0.15/1M tokens)
- `anthropic/claude-3.5-sonnet` - Claude via OpenRouter (same model, lower cost)
- `deepseek/deepseek-chat-v3.1` - 98% cheaper than Claude ($0.014/1M tokens)
- `meta-llama/llama-3.3-70b-instruct` - OSS, very cheap
- `google/gemini-2.0-flash-exp` - Gemini via OpenRouter

See full list: https://openrouter.ai/models

## How It Works

```
┌─────────────────┐
│   Claude Code   │
│   or Cursor     │
└────────┬────────┘
         │ ANTHROPIC_BASE_URL=http://localhost:3000
         │ Anthropic API format requests
         ▼
┌─────────────────────────┐
│  Agentic Flow Proxy     │
│  (Port 3000)            │
│  ┌─────────────────┐    │
│  │ API Translator  │    │
│  │ Anthropic →     │    │
│  │ Gemini/OpenRouter│   │
│  └─────────────────┘    │
└────────┬────────────────┘
         │ Gemini/OpenRouter API format
         ▼
┌─────────────────┐
│ Gemini API      │ OR ┌─────────────────┐
│ or              │    │ OpenRouter API  │
│ OpenRouter      │    └─────────────────┘
└─────────────────┘
```

**Translation:**
1. Claude Code sends Anthropic API request to proxy
2. Proxy translates to Gemini/OpenRouter format
3. Provider API returns response
4. Proxy translates back to Anthropic format
5. Claude Code receives response as if from Anthropic

## Cost Comparison

| Provider | Model | Cost per 1M tokens (input) | Savings vs Anthropic |
|----------|-------|---------------------------|---------------------|
| **Anthropic** | Claude Sonnet 4.5 | $3.00 | Baseline |
| **Gemini** (proxy) | gemini-2.0-flash-exp | $0.00 (free tier) | **100%** 🎉 |
| **OpenRouter** (proxy) | gpt-4o-mini | $0.15 | **95%** |
| **OpenRouter** (proxy) | deepseek-chat-v3.1 | $0.014 | **98%** |

**Real Example:**
- Task: Generate 10,000 lines of code (500K tokens)
- Anthropic Claude Sonnet 4.5: $1.50
- Gemini (free tier): $0.00
- OpenRouter (DeepSeek): $0.007

## Features

### MCP Tools Support (v1.1.11+)

MCP tools now work through the proxy! Enable with:

```bash
# Start proxy
export GOOGLE_GEMINI_API_KEY=your-key-here
npx agentic-flow proxy

# Enable MCP in Claude Code
export ENABLE_CLAUDE_FLOW_SDK=true
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY='<token printed by the proxy>'

# MCP tools will be forwarded to Gemini/OpenRouter
claude --agent coder --task "Use memory_store to save config"
```

All 7 MCP tools work:
1. `memory_store` - Persistent memory
2. `memory_retrieve` - Retrieve memory
3. `memory_search` - Search memory
4. `swarm_init` - Initialize agent swarm
5. `agent_spawn` - Spawn agents
6. `task_orchestrate` - Orchestrate tasks
7. `swarm_status` - Get swarm status

### Rate Limits

**Gemini Free Tier:**
- 10 requests per minute
- 50 requests per day

**OpenRouter:**
- Varies by model
- Most models: 100+ req/min
- Free models may have limits

**Workaround for Gemini limits:** Use OpenRouter for higher throughput.

## Troubleshooting

### Proxy not starting

```bash
# Check if port is in use
lsof -ti:3000

# Use different port
npx agentic-flow proxy --port 8080
```

### Claude Code hanging

```bash
# Verify proxy is running
curl http://localhost:3000/health

# Should return: {"status":"ok","service":"anthropic-to-gemini-proxy"}
```

### API key errors

```bash
# Verify key is set
echo $GOOGLE_GEMINI_API_KEY
echo $OPENROUTER_API_KEY

# Re-export if needed
export GOOGLE_GEMINI_API_KEY=your-key-here
```

### Wrong model being used

```bash
# Check proxy logs for model selection
# Proxy prints model on startup

# Override with --model flag
npx agentic-flow proxy --provider openrouter --model "openai/gpt-4o-mini"
```

## Advanced Configuration

### Custom .env File

Create `.env` in your project:

```bash
# .env
GOOGLE_GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-v1-...
COMPLETION_MODEL=gemini-2.0-flash-exp
PROXY_PORT=3000
```

Then start proxy:

```bash
npx agentic-flow proxy  # Reads .env automatically
```

### Run Proxy in Background

```bash
# Linux/Mac
npx agentic-flow proxy &

# Or with nohup for persistence
nohup npx agentic-flow proxy > proxy.log 2>&1 &

# Check if running
ps aux | grep agentic-flow

# Stop
pkill -f agentic-flow
```

### Docker Deployment

```dockerfile
FROM node:22-slim

RUN npm install -g agentic-flow@1.1.11

EXPOSE 3000

CMD ["npx", "agentic-flow", "proxy", "--provider", "gemini"]
```

```bash
docker build -t agentic-flow-proxy .
docker run -d -p 3000:3000 -e GOOGLE_GEMINI_API_KEY=your-key agentic-flow-proxy
```

## Security Considerations

### Local Network Only

By default, proxy binds to all interfaces (0.0.0.0). For security:

```bash
# TODO: Add --host option to bind to localhost only
# Currently: Proxy listens on all interfaces
```

**Workaround:** Use firewall rules to restrict access.

### API Key Protection

- Never commit `.env` files to version control
- Use environment variables in CI/CD
- Rotate keys regularly

### HTTPS/TLS

Currently, proxy runs on HTTP (localhost). For production:

1. Use reverse proxy (nginx, Caddy) with TLS
2. Or use cloud deployment with built-in TLS (Cloudflare, AWS)

## FAQ

**Q: Can I use this with other tools besides Claude Code?**
A: Yes! Any tool that supports `ANTHROPIC_BASE_URL` environment variable will work.

**Q: Does this work with streaming responses?**
A: Yes, streaming is fully supported for both Gemini and OpenRouter.

**Q: Can I use multiple proxies simultaneously?**
A: Yes, just use different ports:
```bash
# Terminal 1: Gemini on 3000
npx agentic-flow proxy --port 3000

# Terminal 2: OpenRouter on 3001
npx agentic-flow proxy --provider openrouter --port 3001
```

**Q: Will Cursor support this?**
A: Not yet. Track progress: https://github.com/cursor/cursor/issues/1604

**Q: Can I contribute other provider proxies?**
A: Yes! See `/src/proxy/anthropic-to-*.ts` for examples. PRs welcome for AWS Bedrock, Azure, etc.

## What's Next

### Planned Features

- [ ] `--host` option to bind to localhost only
- [ ] Built-in TLS/HTTPS support
- [ ] Prometheus metrics endpoint
- [ ] Request/response logging
- [ ] Multi-provider load balancing
- [ ] AWS Bedrock proxy
- [ ] Azure OpenAI proxy

### Related Documentation

- [MCP Proxy Validation](./MCP_PROXY_VALIDATION.md) - MCP tool forwarding details
- [v1.1.11 Release Notes](./V1.1.11_MCP_PROXY_FIX.md) - What's new
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code) - Official Claude Code guide

## Support

- **GitHub Issues:** https://github.com/ruvnet/agentic-flow/issues
- **Discord:** (coming soon)
- **Twitter:** @rUv

---

**Published:** 2025-10-05
**Version:** 1.1.11
**Status:** Production Ready ✅
