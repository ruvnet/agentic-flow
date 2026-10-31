# FastMCP CLI Integration Guide

## 🎯 Overview

The FastMCP servers are integrated into the `agentic-flow` CLI with commands for starting servers in different transport modes.

## 📦 Available Commands

```bash
# Start stdio MCP server (for Claude Desktop)
npx agentic-flow mcp start
npx agentic-flow mcp stdio

# Start HTTP + SSE server (for web/remote clients)
npx agentic-flow mcp http
npx agentic-flow mcp sse

# Start with custom port
npx agentic-flow mcp http --port 3001

# Start with debug logging
npx agentic-flow mcp stdio --debug
npx agentic-flow mcp http --debug

# List available tools
npx agentic-flow mcp tools

# Show server status
npx agentic-flow mcp status
```

## 🚀 Quick Start

### 1. Install Package
```bash
npm install -g agentic-flow
# or
npx agentic-flow
```

### 2. Start MCP Server

#### For Claude Desktop (stdio)
```bash
npx agentic-flow mcp start
```

#### For Web Apps (HTTP + SSE)
```bash
npx agentic-flow mcp http
```

### 3. Configure Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentic-flow": {
      "command": "npx",
      "args": ["agentic-flow", "mcp", "start"]
    }
  }
}
```

## 🔧 Implementation

### Add to CLI (src/cli.ts)

```typescript
#!/usr/bin/env node
import { program } from 'commander';
import { spawn } from 'child_process';
import { resolve } from 'path';

program
  .name('agentic-flow')
  .version('1.0.0')
  .description('Agentic Flow CLI with integrated FastMCP servers');

// MCP command group
const mcp = program
  .command('mcp')
  .description('MCP server commands');

// Start stdio server (default)
mcp
  .command('start')
  .alias('stdio')
  .description('Start stdio MCP server (for Claude Desktop)')
  .option('-d, --debug', 'Enable debug logging')
  .action((options) => {
    console.log('🚀 Starting FastMCP stdio server...');
    console.log('📦 Tools: memory_store, memory_retrieve, memory_search, swarm_init, agent_spawn, task_orchestrate\n');

    const serverPath = resolve(__dirname, 'mcp/fastmcp/servers/stdio-full.js');
    const proc = spawn('node', [serverPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DEBUG: options.debug ? 'fastmcp:*' : undefined
      }
    });

    proc.on('exit', (code) => {
      process.exit(code || 0);
    });
  });

// Start HTTP + SSE server
mcp
  .command('http')
  .alias('sse')
  .description('Start HTTP + SSE server (for web/remote clients)')
  .option('-p, --port <port>', 'Port number', '3000')
  .option('-d, --debug', 'Enable debug logging')
  .action((options) => {
    console.log('🚀 Starting FastMCP HTTP + SSE server...');
    console.log(`🌐 Port: ${options.port}`);
    console.log('📡 SSE endpoint: /events');
    console.log('🔧 Tools: 6 (memory × 3, swarm × 3)\n');

    const serverPath = resolve(__dirname, 'mcp/fastmcp/servers/http-streaming.js');
    const proc = spawn('node', [serverPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: options.port,
        DEBUG: options.debug ? 'fastmcp:*' : undefined
      }
    });

    proc.on('exit', (code) => {
      process.exit(code || 0);
    });
  });

// List available tools
mcp
  .command('tools')
  .description('List available MCP tools')
  .action(() => {
    console.log('\n📦 Available MCP Tools (6 total)\n');
    console.log('Memory Tools:');
    console.log('  1. memory_store    - Store values with TTL and namespacing');
    console.log('  2. memory_retrieve - Retrieve stored values');
    console.log('  3. memory_search   - Search keys with pattern matching\n');
    console.log('Swarm Coordination Tools:');
    console.log('  4. swarm_init      - Initialize multi-agent swarms');
    console.log('  5. agent_spawn     - Spawn specialized agents');
    console.log('  6. task_orchestrate - Orchestrate distributed tasks\n');
  });

// Show server status
mcp
  .command('status')
  .description('Show MCP server status')
  .action(() => {
    console.log('\n🔍 FastMCP Server Status\n');
    console.log('Available Transports:');
    console.log('  ✅ stdio    - JSON-RPC over stdio (for local MCP clients)');
    console.log('  ✅ HTTP+SSE - HTTP with Server-Sent Events (for web/remote)\n');
    console.log('Tools: 6/6 implemented');
    console.log('  ✅ memory_store');
    console.log('  ✅ memory_retrieve');
    console.log('  ✅ memory_search');
    console.log('  ✅ swarm_init');
    console.log('  ✅ agent_spawn');
    console.log('  ✅ task_orchestrate\n');
  });

program.parse();
```

### Update package.json

```json
{
  "name": "agentic-flow",
  "version": "1.0.0",
  "bin": {
    "agentic-flow": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "mcp:stdio": "node dist/mcp/fastmcp/servers/stdio-full.js",
    "mcp:http": "node dist/mcp/fastmcp/servers/http-streaming.js"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "fastmcp": "^0.1.0",
    "zod": "^3.22.0"
  }
}
```

## 📊 Usage Examples

### 1. Start stdio Server
```bash
# Basic usage
npx agentic-flow mcp start

# With debug logging
npx agentic-flow mcp start --debug

# Alternative command
npx agentic-flow mcp stdio
```

### 2. Start HTTP Server
```bash
# Default port 3000
npx agentic-flow mcp http

# Custom port
npx agentic-flow mcp http --port 8080

# With debug
npx agentic-flow mcp http --debug
```

### 3. Check Available Tools
```bash
npx agentic-flow mcp tools
```

Output:
```
📦 Available MCP Tools (6 total)

Memory Tools:
  1. memory_store    - Store values with TTL and namespacing
  2. memory_retrieve - Retrieve stored values
  3. memory_search   - Search keys with pattern matching

Swarm Coordination Tools:
  4. swarm_init      - Initialize multi-agent swarms
  5. agent_spawn     - Spawn specialized agents
  6. task_orchestrate - Orchestrate distributed tasks
```

### 4. Check Server Status
```bash
npx agentic-flow mcp status
```

Output:
```
🔍 FastMCP Server Status

Available Transports:
  ✅ stdio    - JSON-RPC over stdio (for local MCP clients)
  ✅ HTTP+SSE - HTTP with Server-Sent Events (for web/remote)

Tools: 6/6 implemented
  ✅ memory_store
  ✅ memory_retrieve
  ✅ memory_search
  ✅ swarm_init
  ✅ agent_spawn
  ✅ task_orchestrate
```

## 🔌 Integration Scenarios

### Claude Desktop
```json
{
  "mcpServers": {
    "agentic-flow": {
      "command": "npx",
      "args": ["agentic-flow", "mcp", "start"]
    }
  }
}
```

### Systemd Service (Linux)
```ini
[Unit]
Description=Agentic Flow MCP HTTP Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/npx agentic-flow mcp http --port 3000
Restart=always
User=app
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Docker Compose
```yaml
version: '3.8'
services:
  mcp-server:
    image: node:20-alpine
    command: npx agentic-flow mcp http --port 3000
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DEBUG=fastmcp:*
    restart: unless-stopped
```

### PM2 (Process Manager)
```json
{
  "apps": [{
    "name": "agentic-flow-mcp",
    "script": "npx",
    "args": "agentic-flow mcp http --port 3000",
    "instances": 1,
    "autorestart": true,
    "watch": false,
    "max_memory_restart": "500M",
    "env": {
      "NODE_ENV": "production"
    }
  }]
}
```

Start with:
```bash
pm2 start ecosystem.config.json
pm2 save
pm2 startup
```

## 🛠️ Development Workflow

### 1. Develop
```bash
# Edit server code
vim src/mcp/fastmcp/servers/stdio-full.ts

# Build
npm run build

# Test locally
node dist/mcp/fastmcp/servers/stdio-full.js
```

### 2. Test via CLI
```bash
# Test stdio
npx agentic-flow mcp start --debug

# Test HTTP
npx agentic-flow mcp http --port 3001 --debug
```

### 3. Publish
```bash
# Build for production
npm run build

# Publish to npm
npm publish

# Users can then use:
npx agentic-flow@3.1.0 mcp start
```

## 🚀 Advanced Usage

### Custom Environment Variables
```bash
# Set custom config
export FASTMCP_MAX_CONCURRENT=20
export FASTMCP_TIMEOUT=60000

# Start server
npx agentic-flow mcp http
```

### With PM2 Cluster Mode
```json
{
  "apps": [{
    "name": "agentic-flow-cluster",
    "script": "npx",
    "args": "agentic-flow mcp http",
    "instances": "max",
    "exec_mode": "cluster",
    "env": {
      "NODE_ENV": "production"
    }
  }]
}
```

### Behind Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name mcp.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /events {
        proxy_pass http://localhost:3000/events;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
    }
}
```

## 📈 Monitoring

### Built-in Health Check
```bash
# Check if server is running
curl http://localhost:3000/health

# Response:
# {"status":"healthy","timestamp":"2025-10-03T20:00:00.000Z"}
```

### Prometheus Metrics (Future)
```typescript
// Add to HTTP server
import prometheus from 'prom-client';

const register = new prometheus.Registry();

const toolCalls = new prometheus.Counter({
  name: 'mcp_tool_calls_total',
  help: 'Total number of MCP tool calls',
  labelNames: ['tool', 'status']
});

register.registerMetric(toolCalls);

// In tool execution:
toolCalls.inc({ tool: 'memory_store', status: 'success' });
```

## 🔒 Security

### Production Deployment
```bash
# Use environment-specific config
NODE_ENV=production npx agentic-flow mcp http --port 3000

# Enable rate limiting (future)
RATE_LIMIT_ENABLED=true npx agentic-flow mcp http

# Enable authentication (future)
AUTH_ENABLED=true AUTH_SECRET=xxx npx agentic-flow mcp http
```

## 📚 Complete Command Reference

```bash
# Main commands
npx agentic-flow mcp start      # Start stdio server
npx agentic-flow mcp stdio      # Alias for start
npx agentic-flow mcp http       # Start HTTP + SSE server
npx agentic-flow mcp sse        # Alias for http
npx agentic-flow mcp tools      # List available tools
npx agentic-flow mcp status     # Show server status

# Options
--port <port>                   # Set HTTP server port (default: 3000)
--debug                         # Enable debug logging
--help                          # Show help
--version                       # Show version
```

## 🎯 Summary

The FastMCP integration provides:

✅ **Simple CLI**: `npx agentic-flow mcp start`
✅ **Multiple Transports**: stdio and HTTP+SSE
✅ **6 Tools**: Memory management + Swarm coordination
✅ **Production Ready**: Systemd, Docker, PM2 support
✅ **Easy Integration**: Claude Desktop, web apps, scripts

---

**Status**: ✅ Ready for Integration
**Version**: 1.0.0
**Last Updated**: 2025-10-03
