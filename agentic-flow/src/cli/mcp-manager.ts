#!/usr/bin/env node
/**
 * MCP Server Manager - CLI for adding/managing MCP servers
 *
 * Allows end users to add custom MCP servers without editing code:
 * - npx agentic-flow mcp add weather --npm weather-mcp
 * - npx agentic-flow mcp add local --local /path/to/server.js
 * - npx agentic-flow mcp list
 * - npx agentic-flow mcp remove weather
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
// child_process is imported dynamically where needed (spawnSync via import())
import { Command } from 'commander';

// Configuration file location
const CONFIG_DIR = path.join(os.homedir(), '.agentic-flow');
const CONFIG_FILE = path.join(CONFIG_DIR, 'mcp-config.json');

interface MCPServerConfig {
  enabled: boolean;
  type: 'npm' | 'local';
  package?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description?: string;
}

interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

/**
 * Load MCP configuration
 */
function loadConfig(): MCPConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { servers: {} };
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('❌ Error loading MCP config:', error);
    return { servers: {} };
  }
}

/**
 * Save MCP configuration
 */
function saveConfig(config: MCPConfig): void {
  // Ensure directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Add MCP server from JSON config (Claude-style)
 */
function addServerFromJson(name: string, configJson: string): void {
  const config = loadConfig();

  // Check if already exists
  if (config.servers[name]) {
    console.error(`❌ MCP server '${name}' already exists`);
    console.log('💡 Use update command or remove first');
    process.exit(1);
  }

  try {
    const serverConfig = JSON.parse(configJson);

    // Validate required fields
    if (!serverConfig.command) {
      console.error('❌ Config must include "command" field');
      process.exit(1);
    }

    // Build MCP server config
    const mcpConfig: MCPServerConfig = {
      enabled: true,
      type: serverConfig.npm ? 'npm' : 'local',
      package: serverConfig.npm,
      command: serverConfig.command,
      args: serverConfig.args || [],
      env: serverConfig.env || {},
      description: serverConfig.description || `MCP server: ${name}`
    };

    config.servers[name] = mcpConfig;
    saveConfig(config);

    console.log(`✅ Added MCP server: ${name}`);
    console.log(`   Type: ${mcpConfig.type}`);
    console.log(`   Command: ${mcpConfig.command} ${mcpConfig.args.join(' ')}`);
    if (Object.keys(mcpConfig.env).length > 0) {
      console.log(`   Environment: ${Object.keys(mcpConfig.env).length} vars`);
    }
    console.log('\n💡 Use it with: npx agentic-flow --agent coder --task "your task"');
  } catch (error: any) {
    console.error('❌ Invalid JSON config:', error.message);
    console.log('\nExpected format:');
    console.log('  \'{"command":"npx","args":["-y","weather-mcp"],"env":{"API_KEY":"xxx"}}\'');
    process.exit(1);
  }
}

/**
 * Add MCP server (flag-based)
 */
function addServer(options: {
  name: string;
  npm?: string;
  local?: string;
  command?: string;
  args?: string;
  env?: string[];
  desc?: string;
}): void {
  const config = loadConfig();

  // Check if already exists
  if (config.servers[options.name]) {
    console.error(`❌ MCP server '${options.name}' already exists`);
    console.log('💡 Use update command or remove first');
    process.exit(1);
  }

  let serverConfig: MCPServerConfig;

  if (options.npm) {
    // NPM package
    serverConfig = {
      enabled: true,
      type: 'npm',
      package: options.npm,
      command: 'npx',
      args: ['-y', options.npm],
      env: {},
      description: options.desc || `MCP server from ${options.npm}`
    };
  } else if (options.local) {
    // Local path
    serverConfig = {
      enabled: true,
      type: 'local',
      command: options.command || 'node',
      args: [options.local],
      env: {},
      description: options.desc || `Local MCP server at ${options.local}`
    };
  } else if (options.command) {
    // Custom command
    const args = options.args ? options.args.split(' ') : [];
    serverConfig = {
      enabled: true,
      type: 'local',
      command: options.command,
      args,
      env: {},
      description: options.desc || `Custom MCP server: ${options.command}`
    };
  } else {
    console.error('❌ Must specify --npm, --local, or --command');
    process.exit(1);
  }

  // Add environment variables
  if (options.env) {
    for (const envStr of options.env) {
      const [key, ...valueParts] = envStr.split('=');
      const value = valueParts.join('=');
      serverConfig.env[key] = value;
    }
  }

  config.servers[options.name] = serverConfig;
  saveConfig(config);

  console.log(`✅ Added MCP server: ${options.name}`);
  console.log(`   Type: ${serverConfig.type}`);
  if (serverConfig.package) {
    console.log(`   Package: ${serverConfig.package}`);
  }
  console.log(`   Command: ${serverConfig.command} ${serverConfig.args.join(' ')}`);
  if (Object.keys(serverConfig.env).length > 0) {
    console.log(`   Environment: ${Object.keys(serverConfig.env).length} vars`);
  }
  console.log('\n💡 Run tests with: npx agentic-flow mcp test ' + options.name);
}

/**
 * List MCP servers
 */
function listServers(options: { enabled?: boolean; verbose?: boolean }): void {
  const config = loadConfig();
  const servers = Object.entries(config.servers);

  if (servers.length === 0) {
    console.log('No MCP servers configured');
    console.log('\n💡 Add a server with: npx agentic-flow mcp add NAME --npm PACKAGE');
    return;
  }

  console.log('Configured MCP Servers:\n');

  for (const [name, server] of servers) {
    // Filter by enabled status
    if (options.enabled && !server.enabled) {
      continue;
    }

    const status = server.enabled ? '✅' : '❌';
    const state = server.enabled ? 'enabled' : 'disabled';

    console.log(`${status} ${name} (${state})`);
    console.log(`   Type: ${server.type}`);

    if (server.package) {
      console.log(`   Package: ${server.package}`);
    } else {
      console.log(`   Command: ${server.command} ${server.args.join(' ')}`);
    }

    if (server.description) {
      console.log(`   Description: ${server.description}`);
    }

    if (options.verbose) {
      console.log(`   Environment:`);
      for (const [key, value] of Object.entries(server.env)) {
        const masked = value.length > 10 ? `${value.slice(0, 4)}***${value.slice(-4)}` : '***';
        console.log(`     ${key}: ${masked}`);
      }
    }

    console.log('');
  }
}

/**
 * Remove MCP server
 */
function removeServer(name: string, options: { confirm?: boolean }): void {
  const config = loadConfig();

  if (!config.servers[name]) {
    console.error(`❌ MCP server '${name}' not found`);
    process.exit(1);
  }

  if (!options.confirm) {
    console.log(`⚠️  This will remove MCP server: ${name}`);
    console.log('   Use --confirm to proceed');
    process.exit(0);
  }

  delete config.servers[name];
  saveConfig(config);

  console.log(`✅ Removed MCP server: ${name}`);
}

/**
 * Enable/disable MCP server
 */
function toggleServer(name: string, enabled: boolean): void {
  const config = loadConfig();

  if (!config.servers[name]) {
    console.error(`❌ MCP server '${name}' not found`);
    process.exit(1);
  }

  config.servers[name].enabled = enabled;
  saveConfig(config);

  const action = enabled ? 'Enabled' : 'Disabled';
  console.log(`✅ ${action} MCP server: ${name}`);
}

/**
 * Update MCP server
 */
function updateServer(name: string, options: {
  version?: string;
  env?: string[];
  command?: string;
  args?: string;
}): void {
  const config = loadConfig();

  if (!config.servers[name]) {
    console.error(`❌ MCP server '${name}' not found`);
    process.exit(1);
  }

  const server = config.servers[name];

  // Update version for NPM packages
  if (options.version && server.type === 'npm' && server.package) {
    const packageName = server.package.split('@')[0];
    server.package = `${packageName}@${options.version}`;
    server.args = ['-y', server.package];
  }

  // Update environment variables
  if (options.env) {
    for (const envStr of options.env) {
      const [key, ...valueParts] = envStr.split('=');
      const value = valueParts.join('=');
      server.env[key] = value;
    }
  }

  // Update command
  if (options.command) {
    server.command = options.command;
  }

  // Update args
  if (options.args) {
    server.args = options.args.split(' ');
  }

  saveConfig(config);
  console.log(`✅ Updated MCP server: ${name}`);
}

/**
 * Test MCP server
 */
async function testServer(name: string, options: { verbose?: boolean }): Promise<void> {
  const config = loadConfig();

  if (!config.servers[name]) {
    console.error(`❌ MCP server '${name}' not found`);
    process.exit(1);
  }

  const server = config.servers[name];

  console.log(`Testing MCP server: ${name}`);
  console.log(`Command: ${server.command} ${server.args.join(' ')}\n`);

  try {
    // Build environment
    const env = { ...process.env, ...server.env };

    // Test if server responds (send tools/list request).
    // Use spawnSync with stdio pipe instead of a shell command to avoid injection
    // via testRequest JSON or server.command/args values.
    const { spawnSync } = await import('child_process');
    const testRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1
    });

    const spawnResult = spawnSync(server.command, server.args, {
      encoding: 'utf-8',
      input: testRequest + '\n',
      env,
      timeout: 5000,
    });

    if (spawnResult.error) {
      throw spawnResult.error;
    }
    const result = spawnResult.stdout || '';

    if (options.verbose) {
      console.log('Response:', result);
    }

    // Try to parse response
    const response = JSON.parse(result.split('\n')[0]);

    if (response.result?.tools) {
      console.log(`✅ Server started successfully`);
      console.log(`✅ Responds to tools/list`);
      console.log(`✅ Found ${response.result.tools.length} tools:`);

      for (const tool of response.result.tools) {
        console.log(`   - ${tool.name}: ${tool.description || 'No description'}`);
      }

      console.log('\n✅ Server is working correctly');
    } else {
      console.log('⚠️  Server responded but no tools found');
    }
  } catch (error: any) {
    console.error('❌ Server test failed:', error.message);
    process.exit(1);
  }
}

/**
 * Show server info
 */
function showInfo(name: string): void {
  const config = loadConfig();

  if (!config.servers[name]) {
    console.error(`❌ MCP server '${name}' not found`);
    process.exit(1);
  }

  const server = config.servers[name];

  console.log(`MCP Server: ${name}`);
  console.log(`Status: ${server.enabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`Type: ${server.type}`);

  if (server.package) {
    console.log(`Package: ${server.package}`);
  }

  console.log(`Command: ${server.command} ${server.args.join(' ')}`);

  if (Object.keys(server.env).length > 0) {
    console.log(`Environment:`);
    for (const [key, value] of Object.entries(server.env)) {
      const masked = value.length > 10 ? `***${key.slice(0, 3)}***` : '***';
      console.log(`  ${key}: ${masked}`);
    }
  }

  if (server.description) {
    console.log(`Description: ${server.description}`);
  }

  console.log(`\nConfig file: ${CONFIG_FILE}`);
}

/**
 * Export configuration
 */
function exportConfig(): void {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
}

/**
 * Import configuration
 */
function importConfig(configJson: string): void {
  try {
    const importedConfig: MCPConfig = JSON.parse(configJson);

    // Validate structure
    if (!importedConfig.servers || typeof importedConfig.servers !== 'object') {
      throw new Error('Invalid config format');
    }

    const config = loadConfig();

    // Merge configs
    for (const [name, server] of Object.entries(importedConfig.servers)) {
      config.servers[name] = server;
    }

    saveConfig(config);

    const count = Object.keys(importedConfig.servers).length;
    console.log(`✅ Imported ${count} MCP server(s)`);
  } catch (error: any) {
    console.error('❌ Import failed:', error.message);
    process.exit(1);
  }
}

// CLI setup
const program = new Command();

program
  .name('agentic-flow mcp')
  .description('Manage MCP servers for agentic-flow')
  .version('1.0.0')
  .addHelpText('after', `
Examples:
  # Add MCP server (Claude-style JSON config)
  $ npx agentic-flow mcp add weather '{"command":"npx","args":["-y","weather-mcp"],"env":{"API_KEY":"xxx"}}'

  # Add MCP server (simple flags)
  $ npx agentic-flow mcp add weather --npm weather-mcp --env "API_KEY=xxx"

  # Add local MCP server
  $ npx agentic-flow mcp add my-tools --local /path/to/server.js

  # List all configured servers
  $ npx agentic-flow mcp list

  # Test server
  $ npx agentic-flow mcp test weather

  # Use in agents (automatic)
  $ npx agentic-flow --agent researcher --task "Get weather for Tokyo"

Config file: ~/.agentic-flow/mcp-config.json
`);

program
  .command('add <name> [config]')
  .description('Add a new MCP server (config as JSON string or options)')
  .option('--npm <package>', 'NPM package name (e.g., weather-mcp@latest)')
  .option('--local <path>', 'Local file path (e.g., /path/to/server.js)')
  .option('--command <cmd>', 'Custom command (e.g., python3)')
  .option('--args <args>', 'Command arguments')
  .option('--env <key=value>', 'Environment variable (can use multiple times)')
  .option('--desc <description>', 'Server description')
  .action((name, config, options) => {
    if (config) {
      // JSON config format (like Claude MCP)
      addServerFromJson(name, config);
    } else {
      // Flag-based format
      addServer({ name, ...options });
    }
  });

program
  .command('list')
  .description('List configured MCP servers')
  .option('--enabled', 'Show only enabled servers')
  .option('--verbose', 'Show detailed information')
  .action((options) => listServers(options));

program
  .command('remove <name>')
  .description('Remove an MCP server')
  .option('--confirm', 'Confirm removal')
  .action((name, options) => removeServer(name, options));

program
  .command('enable <name>')
  .description('Enable an MCP server')
  .action((name) => toggleServer(name, true));

program
  .command('disable <name>')
  .description('Disable an MCP server')
  .action((name) => toggleServer(name, false));

program
  .command('update <name>')
  .description('Update MCP server configuration')
  .option('--version <version>', 'Update NPM package version')
  .option('--env <key=value>', 'Update environment variable (can use multiple times)')
  .option('--command <cmd>', 'Update command')
  .option('--args <args>', 'Update arguments')
  .action((name, options) => updateServer(name, options));

program
  .command('test <name>')
  .description('Test if MCP server works')
  .option('--verbose', 'Show detailed output')
  .action((name, options) => testServer(name, options));

program
  .command('info <name>')
  .description('Show MCP server information')
  .action((name) => showInfo(name));

program
  .command('export')
  .description('Export MCP configuration to stdout')
  .action(() => exportConfig());

program
  .command('import')
  .description('Import MCP configuration from stdin')
  .action(() => {
    let data = '';
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => importConfig(data));
  });

program.parse();
