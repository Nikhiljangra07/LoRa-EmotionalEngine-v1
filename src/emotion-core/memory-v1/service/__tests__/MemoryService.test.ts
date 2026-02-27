import { MemoryService, type MemorySaveInput } from '../MemoryService';
import { FalkorAnchorAdapter } from '../../db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../../db/ChromaSchemaAdapter';
import { getFalkorClient, getFalkorUrl, resetFalkorClient } from '../../db/falkorClient';
import { resetChromaClient } from '../../db/chromaClient';

const DB_ON = process.env.LORA_TEST_DB === '1';

async function assertFalkorReachable(): Promise<void> {
  const url = getFalkorUrl();
  try {
    const client = getFalkorClient();
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error('No PONG');
  } catch {
    resetFalkorClient();
    throw new Error(
      `[MemoryServiceTest] FalkorDB not reachable at ${url}. Start it with: npm run falkor:start`,
    );
  }
}

async function assertChromaReachable(): Promise<void> {
  const url = process.env.LORA_CHROMA_URL;
  if (!url) {
    throw new Error('[MemoryServiceTest] LORA_CHROMA_URL not set. Export it before running DB tests.');
  }
  try {
    const res = await fetch(`${url}/api/v2/heartbeat`);
    if (!res.ok) throw new Error();
  } catch {
    throw new Error(
      `[MemoryServiceTest] ChromaDB not reachable at ${url}. Start it with: npm run chroma:start`,
    );
  }
}

function makeInput(
  messageId: string,
  userId: string = 'test-user-1',
  overrides?: Partial<MemorySaveInput>,
): MemorySaveInput {
  return {
    userId,
    messageId,
    content: `Message content for ${messageId}`,
    timestamp: 1700000000000,
    emotion: {
      valence: 0.6,
      arousal: 0.4,
      expressionStrength: 0.8,
      inferenceReliability: 0.9,
    },
    metrics: {
      etv: 42,
      eiv: 55,
      band: 'B2',
    },
    ...overrides,
  };
}

(DB_ON ? describe : describe.skip)('MemoryService (DB)', () => {
  let service: MemoryService;
  let anchorAdapter: FalkorAnchorAdapter;
  let vectorAdapter: ChromaSchemaAdapter;
  let restoreWarn: () => void;

  beforeAll(async () => {
    await assertFalkorReachable();
    await assertChromaReachable();

    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (msg.includes('No embedding function configuration found')) return;
      originalWarn.apply(console, args as [string?, ...unknown[]]);
    };
    restoreWarn = () => {
      console.warn = originalWarn;
    };

    anchorAdapter = new FalkorAnchorAdapter();
    vectorAdapter = new ChromaSchemaAdapter();
    service = new MemoryService(anchorAdapter, vectorAdapter);
  });

  afterAll(() => {
    restoreWarn?.();
    resetFalkorClient();
  });

  beforeEach(async () => {
    await anchorAdapter.purgeUser('test-user-1');
    await anchorAdapter.purgeUser('test-user-2');
    await vectorAdapter.purgeUser('test-user-1');
    await vectorAdapter.purgeUser('test-user-2');
  });

  afterEach(async () => {
    const falkorUrl = process.env.LORA_FALKOR_URL ?? '';
    if (!falkorUrl.includes('19999')) {
      await anchorAdapter.purgeUser('test-user-1');
      await anchorAdapter.purgeUser('test-user-2');
    }
    await vectorAdapter.purgeUser('test-user-1');
    await vectorAdapter.purgeUser('test-user-2');
    resetFalkorClient();
  });

  it('saveMessage + retrieveContext roundtrip with emotion and metrics', async () => {
    const input = makeInput('msg-1');
    const ok = await service.saveMessage(input);
    expect(ok).toBe(true);

    const ctx = await service.retrieveContext('test-user-1', 'some query');
    expect(ctx.degraded.falkor).toBe(false);
    expect(ctx.degraded.chroma).toBe(false);

    expect(ctx.anchors.length).toBe(1);
    const anchor = ctx.anchors[0];
    expect(anchor.anchorId).toBe('msg-1');
    expect(anchor.contentSummary).toBe(input.content);
    expect(anchor.timestamp).toBe(1700000000000);
    expect(anchor.emotion.valence).toBe(0.6);
    expect(anchor.emotion.arousal).toBe(0.4);
    expect(anchor.emotion.expressionStrength).toBe(0.8);
    expect(anchor.emotion.inferenceReliability).toBe(0.9);
    expect(anchor.metrics.etv).toBe(42);
    expect(anchor.metrics.eiv).toBe(55);
    expect(anchor.metrics.band).toBe('B2');

    expect(ctx.semantic.length).toBe(1);
    expect(ctx.semantic[0].schemaId).toBe('msg-1');
    expect(ctx.semantic[0].salienceWeight).toBe(42);
    expect(ctx.semantic[0].createdAt).toBe(1700000000000);
  });

  it('different users are isolated', async () => {
    await service.saveMessage(makeInput('msg-u1', 'test-user-1'));
    await service.saveMessage(makeInput('msg-u2', 'test-user-2'));

    const ctx1 = await service.retrieveContext('test-user-1', '');
    const ctx2 = await service.retrieveContext('test-user-2', '');

    expect(ctx1.degraded.falkor).toBe(false);
    expect(ctx1.anchors.length).toBe(1);
    expect(ctx1.anchors[0].anchorId).toBe('msg-u1');
    expect(ctx1.semantic.length).toBe(1);

    expect(ctx2.degraded.falkor).toBe(false);
    expect(ctx2.anchors.length).toBe(1);
    expect(ctx2.anchors[0].anchorId).toBe('msg-u2');
    expect(ctx2.semantic.length).toBe(1);
  });

  it('purgeUser removes both graph and vector data', async () => {
    await service.saveMessage(makeInput('msg-1', 'test-user-1'));
    await service.saveMessage(makeInput('msg-2', 'test-user-2'));

    const ok = await service.purgeUser('test-user-1');
    expect(ok).toBe(true);

    const ctx1 = await service.retrieveContext('test-user-1', '');
    expect(ctx1.anchors.length).toBe(0);
    expect(ctx1.semantic.length).toBe(0);

    const ctx2 = await service.retrieveContext('test-user-2', '');
    expect(ctx2.anchors.length).toBe(1);
    expect(ctx2.semantic.length).toBe(1);
  });

  it('healthCheck returns both true when DBs running', async () => {
    const health = await service.healthCheck();
    expect(health.falkor).toBe(true);
    expect(health.chroma).toBe(true);
  });

  it('saveMessage returns false when Falkor unreachable; retrieveContext degrades', async () => {
    const preSaved = await service.saveMessage(makeInput('msg-pre', 'test-user-1'));
    expect(preSaved).toBe(true);

    const origUrl = process.env.LORA_FALKOR_URL;
    process.env.LORA_FALKOR_URL = 'redis://127.0.0.1:19999';
    resetFalkorClient();

    const badAnchor = new FalkorAnchorAdapter();
    const partialService = new MemoryService(badAnchor, vectorAdapter);

    const ok = await partialService.saveMessage(makeInput('msg-fail'));
    expect(ok).toBe(false);

    const ctx = await partialService.retrieveContext('test-user-1', '');
    expect(ctx.degraded.falkor).toBe(true);
    expect(ctx.anchors).toEqual([]);
    expect(ctx.semantic.length).toBeGreaterThanOrEqual(1);
    const schemaIds = ctx.semantic.map((s) => s.schemaId);
    expect(schemaIds).toContain('msg-pre');

    process.env.LORA_FALKOR_URL = origUrl;
    resetFalkorClient();
  });

  it('retrieveContext degrades when Chroma unreachable', async () => {
    const preSaved = await service.saveMessage(makeInput('msg-pre', 'test-user-1'));
    expect(preSaved).toBe(true);

    const origUrl = process.env.LORA_CHROMA_URL;
    process.env.LORA_CHROMA_URL = 'http://127.0.0.1:19999';
    resetChromaClient();

    const badVector = new ChromaSchemaAdapter();
    const partialService = new MemoryService(anchorAdapter, badVector);

    const ctx = await partialService.retrieveContext('test-user-1', '');
    expect(ctx.degraded.chroma).toBe(true);
    expect(ctx.semantic).toEqual([]);
    expect(ctx.anchors.length).toBeGreaterThanOrEqual(1);
    const anchorIds = ctx.anchors.map((a) => a.anchorId);
    expect(anchorIds).toContain('msg-pre');

    process.env.LORA_CHROMA_URL = origUrl;
    resetChromaClient();
  });
});
