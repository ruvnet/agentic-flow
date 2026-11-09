/**
 * The MCP servers report the installed agentic-flow version in
 * serverInfo.version. The stdio server that `agentic-flow mcp` starts
 * reported a hard-coded '1.0.8' through 3.5.0.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claudeFlowSdkServer } from '../../src/mcp/claudeFlowSdkServer.js';

const pkgVersion: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const root = fileURLToPath(new URL('../..', import.meta.url));

describe('MCP serverInfo.version', () => {
  it('standalone stdio server (agentic-flow mcp) reports the package version', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/standalone-stdio.ts'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    try {
      const info = await new Promise<any>((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error('no initialize response in 20 s')), 20_000);
        child.stdout.on('data', (d) => {
          buf += String(d);
          for (const line of buf.split('\n')) {
            try {
              const msg = JSON.parse(line);
              if (msg.id === 1) { clearTimeout(timer); resolve(msg.result.serverInfo); }
            } catch { /* partial line */ }
          }
        });
        child.on('exit', (code) => reject(new Error(`server exited (${code})`)));
        child.stdin.write(JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'version-test', version: '0.0.0' } },
        }) + '\n');
      });
      expect(info.name).toBe('agentic-flow');
      expect(info.version).toBe(pkgVersion);
    } finally {
      child.kill('SIGKILL');
    }
  }, 30_000);

  it('in-process SDK server reports the package version', () => {
    const server = (claudeFlowSdkServer as any).instance;
    const info = server?.server?._serverInfo ?? server?._serverInfo;
    expect(info?.version).toBe(pkgVersion);
  });
});
