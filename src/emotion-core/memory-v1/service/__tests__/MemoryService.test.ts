import { MemoryService, type MemorySaveInput } from '../MemoryService';
import { FalkorAnchorAdapter } from '../../db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../../db/ChromaSchemaAdapter';
import { FalkorFactAnchorStore } from '../../db/FalkorFactAnchorStore';
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
    sessionId: 'sess-test',
    emotionVec: [0.6, 0.4, 0.8, 0.9],
    ...overrides,
  };
}

(DB_ON ? describe : describe.skip)('MemoryService (DB)', () => {
  let service: MemoryService;
  let anchorAdapter: FalkorAnchorAdapter;
  let vectorAdapter: ChromaSchemaAdapter;
  let factStore: FalkorFactAnchorStore;
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
    factStore = new FalkorFactAnchorStore();
    service = new MemoryService(anchorAdapter, vectorAdapter);
  });

  afterAll(() => {
    restoreWarn?.();
    resetFalkorClient();
  });

  beforeEach(async () => {
    await factStore.purgeAll('test-user-1');
    await factStore.purgeAll('test-user-2');
    await anchorAdapter.purgeUser('test-user-1');
    await anchorAdapter.purgeUser('test-user-2');
    await vectorAdapter.purgeUser('test-user-1');
    await vectorAdapter.purgeUser('test-user-2');
  });

  afterEach(async () => {
    const falkorUrl = process.env.LORA_FALKOR_URL ?? '';
    if (!falkorUrl.includes('19999')) {
      await factStore.purgeAll('test-user-1');
      await factStore.purgeAll('test-user-2');
      await anchorAdapter.purgeUser('test-user-1');
      await anchorAdapter.purgeUser('test-user-2');
    }
    await vectorAdapter.purgeUser('test-user-1');
    await vectorAdapter.purgeUser('test-user-2');
    resetFalkorClient();
  });

  it('message without extractor match creates no anchors', async () => {
    const input = makeInput('msg-1', 'test-user-1', {
      content: 'Hello, how are you today?',
    });
    const result = await service.saveMessage(input);
    expect(result.ok).toBe(true);

    const ctx = await service.retrieveContext('test-user-1', '', {
      emotionVec: [0.6, 0.4, 0.8, 0.9],
      nowMs: Date.now(),
      band: 'B4',
    });
    expect(ctx.anchors.length).toBe(0);
    expect(ctx.semantic.length).toBe(1);
  });

  it('message with "my goal is" creates a fact anchor', async () => {
    const input = makeInput('msg-goal', 'test-user-1', {
      content: 'My goal is to start exercise and get fit',
    });
    const result = await service.saveMessage(input);
    expect(result.ok).toBe(true);

    const exported = await factStore.exportAll('test-user-1');
    expect(exported).not.toBeNull();
    const all = [...(exported?.confirmed ?? []), ...(exported?.quarantined ?? [])];
    expect(all.length).toBe(1);
    expect(all[0].summary.template).toBe('goal_active');
    expect(all[0].summary.slot).toBe('exercise');
  });

  it('retrieveContext returns relevant anchors only when confirmed and eligible (B4)', async () => {
    const input1 = makeInput('msg-g1', 'test-user-1', {
      content: 'My goal is to start exercise regularly',
      sessionId: 'sess-1',
    });
    await service.saveMessage(input1);

    const input2 = makeInput('msg-g2', 'test-user-1', {
      content: 'My goal is to start exercise every day',
      sessionId: 'sess-2',
    });
    await service.saveMessage(input2);

    const ctx = await service.retrieveContext('test-user-1', '', {
      emotionVec: [0.6, 0.4, 0.8, 0.9],
      nowMs: Date.now(),
      band: 'B4',
    });

    expect(ctx.degraded.falkor).toBe(false);
    expect(ctx.degraded.chroma).toBe(false);

    if (ctx.anchors.length > 0) {
      expect(ctx.anchors[0].contentSummary).toContain('exercise');
    }
  });

  it('retrieveContext returns empty anchors for B0/B1', async () => {
    const input = makeInput('msg-b0', 'test-user-1', {
      content: 'My goal is to start exercise',
      sessionId: 'sess-1',
    });
    await service.saveMessage(input);

    const input2 = makeInput('msg-b0-2', 'test-user-1', {
      content: 'My goal is to start exercise again',
      sessionId: 'sess-2',
    });
    await service.saveMessage(input2);

    const ctx = await service.retrieveContext('test-user-1', '', {
      emotionVec: [0.6, 0.4, 0.8, 0.9],
      nowMs: Date.now(),
      band: 'B0',
    });

    expect(ctx.anchors.length).toBe(0);
  });

  it('different users are isolated', async () => {
    // User 1: two extractions in different sessions → reinforceCount 2
    await service.saveMessage(makeInput('msg-u1a', 'test-user-1', {
      content: 'My goal is to start exercise',
      sessionId: 'sess-1',
    }));
    await service.saveMessage(makeInput('msg-u1b', 'test-user-1', {
      content: 'My goal is exercise every day',
      sessionId: 'sess-2',
    }));
    await service.maintainAnchors('test-user-1', 'sess-2', 1700000020000);

    // User 2: same reinforcement flow
    await service.saveMessage(makeInput('msg-u2a', 'test-user-2', {
      content: 'My goal is to learn Python',
      sessionId: 'sess-1',
    }));
    await service.saveMessage(makeInput('msg-u2b', 'test-user-2', {
      content: 'My goal is to learn more',
      sessionId: 'sess-2',
    }));
    await service.maintainAnchors('test-user-2', 'sess-2', 1700000020000);

    const ctx1 = await service.retrieveContext('test-user-1', '', {
      emotionVec: [0.6, 0.4, 0.8, 0.9],
      nowMs: 1700000030000,
      band: 'B4',
    });
    const ctx2 = await service.retrieveContext('test-user-2', '', {
      emotionVec: [0.6, 0.4, 0.8, 0.9],
      nowMs: 1700000030000,
      band: 'B4',
    });

    expect(ctx1.anchors.length).toBeGreaterThanOrEqual(1);
    expect(ctx2.anchors.length).toBeGreaterThanOrEqual(1);

    const u1Summaries = ctx1.anchors.map((a) => a.contentSummary);
    const u2Summaries = ctx2.anchors.map((a) => a.contentSummary);

    expect(u1Summaries.some((s) => s.includes('exercise'))).toBe(true);
    expect(u2Summaries.some((s) => s.includes('learning'))).toBe(true);
    expect(u1Summaries.some((s) => s.includes('learning'))).toBe(false);
    expect(u2Summaries.some((s) => s.includes('exercise'))).toBe(false);
  });

  it('purgeUser removes both anchor and vector data', async () => {
    // User 1: reinforce to get reinforceCount >= 2
    await service.saveMessage(makeInput('msg-p1a', 'test-user-1', {
      content: 'My goal is to start exercise',
      sessionId: 'sess-1',
    }));
    await service.saveMessage(makeInput('msg-p1b', 'test-user-1', {
      content: 'My goal is exercise every day',
      sessionId: 'sess-2',
    }));
    await service.maintainAnchors('test-user-1', 'sess-2', 1700000020000);

    // User 2: same reinforcement flow
    await service.saveMessage(makeInput('msg-p2a', 'test-user-2', {
      content: 'My goal is to learn Python',
      sessionId: 'sess-1',
    }));
    await service.saveMessage(makeInput('msg-p2b', 'test-user-2', {
      content: 'My goal is to learn more',
      sessionId: 'sess-2',
    }));
    await service.maintainAnchors('test-user-2', 'sess-2', 1700000020000);

    // Verify both have promoted (confirmed, reinforceCount >= 2) anchors
    const e1Pre = await factStore.exportAll('test-user-1');
    expect(e1Pre).not.toBeNull();
    expect(e1Pre!.confirmed.length).toBeGreaterThanOrEqual(1);

    const e2Pre = await factStore.exportAll('test-user-2');
    expect(e2Pre).not.toBeNull();
    expect(e2Pre!.confirmed.length).toBeGreaterThanOrEqual(1);

    // Purge user 1
    const ok = await service.purgeUser('test-user-1');
    expect(ok).toBe(true);

    // User 1 data gone
    const e1Post = await factStore.exportAll('test-user-1');
    expect(e1Post).not.toBeNull();
    expect(e1Post!.confirmed.length + e1Post!.quarantined.length).toBe(0);

    const ctx1 = await service.retrieveContext('test-user-1', '', {
      nowMs: 1700000030000,
      band: 'B4',
    });
    expect(ctx1.semantic.length).toBe(0);
    expect(ctx1.anchors.length).toBe(0);

    // User 2 data intact
    const e2Post = await factStore.exportAll('test-user-2');
    expect(e2Post).not.toBeNull();
    expect(e2Post!.confirmed.length).toBeGreaterThanOrEqual(1);
  });

  it('healthCheck returns both true when DBs running', async () => {
    const health = await service.healthCheck();
    expect(health.falkor).toBe(true);
    expect(health.chroma).toBe(true);
  });

  it('maintainAnchors runs lifecycle (no throw on empty store)', async () => {
    const report = await service.maintainAnchors('test-user-1', 'sess-x', Date.now());
    expect(report).not.toBeNull();
    expect(report!.expiredQuarantined).toBe(0);
  });

  it('retrieveContext degrades when Falkor unreachable', async () => {
    await service.saveMessage(makeInput('msg-pre', 'test-user-1'));

    const origUrl = process.env.LORA_FALKOR_URL;
    process.env.LORA_FALKOR_URL = 'redis://127.0.0.1:19999';
    resetFalkorClient();

    const badAnchor = new FalkorAnchorAdapter();
    const partialService = new MemoryService(badAnchor, vectorAdapter);

    const ctx = await partialService.retrieveContext('test-user-1', '', {
      nowMs: Date.now(),
      band: 'B4',
    });
    expect(ctx.degraded.falkor).toBe(true);
    expect(ctx.anchors).toEqual([]);
    expect(ctx.semantic.length).toBeGreaterThanOrEqual(1);

    process.env.LORA_FALKOR_URL = origUrl;
    resetFalkorClient();
  });

  it('retrieveContext degrades when Chroma unreachable', async () => {
    await service.saveMessage(makeInput('msg-pre', 'test-user-1', {
      content: 'My goal is to start exercise',
      sessionId: 'sess-1',
    }));
    await service.saveMessage(makeInput('msg-pre2', 'test-user-1', {
      content: 'My goal is to start exercise more',
      sessionId: 'sess-2',
    }));

    const origUrl = process.env.LORA_CHROMA_URL;
    process.env.LORA_CHROMA_URL = 'http://127.0.0.1:19999';
    resetChromaClient();

    const badVector = new ChromaSchemaAdapter();
    const partialService = new MemoryService(anchorAdapter, badVector);

    const ctx = await partialService.retrieveContext('test-user-1', '', {
      emotionVec: [0.6, 0.4, 0.8, 0.9],
      nowMs: Date.now(),
      band: 'B4',
    });
    expect(ctx.degraded.chroma).toBe(true);
    expect(ctx.semantic).toEqual([]);

    process.env.LORA_CHROMA_URL = origUrl;
    resetChromaClient();
  });
});

describe('MemoryService saveMessage resilience', () => {
  it('when Chroma throws, Falkor still writes and ok=true, wroteChroma=false', async () => {
    const mockFactStore = {
      upsertFromExtraction: jest.fn().mockResolvedValue({
        nextState: {},
        results: { createdConfirmed: 1, createdQuarantined: 0, reinforcedConfirmed: 0, reinforcedQuarantined: 0, promotedToConfirmed: 0, evictedConfirmed: 0, evictedQuarantined: 0, rejectedByCap: 0, rejectedByTemplate: 0, rejectedByType: 0 },
      }),
    };
    const mockVectorAdapter = {
      saveSchemas: jest.fn().mockRejectedValue(new Error('Chroma down')),
    };
    const service = new MemoryService(
      {} as FalkorAnchorAdapter,
      mockVectorAdapter as unknown as ChromaSchemaAdapter,
      mockFactStore as any,
    );

    const result = await service.saveMessage(
      makeInput('msg-1', 'u1', { content: 'My goal is to start exercise', sessionId: 's1' }),
    );

    expect(result.ok).toBe(true);
    expect(result.wroteFalkor).toBe(true);
    expect(result.wroteChroma).toBe(false);
    expect(result.degraded.chroma).toBe(true);
    expect(result.degraded.falkor).toBe(false);
  });
});

describe('MemoryService retrieveContext dedup', () => {
  it('deduplicates same type+slot anchors keeping newest createdAt', async () => {
    const olderAnchor = {
      anchorId: 'deploy-old',
      userId: 'u1',
      type: 'deployment_plan' as const,
      summary: { template: 'deployment_plan' as const, slot: 'launch_date' as const },
      value: '2026-03-23',
      salience: 0.8,
      extractionConfidence: 0.8,
      status: 'confirmed' as const,
      emotionVecAtCreation: [0.5, 0.5, 0.5, 0.5],
      sessionId: 'sess-1',
      createdAt: 1700000000000,
      reinforceCount: 1,
      appearsInSessions: 1,
      lastSeenSessionId: 'sess-1',
    };

    const newerAnchor = {
      ...olderAnchor,
      anchorId: 'deploy-new',
      value: '2026-03-13',
      sessionId: 'sess-2',
      createdAt: 1700000100000,
    };

    const mockFactStore = {
      getCandidates: jest.fn().mockResolvedValue([olderAnchor, newerAnchor]),
      upsertFromExtraction: jest.fn(),
      maintain: jest.fn(),
      purgeAll: jest.fn(),
      exportAll: jest.fn(),
    };
    const mockVectorAdapter = {
      loadSchemas: jest.fn().mockResolvedValue([]),
      saveSchemas: jest.fn(),
      purgeUser: jest.fn(),
    };

    const service = new MemoryService(
      {} as FalkorAnchorAdapter,
      mockVectorAdapter as unknown as ChromaSchemaAdapter,
      mockFactStore as any,
    );

    const ctx = await service.retrieveContext('u1', 'When am I deploying?', {
      emotionVec: [0.5, 0.5, 0.5, 0.5],
      nowMs: 1700000200000,
      band: 'B4',
    });

    const launchAnchors = ctx.anchors.filter((a) => a.slotValue?.includes('launch_date'));
    expect(launchAnchors.length).toBe(1);
    expect(launchAnchors[0].slotValue).toBe('launch_date = 2026-03-13');
  });
});
