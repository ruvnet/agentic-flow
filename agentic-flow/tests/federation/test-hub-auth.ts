/** Hub authentication: a token signed with the hub's secret is required, and identity comes from it. Run: npx tsx tests/federation/test-hub-auth.ts */
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { FederationHubServer } from '../../src/federation/FederationHubServer.js';
import { SecurityManager } from '../../src/federation/SecurityManager.js';

const SECRET = 'test-secret-test-secret-test-secret';
const PORT = 18443;
const signer = new SecurityManager(SECRET);
const stranger = new SecurityManager('another-secret-another-secret-00');
const inAnHour = Date.now() + 3_600_000;

function ask(message: object): Promise<{ type: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on('open', () => ws.send(JSON.stringify({ timestamp: Date.now(), ...message })));
    ws.on('message', (raw) => { resolve(JSON.parse(raw.toString())); ws.close(); });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 3000);
  });
}

const hub = new FederationHubServer({ port: PORT, jwtSecret: SECRET, dbPath: ':memory:' });
await hub.start();
try {
  const good = await signer.createAgentToken({ agentId: 'a1', tenantId: 't1', expiresAt: inAnHour });
  assert.equal((await ask({ type: 'auth', agentId: 'a1', tenantId: 't1', token: good })).type, 'ack', 'valid token is accepted');
  assert.equal((await ask({ type: 'auth', agentId: 'a1', tenantId: 't1', token: 'x' })).type, 'error', 'arbitrary token is refused');
  const forged = await stranger.createAgentToken({ agentId: 'a1', tenantId: 't1', expiresAt: inAnHour });
  assert.equal((await ask({ type: 'auth', agentId: 'a1', tenantId: 't1', token: forged })).type, 'error', 'token from another secret is refused');
  assert.equal((await ask({ type: 'auth', agentId: 'a1', tenantId: 'victim', token: good })).type, 'error', 'a token cannot be used for another tenant');
  const old = await signer.createAgentToken({ agentId: 'a1', tenantId: 't1', expiresAt: Date.now() - 1000 });
  assert.equal((await ask({ type: 'auth', agentId: 'a1', tenantId: 't1', token: old })).type, 'error', 'expired token is refused');
  assert.equal((hub as any).config.host, '127.0.0.1', 'binds loopback by default');
  console.log('hub auth: all checks passed');
} finally {
  await hub.stop();
}
