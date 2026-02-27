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
    timestamp: Date.now(),
    etv: 0.5,
    eiv: 0.7,
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

  it('saveMessage + retrieveContext returns stored data', async () => {
    const input = makeInput('msg-1');
    const ok = await service.saveMessage(input);
    expect(ok).toBe(true);

    const ctx = await service.retrieveContext('test-user-1', 'some query');
    expect(ctx).not.toBeNull();
    expect(ctx!.anchors.length).toBe(1);
    expect(ctx!.anchors[0].anchorId).toBe('msg-1');
    expect(ctx!.anchors[0].content).toBe(input.content);
    expect(ctx!.anchors[0].etv).toBe(0.5);
    expect(ctx!.anchors[0].eiv).toBe(0.7);
    expect(ctx!.semantic.length).toBe(1);
    expect(ctx!.semantic[0].schemaId).toBe('msg-1');
  });

  it('different users are isolated', async () => {
    await service.saveMessage(makeInput('msg-u1', 'test-user-1'));
    await service.saveMessage(makeInput('msg-u2', 'test-user-2'));

    const ctx1 = await service.retrieveContext('test-user-1', '');
    const ctx2 = await service.retrieveContext('test-user-2', '');

    expect(ctx1).not.toBeNull();
    expect(ctx1!.anchors.length).toBe(1);
    expect(ctx1!.anchors[0].anchorId).toBe('msg-u1');
    expect(ctx1!.semantic.length).toBe(1);
    expect(ctx1!.semantic[0].schemaId).toBe('msg-u1');

    expect(ctx2).not.toBeNull();
    expect(ctx2!.anchors.length).toBe(1);
    expect(ctx2!.anchors[0].anchorId).toBe('msg-u2');
    expect(ctx2!.semantic.length).toBe(1);
    expect(ctx2!.semantic[0].schemaId).toBe('msg-u2');
  });

  it('purgeUser removes both graph and vector data', async () => {
    await service.saveMessage(makeInput('msg-1', 'test-user-1'));
    await service.saveMessage(makeInput('msg-2', 'test-user-2'));

    const ok = await service.purgeUser('test-user-1');
    expect(ok).toBe(true);

    const ctx1 = await service.retrieveContext('test-user-1', '');
    expect(ctx1).not.toBeNull();
    expect(ctx1!.anchors.length).toBe(0);
    expect(ctx1!.semantic.length).toBe(0);

    const ctx2 = await service.retrieveContext('test-user-2', '');
    expect(ctx2).not.toBeNull();
    expect(ctx2!.anchors.length).toBe(1);
    expect(ctx2!.semantic.length).toBe(1);
  });

  it('healthCheck returns both true when DBs running', async () => {
    const health = await service.healthCheck();
    expect(health.falkor).toBe(true);
    expect(health.chroma).toBe(true);
  });

  it('saveMessage returns false when Falkor unreachable', async () => {
    const origUrl = process.env.LORA_FALKOR_URL;
    process.env.LORA_FALKOR_URL = 'redis://127.0.0.1:19999';
    resetFalkorClient();

    const badAnchor = new FalkorAnchorAdapter();
    const partialService = new MemoryService(badAnchor, vectorAdapter);
    const ok = await partialService.saveMessage(makeInput('msg-fail'));
    expect(ok).toBe(false);

    process.env.LORA_FALKOR_URL = origUrl;
    resetFalkorClient();
  });

  it('retrieveContext returns null when Chroma unreachable', async () => {
    const origUrl = process.env.LORA_CHROMA_URL;
    process.env.LORA_CHROMA_URL = 'http://127.0.0.1:19999';
    resetChromaClient();

    const badVector = new ChromaSchemaAdapter();
    const partialService = new MemoryService(anchorAdapter, badVector);
    const ctx = await partialService.retrieveContext('test-user-1', '');
    expect(ctx).toBeNull();

    process.env.LORA_CHROMA_URL = origUrl;
    resetChromaClient();
  });
});
