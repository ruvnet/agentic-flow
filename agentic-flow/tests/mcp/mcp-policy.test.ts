import { describe, expect, it } from 'vitest';
import { installMcpPolicy, isMcpToolAllowed, parseMcpProfile } from '../../src/mcp/mcp-policy.js';

describe('MCP capability profiles', () => {
  it('defaults to readonly and rejects invalid profiles', () => {
    expect(parseMcpProfile(undefined)).toBe('readonly');
    expect(() => parseMcpProfile('root')).toThrow('invalid MCP profile');
  });

  it('does not expose mutations or Darwin by default', () => {
    expect(isMcpToolAllowed('harness_verify', { profile: 'readonly' })).toBe(true);
    expect(isMcpToolAllowed('agentdb_pattern_store', { profile: 'readonly' })).toBe(false);
    expect(isMcpToolAllowed('harness_repair', { profile: 'readonly' })).toBe(false);
    expect(isMcpToolAllowed('harness_repair', { profile: 'admin' })).toBe(false);
    expect(isMcpToolAllowed('harness_repair', {
      profile: 'admin', allowDarwinExecution: true,
    })).toBe(true);
  });

  it('filters discovery at registration time', () => {
    const names: string[] = [];
    const server = installMcpPolicy({
      addTool: (tool: { name: string }) => names.push(tool.name),
    }, { profile: 'readonly' });
    server.addTool({ name: 'harness_verify' });
    server.addTool({ name: 'agent_booster_edit_file' });
    expect(names).toEqual(['harness_verify']);
  });
});
