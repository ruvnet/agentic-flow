export type McpProfile = 'readonly' | 'retrieval' | 'learning' | 'admin';

const READONLY = [
  /^agentic_flow_(list|list_all|agent_info|check_conflicts)/,
  /^agentdb_(stats|pattern_search|pattern_stats)$/,
  /^harness_(capabilities|manifest|verify)$/,
  /parse_markdown$/,
  /_(stats|get_profile|list_profiles|benchmark)$/,
];
const RETRIEVAL = [...READONLY, /search$/, /context$/];
const LEARNING = [...RETRIEVAL, /^agentic_flow_agent$/, /^agentdb_pattern_store$/, /^sona_/];

export function parseMcpProfile(value: string | undefined): McpProfile {
  const profile = value ?? 'readonly';
  if (!['readonly', 'retrieval', 'learning', 'admin'].includes(profile)) {
    throw new Error(`invalid MCP profile: ${profile}`);
  }
  return profile as McpProfile;
}

export function isMcpToolAllowed(
  name: string,
  options: { profile: McpProfile; allowDarwinExecution?: boolean },
): boolean {
  if (name === 'harness_repair') {
    return options.profile === 'admin' && options.allowDarwinExecution === true;
  }
  if (options.profile === 'admin') return true;
  const rules = options.profile === 'learning' ? LEARNING :
    options.profile === 'retrieval' ? RETRIEVAL : READONLY;
  return rules.some((rule) => rule.test(name));
}

export function installMcpPolicy<T extends { addTool: (tool: { name: string }) => unknown }>(
  server: T,
  options: { profile: McpProfile; allowDarwinExecution?: boolean },
): T {
  const addTool = server.addTool.bind(server);
  server.addTool = ((tool: { name: string }) => {
    if (isMcpToolAllowed(tool.name, options)) return addTool(tool);
    return undefined;
  }) as T['addTool'];
  return server;
}
