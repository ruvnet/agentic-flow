import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { claudeFlowSdkServer } from '../../src/mcp/claudeFlowSdkServer.js';
import { withPortableDescriptions } from '../../src/mcp/sdk-tool-schema.js';
import { swarmInitTool } from '../../src/mcp/fastmcp/tools/swarm/init.js';
import { harnessRepairTool } from '../../src/mcp/tools/harness-tools.js';
import { p2pSwarmPublishTool } from '../../src/mcp/fastmcp/tools/swarm/p2p-swarm-tools.js';

type JsonRpcMessage = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: any };

/** Minimal linked in-memory transport, so the test needs no MCP client package. */
class Pipe {
  peer!: Pipe;
  onmessage?: (message: JsonRpcMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  async start(): Promise<void> {}
  async send(message: JsonRpcMessage): Promise<void> {
    queueMicrotask(() => this.peer.onmessage?.(message));
  }
  async close(): Promise<void> {
    this.onclose?.();
  }
}

async function listSdkServerTools(): Promise<any[]> {
  const serverSide = new Pipe();
  const clientSide = new Pipe();
  serverSide.peer = clientSide;
  clientSide.peer = serverSide;
  const pending = new Map<number, (result: any) => void>();
  clientSide.onmessage = (message) => {
    if (message.id !== undefined) pending.get(message.id)?.(message.result);
  };
  const request = (id: number, method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      pending.set(id, resolve);
      void clientSide.send({ jsonrpc: '2.0', id, method, params });
    });

  const server = (claudeFlowSdkServer as any).instance;
  await server.connect(serverSide);
  try {
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'zod4-migration-test', version: '0.0.0' },
    });
    await clientSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = await request(2, 'tools/list', {});
    return listed.tools;
  } finally {
    await server.close();
  }
}

describe('zod 4 dependency graph', () => {
  it('declares zod 4 and locks no zod 3 copy anywhere in the tree', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));

    expect(packageJson.dependencies.zod).toMatch(/^\^4\./);
    const zodCopies = Object.entries<any>(lock.packages)
      .filter(([path]) => /(^|\/)node_modules\/zod$/.test(path))
      .map(([path, entry]) => `${path}@${entry.version}`);
    expect(zodCopies.length).toBeGreaterThan(0);
    for (const copy of zodCopies) expect(copy).toMatch(/@4\./);
  });
});

describe('claude-agent-sdk in-process server schemas', () => {
  it('keeps every parameter description in tools/list', async () => {
    const tools = await listSdkServerTools();

    expect(tools.map((t) => t.name)).toContain('memory_store');
    for (const tool of tools) {
      for (const [param, schema] of Object.entries<any>(tool.inputSchema.properties ?? {})) {
        expect(schema.description, `${tool.name}.${param}`).toEqual(expect.any(String));
      }
    }
  });

  it('leaves defaulted parameters optional and keeps their defaults', async () => {
    const tools = await listSdkServerTools();
    const memoryStore = tools.find((t) => t.name === 'memory_store');
    const swarmInit = tools.find((t) => t.name === 'swarm_init');

    expect(memoryStore.inputSchema.required).toEqual(['key', 'value']);
    expect(memoryStore.inputSchema.properties.namespace).toMatchObject({
      type: 'string',
      default: 'default',
      description: 'Memory namespace',
    });
    expect(swarmInit.inputSchema.required).toEqual(['topology']);
    expect(swarmInit.inputSchema.properties.topology.enum).toEqual(['mesh', 'hierarchical', 'ring', 'star']);
  });
});

describe('withPortableDescriptions', () => {
  it('pins a JSON Schema carrying the description without changing validation', () => {
    const shape = withPortableDescriptions({
      mode: z.enum(['a', 'b']).optional().default('a').describe('Mode'),
    });
    const schema = z.object(shape);

    expect(shape.mode._zod.toJSONSchema?.()).toEqual({
      type: 'string',
      enum: ['a', 'b'],
      default: 'a',
      description: 'Mode',
    });
    expect(schema.parse({})).toEqual({ mode: 'a' });
    expect(schema.safeParse({ mode: 'c' }).success).toBe(false);
  });

  it('leaves the caller schemas untouched and convertible by zod itself', () => {
    const original = { name: z.string().describe('Name') };
    const portable = withPortableDescriptions(original);

    expect(portable.name).not.toBe(original.name);
    expect(original.name._zod.toJSONSchema).toBeUndefined();
    expect(z.toJSONSchema(z.object(original)).properties?.name).toMatchObject({ description: 'Name' });
    expect(z.toJSONSchema(z.object(portable)).properties?.name).toMatchObject({ description: 'Name' });
  });

  it('handles one schema instance shared by several fields', () => {
    const shared = z.string().describe('Shared');
    const portable = withPortableDescriptions({ a: shared, b: shared });

    expect(z.toJSONSchema(z.object(portable)).properties).toEqual({
      a: { type: 'string', description: 'Shared' },
      b: { type: 'string', description: 'Shared' },
    });
  });
});

describe('tool argument validation under zod 4', () => {
  const swarmInitParams = swarmInitTool.parameters as z.ZodTypeAny;

  it('applies defaults for omitted optional arguments', () => {
    expect(swarmInitParams.parse({ topology: 'mesh' })).toEqual({
      topology: 'mesh',
      maxAgents: 8,
      strategy: 'balanced',
    });
  });

  it('strips unknown keys rather than rejecting them', () => {
    expect(swarmInitParams.parse({ topology: 'ring', extra: true })).not.toHaveProperty('extra');
  });

  it('rejects values outside an enum with the zod 4 invalid_value issue code', () => {
    const result = swarmInitParams.safeParse({ topology: 'torus' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ code: 'invalid_value', path: ['topology'] });
  });

  it('rejects non-integer and non-positive generation counts in harness_repair', async () => {
    await expect(harnessRepairTool.execute({ repoRoot: '.', generations: 1.5 })).rejects.toThrow(z.ZodError);
    await expect(harnessRepairTool.execute({ repoRoot: '.', generations: 0 })).rejects.toThrow(z.ZodError);
  });

  it('keeps z.any() payloads optional, as they were under zod 3', () => {
    // zod 4 makes a bare z.any() object key required; the schema opts back out.
    expect(p2pSwarmPublishTool.schema.safeParse({ topic: 't' }).success).toBe(true);
  });
});
