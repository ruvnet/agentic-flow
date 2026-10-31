---
name: multi-provider-routing
description: Route agentic-flow work across Anthropic, OpenRouter, Gemini and local ONNX models, and run the Anthropic-compatible translation proxy with its per-run token. Use when the user wants cheaper models, a non-Anthropic provider, local inference, or to point Claude Code at OpenRouter or Gemini.
---

# Multi-provider routing

## Plugin settings

Set these with `/plugin` (configure) or in settings under `pluginConfigs`:

- `provider`: `anthropic` (default), `openrouter`, `gemini`, `onnx`, `requesty` (sets `PROVIDER`)
- `model`: default model id (sets `COMPLETION_MODEL`); empty uses the provider's default
- `openrouter_api_key`, `gemini_api_key`: stored in secure storage

A key set in the plugin **replaces** the same variable from your shell for the MCP server. Left empty, the server sees an empty value, not your shell's: set the key in the plugin if you use that provider through it. `ANTHROPIC_API_KEY` is not a plugin setting; the server inherits it, or your Claude login, from the environment.

Never pass a key as a tool argument (`anthropicApiKey`, `openrouterApiKey`): arguments are written to the transcript, and the plugin's guard refuses such calls.

## Per call

`agentic_flow_agent` (registered under the `learning` or `admin` profile) takes `provider` and `model` per call, overriding the defaults. Pick with the `model-router` agent when unsure.

## Translation proxy: Claude Code on another provider

agentic-flow can serve an Anthropic-compatible endpoint backed by OpenRouter or Gemini. Since 3.0.0 the proxy:

- binds `127.0.0.1` unless `AGENTIC_FLOW_PROXY_HOST` says otherwise, and
- accepts only a **per-run token** that it prints on start (or `AGENTIC_FLOW_PROXY_TOKEN` if you set one).

```bash
# terminal 1: the provider key stays here, in the proxy's environment
OPENROUTER_API_KEY=... npx agentic-flow proxy --provider openrouter --model deepseek/deepseek-chat

# terminal 2: use the token the proxy printed
export ANTHROPIC_BASE_URL=http://127.0.0.1:3000
export ANTHROPIC_API_KEY=<token printed by the proxy>
claude
```

Do not put a placeholder or dummy value in `ANTHROPIC_API_KEY`: the proxy rejects anything but its token. Do not bind the proxy to `0.0.0.0` on a shared network: whoever reaches the port and has the token spends your provider key.

## Local

`provider: onnx` runs on this machine with no key and no network for inference. Expect lower quality; use it for mechanical tasks or private text.
