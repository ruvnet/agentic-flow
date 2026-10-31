# Requesty.ai Integration - User Migration Guide

## Welcome to Requesty!

This guide will help you start using Requesty.ai with agentic-flow to access 300+ AI models with significant cost savings.

## Quick Start (3 Steps)

### 1. Get Your Requesty API Key

1. Visit [Requesty.ai](https://app.requesty.ai)
2. Sign up or log in to your account
3. Navigate to **API Keys** section
4. Click **Generate New Key**
5. Copy your API key (starts with `requesty-`)

### 2. Set Your API Key

#### Option A: Environment Variable

```bash
export REQUESTY_API_KEY="requesty-xxxxxxxxxxxxx"
```

#### Option B: .env File

```bash
# Add to .env file
REQUESTY_API_KEY=requesty-xxxxxxxxxxxxx
```

### 3. Run Your First Command

```bash
npx agentic-flow --agent coder \
  --task "Create a hello world function" \
  --provider requesty
```

That's it! You're now using Requesty with 300+ models.

---

## Why Use Requesty?

| Feature | Benefit |
|---------|---------|
| **300+ Models** | Access OpenAI, Anthropic, Google, Meta, DeepSeek, and more |
| **80% Cost Savings** | Significantly cheaper than direct API calls |
| **Auto-Routing** | Intelligent model selection based on your needs |
| **Built-in Caching** | Reduce redundant API calls |
| **Analytics Dashboard** | Track usage, costs, and performance |
| **Zero Downtime** | Automatic failover and load balancing |

---

## Usage Examples

### Basic Chat Completion

```bash
npx agentic-flow --agent coder \
  --task "Explain async/await in JavaScript" \
  --provider requesty
```

Uses default model: `openai/gpt-4o-mini`

### Specify a Model

```bash
npx agentic-flow --agent researcher \
  --task "Research quantum computing trends" \
  --provider requesty \
  --model "anthropic/claude-3.5-sonnet"
```

### Enable Streaming

```bash
npx agentic-flow --agent coder \
  --task "Write a detailed tutorial on React hooks" \
  --provider requesty \
  --model "openai/gpt-4o" \
  --stream
```

### Use FREE Models

```bash
# Google Gemini 2.5 Flash - Completely FREE!
npx agentic-flow --agent coder \
  --task "Create a REST API with Express" \
  --provider requesty \
  --model "google/gemini-2.5-flash"
```

### Cost-Optimized Models

```bash
# DeepSeek Chat V3 - Only $0.03 per 1M tokens
npx agentic-flow --agent coder \
  --task "Build a calculator function" \
  --provider requesty \
  --model "deepseek/deepseek-chat-v3"
```

### Premium Quality Models

```bash
# GPT-4o - Top-tier quality
npx agentic-flow --agent architect \
  --task "Design a microservices architecture" \
  --provider requesty \
  --model "openai/gpt-4o"
```

---

## Recommended Models

### For General Coding

| Model | Cost/1M Tokens | Speed | Quality | Best For |
|-------|----------------|-------|---------|----------|
| `openai/gpt-4o-mini` | $0.03 | Fast | Good | Quick tasks, debugging |
| `deepseek/deepseek-chat-v3` | $0.03 | Fast | Good | Cost-effective coding |
| `qwen/qwen-2.5-coder-32b` | $0.05 | Fast | Excellent | Specialized coding |
| `openai/gpt-4o` | $0.50 | Medium | Excellent | Complex architecture |

### For Research & Analysis

| Model | Cost/1M Tokens | Speed | Quality | Best For |
|-------|----------------|-------|---------|----------|
| `google/gemini-2.5-flash` | FREE | Very Fast | Good | General research |
| `anthropic/claude-3.5-sonnet` | $0.60 | Medium | Excellent | Deep analysis |
| `openai/gpt-4-turbo` | $1.00 | Medium | Excellent | Complex reasoning |
| `google/gemini-2.5-pro` | $0.10 | Fast | Very Good | Large context tasks |

### For Cost Optimization

| Model | Cost/1M Tokens | Savings vs Claude 3.5 | Quality |
|-------|----------------|----------------------|---------|
| `google/gemini-2.5-flash` | FREE | 100% | Good |
| `deepseek/deepseek-chat-v3` | $0.03 | 95% | Good |
| `meta-llama/llama-3.3-8b` | $0.02 | 97% | Good |
| `openai/gpt-4o-mini` | $0.03 | 95% | Very Good |

---

## Configuration Options

### Environment Variables

```bash
# Required
export REQUESTY_API_KEY="requesty-xxxxxxxxxxxxx"

# Optional
export REQUESTY_BASE_URL="https://router.requesty.ai/v1"  # Custom base URL
export USE_REQUESTY="true"                                 # Force Requesty provider
export COMPLETION_MODEL="openai/gpt-4o-mini"              # Default model
export PROXY_PORT="3000"                                   # Proxy server port
```

### CLI Flags

```bash
--provider requesty              # Use Requesty provider
--model "model-id"               # Specify model
--stream                         # Enable streaming
--temperature 0.7                # Creativity (0.0-1.0)
--max-tokens 4096                # Maximum output length
--verbose                        # Detailed logging
```

---

## Migration from Other Providers

### From Anthropic Direct

**Before:**
```bash
export ANTHROPIC_API_KEY="sk-ant-xxxxx"
npx agentic-flow --agent coder --task "Create function"
```

**After:**
```bash
export REQUESTY_API_KEY="requesty-xxxxx"
npx agentic-flow --agent coder \
  --task "Create function" \
  --provider requesty \
  --model "anthropic/claude-3.5-sonnet"
```

**Benefits:**
- 80% cost savings
- Same Claude quality
- Access to 300+ other models

### From OpenRouter

**Before:**
```bash
export OPENROUTER_API_KEY="sk-or-xxxxx"
npx agentic-flow --agent coder \
  --task "Create function" \
  --provider openrouter \
  --model "meta-llama/llama-3.1-8b-instruct"
```

**After:**
```bash
export REQUESTY_API_KEY="requesty-xxxxx"
npx agentic-flow --agent coder \
  --task "Create function" \
  --provider requesty \
  --model "meta-llama/llama-3.3-70b-instruct"
```

**Benefits:**
- 200 more models (300 vs 100)
- Built-in analytics dashboard
- Auto-routing and caching

### From Google Gemini

**Before:**
```bash
export GOOGLE_GEMINI_API_KEY="xxxxx"
npx agentic-flow --agent coder \
  --task "Create function" \
  --provider gemini
```

**After:**
```bash
export REQUESTY_API_KEY="requesty-xxxxx"
npx agentic-flow --agent coder \
  --task "Create function" \
  --provider requesty \
  --model "google/gemini-2.5-flash"
```

**Benefits:**
- Access to OpenAI, Anthropic, DeepSeek models
- Unified billing and analytics
- Model fallback support

---

## Advanced Usage

### Use with Claude Code

#### Terminal 1 - Start Proxy

```bash
export REQUESTY_API_KEY="requesty-xxxxx"
npx agentic-flow proxy --provider requesty --port 3000
```

#### Terminal 2 - Configure Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:3000"
export ANTHROPIC_API_KEY="<token printed by the proxy>"  # the proxy rejects any other key (3.0.0+)

claude
```

Now Claude Code will use Requesty models!

### Auto-Start Proxy

```bash
# One command - proxy + Claude Code
npx agentic-flow claude-code --provider requesty "Create a React app"
```

### Model Optimization

```bash
# Let agentic-flow choose the best model automatically
npx agentic-flow --agent coder \
  --task "Build API endpoint" \
  --optimize \
  --priority cost \
  --provider requesty
```

**Priorities:**
- `quality` - Best results (Claude, GPT-4o)
- `balanced` - Good quality + cost (DeepSeek, Gemini)
- `cost` - Cheapest options (FREE tier models)
- `speed` - Fastest responses (Gemini Flash)

---

## Troubleshooting

### Issue: "REQUESTY_API_KEY required"

**Solution:**
```bash
# Check if API key is set
echo $REQUESTY_API_KEY

# If empty, set it
export REQUESTY_API_KEY="requesty-xxxxx"
```

### Issue: "Invalid API key"

**Solution:**
1. Verify your API key starts with `requesty-`
2. Check for typos or extra spaces
3. Generate a new key at https://app.requesty.ai
4. Make sure key is active (not revoked)

### Issue: "Rate limit exceeded"

**Solution:**
```bash
# Wait and retry (auto-retry is built-in)
# Or upgrade your Requesty tier
# Or use a different model temporarily
```

### Issue: "Model not found"

**Solution:**
```bash
# Check model ID format: <provider>/<model-name>
# Example: openai/gpt-4o-mini (correct)
#          gpt-4o-mini (incorrect - missing provider)

# Verify model exists at https://app.requesty.ai/model-list
```

### Issue: Proxy won't start

**Solution:**
```bash
# Check if port 3000 is already in use
lsof -i :3000

# Use a different port
PROXY_PORT=8080 npx agentic-flow proxy --provider requesty --port 8080
```

### Issue: Response is slow

**Solution:**
```bash
# Use faster models
--model "google/gemini-2.5-flash"    # Fastest
--model "openai/gpt-4o-mini"         # Fast
--model "deepseek/deepseek-chat-v3"  # Fast + cheap

# Enable streaming for perceived speed
--stream
```

### Issue: Tool calling not working

**Solution:**
```bash
# Some older models don't support tools
# Use known tool-compatible models:
--model "openai/gpt-4o-mini"           # ✓ Tools
--model "anthropic/claude-3.5-sonnet"  # ✓ Tools
--model "google/gemini-2.5-flash"      # ✓ Tools
--model "deepseek/deepseek-chat-v3"    # ✓ Tools

# Avoid older models like:
--model "mistralai/mistral-7b-instruct"  # ✗ No tools (emulation used)
```

---

## Cost Comparison

### Agentic Flow Task: "Create a REST API with Express.js"

| Provider | Model | Tokens Used | Cost | Savings |
|----------|-------|-------------|------|---------|
| Anthropic Direct | claude-3.5-sonnet | 5,000 | $0.0150 | Baseline |
| Requesty | anthropic/claude-3.5-sonnet | 5,000 | $0.0030 | 80% |
| Requesty | openai/gpt-4o-mini | 5,000 | $0.00015 | 99% |
| Requesty | google/gemini-2.5-flash | 5,000 | $0.0000 | 100% |
| Requesty | deepseek/deepseek-chat-v3 | 5,000 | $0.00015 | 99% |

**Real Savings Example:**
- 100 tasks/day with Claude 3.5 Sonnet
- Direct: $1.50/day = $45/month
- Requesty: $0.30/day = $9/month
- **Savings: $36/month (80%)**

---

## Best Practices

### 1. Start with Free Tier

```bash
# Test Requesty with FREE models first
--model "google/gemini-2.5-flash"
```

### 2. Use Right Model for Task

```bash
# Simple tasks → cheap models
--model "deepseek/deepseek-chat-v3"

# Complex tasks → premium models
--model "openai/gpt-4o"

# Research → large context models
--model "google/gemini-2.5-pro"
```

### 3. Enable Streaming for UX

```bash
# Always stream for user-facing tasks
--stream
```

### 4. Monitor Costs

Visit [Requesty Dashboard](https://app.requesty.ai/dashboard) to:
- Track token usage
- Monitor spending
- Set budget alerts
- Compare model costs

### 5. Use Model Optimizer

```bash
# Let agentic-flow choose the best model
--optimize --priority balanced
```

---

## FAQ

### Q: Do I need both ANTHROPIC_API_KEY and REQUESTY_API_KEY?

**A:** No, only `REQUESTY_API_KEY` is needed when using `--provider requesty`.

### Q: Can I use Requesty and Anthropic together?

**A:** Yes! Use `--provider requesty` for some tasks and `--provider anthropic` for others.

### Q: Does Requesty work with all agentic-flow features?

**A:** Yes! Tool calling, streaming, MCP servers, and all agents work with Requesty.

### Q: Is my data secure with Requesty?

**A:** Yes. Requesty follows industry-standard security practices. Check their [privacy policy](https://requesty.ai/privacy).

### Q: Can I use Requesty with Claude Code/Cursor?

**A:** Yes! Use proxy mode:
```bash
npx agentic-flow proxy --provider requesty
```

### Q: How do I get support?

**A:**
- Requesty support: support@requesty.ai
- Agentic Flow issues: https://github.com/ruvnet/agentic-flow/issues

### Q: Are there usage limits?

**A:** Yes, limits depend on your Requesty tier. Free tier has lower limits. Upgrade for higher limits.

### Q: Can I use custom models?

**A:** If your custom model is available on Requesty's platform, yes! Check their model catalog.

### Q: Does Requesty support vision/image models?

**A:** Yes! Some models support vision:
```bash
--model "openai/gpt-4o"  # Supports vision
--model "google/gemini-2.5-pro"  # Supports vision
```

### Q: How does caching work?

**A:** Requesty automatically caches similar requests to reduce costs. No configuration needed.

---

## Model Catalog

### Full Model List

Visit [Requesty Model Library](https://app.requesty.ai/model-list) for the complete catalog of 300+ models.

### Popular Models Quick Reference

```bash
# OpenAI
openai/gpt-4o                     # Premium quality, $0.50/1M tokens
openai/gpt-4o-mini                # Fast, cost-effective, $0.03/1M tokens
openai/gpt-4-turbo                # High quality, $1.00/1M tokens
openai/gpt-3.5-turbo              # Legacy, cheap, $0.05/1M tokens

# Anthropic
anthropic/claude-3.5-sonnet       # Best reasoning, $0.60/1M tokens
anthropic/claude-3-opus           # Premium, $1.50/1M tokens
anthropic/claude-3-sonnet         # Balanced, $0.30/1M tokens
anthropic/claude-3-haiku          # Fast, $0.08/1M tokens

# Google
google/gemini-2.5-pro             # Large context, $0.10/1M tokens
google/gemini-2.5-flash           # FREE tier, fast

# DeepSeek
deepseek/deepseek-chat-v3         # Cost-optimized, $0.03/1M tokens
deepseek/deepseek-coder           # Coding-focused, $0.03/1M tokens

# Meta/Llama
meta-llama/llama-3.3-70b-instruct # Open source, $0.10/1M tokens
meta-llama/llama-3.3-8b-instruct  # Fast, cheap, $0.02/1M tokens

# Qwen
qwen/qwen-2.5-coder-32b-instruct  # Coding expert, $0.05/1M tokens

# Mistral
mistralai/mistral-large           # European alternative, $0.20/1M tokens
```

---

## Getting Help

### Documentation

- Requesty Docs: https://docs.requesty.ai
- Agentic Flow Docs: https://github.com/ruvnet/agentic-flow

### Support Channels

- Email: support@requesty.ai
- Discord: [Requesty Discord](https://discord.gg/requesty)
- GitHub Issues: https://github.com/ruvnet/agentic-flow/issues

### Community

- Share tips and tricks
- Report bugs
- Request new features

---

## Next Steps

1. **Get Your API Key** - https://app.requesty.ai
2. **Try Free Models** - `google/gemini-2.5-flash`
3. **Test Premium Models** - `anthropic/claude-3.5-sonnet`
4. **Monitor Usage** - Check Requesty dashboard
5. **Optimize Costs** - Use `--optimize` flag

## Happy Coding with Requesty! 🚀

Save money, access 300+ models, and build amazing AI applications with agentic-flow + Requesty.ai.
