/**
 * ModelRouter.stream() must record metrics and fall back like chat() does, and
 * cost-optimal routing must not mutate the caller's params.
 * Providers are in-memory fakes; no network.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelRouter } from '../../src/router/router.ts';
import type { ChatParams, StreamChunk } from '../../src/router/types.ts';

interface FakeOptions {
  chunks?: StreamChunk[];
  failBeforeFirstChunk?: boolean;
  failAfterFirstChunk?: boolean;
}

function fakeProvider(name: string, opts: FakeOptions = {}) {
  const received: ChatParams[] = [];
  const chunks: StreamChunk[] = opts.chunks ?? [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: `${name} says hi` } },
    { type: 'message_delta', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'message_stop' },
  ];
  const fail = () => Object.assign(new Error(`${name} down`), { provider: name });

  return {
    received,
    provider: {
      name,
      type: name,
      supportsStreaming: true,
      supportsTools: false,
      supportsMCP: false,
      validateCapabilities: () => true,
      async chat(params: ChatParams) {
        received.push(params);
        return {
          id: `${name}-1`,
          model: params.model,
          content: [{ type: 'text', text: 'ok' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 3, outputTokens: 2 },
        };
      },
      async *stream(params: ChatParams) {
        received.push(params);
        if (opts.failBeforeFirstChunk) throw fail();
        for (const [i, chunk] of chunks.entries()) {
          yield chunk;
          if (opts.failAfterFirstChunk && i === 0) throw fail();
        }
      },
    },
  };
}

function makeRouter(fakes: Record<string, ReturnType<typeof fakeProvider>>): ModelRouter {
  const dir = mkdtempSync(join(tmpdir(), 'router-'));
  const configPath = join(dir, 'router.config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      version: '1.0',
      defaultProvider: 'anthropic',
      fallbackChain: ['anthropic', 'openrouter'],
      providers: {},
      routing: { mode: 'manual' },
    }),
  );
  const router = new ModelRouter(configPath);
  const providers: Map<string, unknown> = (router as any).providers;
  providers.clear();
  for (const [type, fake] of Object.entries(fakes)) providers.set(type, fake.provider);
  return router;
}

const params = (): ChatParams => ({
  model: 'caller-model',
  messages: [{ role: 'user', content: 'summarize the release notes' }],
});

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('ModelRouter.stream', () => {
  let anthropic: ReturnType<typeof fakeProvider>;
  let openrouter: ReturnType<typeof fakeProvider>;

  beforeEach(() => {
    openrouter = fakeProvider('openrouter');
  });

  it('records metrics for a completed stream', async () => {
    anthropic = fakeProvider('anthropic');
    const router = makeRouter({ anthropic, openrouter });

    const chunks = await collect(router.stream(params(), 'coder'));

    expect(chunks).toHaveLength(3);
    const metrics = router.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.totalTokens).toEqual({ input: 10, output: 5 });
    expect(metrics.providerBreakdown.anthropic.requests).toBe(1);
    expect(metrics.agentBreakdown?.coder.requests).toBe(1);
  });

  it('falls back through the chain when the provider fails before streaming', async () => {
    anthropic = fakeProvider('anthropic', { failBeforeFirstChunk: true });
    const router = makeRouter({ anthropic, openrouter });

    const chunks = await collect(router.stream(params()));

    expect(chunks[0].delta?.text).toBe('openrouter says hi');
    expect(openrouter.received).toHaveLength(1);
    expect(router.getMetrics().providerBreakdown.openrouter.requests).toBe(1);
  });

  it('rethrows without falling back once chunks were yielded', async () => {
    anthropic = fakeProvider('anthropic', { failAfterFirstChunk: true });
    const router = makeRouter({ anthropic, openrouter });

    await expect(collect(router.stream(params()))).rejects.toThrow('anthropic down');
    expect(openrouter.received).toHaveLength(0);
  });
});

describe('cost-optimal routing', () => {
  function costOptimalRouter() {
    const anthropic = fakeProvider('anthropic');
    const openrouter = fakeProvider('openrouter');
    const router = makeRouter({ anthropic, openrouter });
    router.enableCostOptimalRouting({
      router: {
        route: () => ({
          id: 'openrouter/cheap-model',
          provider: 'openrouter',
          model: 'cheap-model',
          predictedQuality: 0.9,
          costPerMTok: 0.1,
          metBar: true,
        }),
      } as any,
      embed: () => [0.1, 0.2, 0.3],
    });
    return { router, openrouter };
  }

  it('sends the routed model without mutating the caller params (chat)', async () => {
    const { router, openrouter } = costOptimalRouter();
    const request = params();

    await router.chat(request);

    expect(openrouter.received[0].model).toBe('cheap-model');
    expect(request.model).toBe('caller-model');
  });

  it('sends the routed model without mutating the caller params (stream)', async () => {
    const { router, openrouter } = costOptimalRouter();
    const request = params();

    await collect(router.stream(request));

    expect(openrouter.received[0].model).toBe('cheap-model');
    expect(request.model).toBe('caller-model');
  });
});
