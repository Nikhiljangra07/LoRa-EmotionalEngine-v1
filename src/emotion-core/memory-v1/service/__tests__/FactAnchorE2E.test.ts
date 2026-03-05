/**
 * E2E smoke test: extract → reinforce → maintain → retrieve → PromptTemplateBuilder renders FACT CONTEXT.
 * DB-gated: only runs when LORA_TEST_DB=1 and both Falkor+Chroma are reachable.
 */
import { MemoryService, type MemorySaveInput } from '../MemoryService';
import { FalkorAnchorAdapter } from '../../db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../../db/ChromaSchemaAdapter';
import { FalkorFactAnchorStore } from '../../db/FalkorFactAnchorStore';
import { getFalkorClient, getFalkorUrl, resetFalkorClient } from '../../db/falkorClient';
import { resetChromaClient } from '../../db/chromaClient';
import { MAX_ANCHORS_IN_PROMPT } from '../../factAnchorTypes';

const mockFlags: Record<string, boolean> = {
  memoryV1Enabled: true,
  memoryV1ShadowEnabled: false,
  memoryV1DebugEnabled: false,
  memoryV1ChromaEnabled: false,
  factAnchorEnabled: true,
  memoryServiceEnabled: true,
  appraisalBridgeEnabled: false,
  appraisalBridgeModeEnabled: false,
  appraisalPacingHintEnabled: false,
  strictGuidanceModeEnabled: false,
  driftMonitorEnabled: false,
  validationIntensityEnabled: false,
  adaptiveOverrideCooldownEnabled: false,
  appraisalToneHintEnabled: false,
  interventionValidationHintEnabled: false,
  interventionPacingHintEnabled: false,
  interventionToneHintEnabled: false,
  interventionActionHintEnabled: false,
  interventionInterruptHintEnabled: false,
  interventionStepHintEnabled: false,
  interventionQuestionBudgetEnabled: false,
  hintResolverEnabled: false,
  hintStickinessEnabled: false,
  guidanceDwellLockEnabled: false,
  hintSemanticGuardEnabled: false,
  etvV1Enabled: false,
  etvPolicyPromptEnabled: false,
  etvPolicyPromptShadowEnabled: false,
};

jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

jest.mock('../../../debug/debugGate', () => ({
  debugEnabled: false,
  decisionLogEnabled: false,
}));

jest.mock('../../../logging/DecisionLogger', () => ({
  DecisionLogger: {
    logPromptProfileDiff: jest.fn(),
    logMessageDecision: jest.fn(),
    logSessionEnd: jest.fn(),
    resetDiffLimiter: jest.fn(),
  },
}));

jest.mock('../../../prompt/etvPolicyPromptMap', () => ({
  mapETVPolicyToPrompt: jest.fn(),
  renderConstraintOverlay: jest.fn(() => ''),
  computePromptSignature: jest.fn(() => 'sig'),
}));

import { PromptTemplateBuilder } from '../../../prompt/PromptTemplateBuilder';

const DB_ON = process.env.LORA_TEST_DB === '1';
const TEST_USER = 'e2e-smoke-user';

async function assertFalkorReachable(): Promise<void> {
  const url = getFalkorUrl();
  try {
    const client = getFalkorClient();
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error('No PONG');
  } catch {
    resetFalkorClient();
    throw new Error(`FalkorDB not reachable at ${url}`);
  }
}

async function assertChromaReachable(): Promise<void> {
  const url = process.env.LORA_CHROMA_URL;
  if (!url) throw new Error('LORA_CHROMA_URL not set');
  try {
    const res = await fetch(`${url}/api/v2/heartbeat`);
    if (!res.ok) throw new Error();
  } catch {
    throw new Error(`ChromaDB not reachable at ${url}`);
  }
}

function makeInput(
  messageId: string,
  content: string,
  sessionId: string,
): MemorySaveInput {
  return {
    userId: TEST_USER,
    messageId,
    content,
    timestamp: 1700000000000,
    emotion: { valence: 0.6, arousal: 0.4, expressionStrength: 0.8, inferenceReliability: 0.9 },
    metrics: { etv: 42, eiv: 55, band: 'B4' },
    sessionId,
    emotionVec: [0.6, 0.4, 0.8, 0.9],
  };
}

const FORBIDDEN_PHRASES = [
  'i remember',
  'you said',
  'you told me',
  'you mentioned',
  'companion',
  'companionship',
  'intimacy',
  'intimate',
  'bond',
  'attachment',
  'affection',
  'closeness',
  'love you',
  'miss you',
];

(DB_ON ? describe : describe.skip)('Fact Anchor E2E Smoke (DB)', () => {
  let service: MemoryService;
  let factStore: FalkorFactAnchorStore;
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
    restoreWarn = () => { console.warn = originalWarn; };

    factStore = new FalkorFactAnchorStore();
    vectorAdapter = new ChromaSchemaAdapter();
    service = new MemoryService(
      new FalkorAnchorAdapter(),
      vectorAdapter,
      factStore,
    );
  });

  afterAll(async () => {
    restoreWarn?.();
    try {
      const c = getFalkorClient();
      if (c.status === 'ready') await c.quit();
    } catch { /* already closed */ }
    resetFalkorClient();
    resetChromaClient();
    await new Promise((r) => setTimeout(r, 50));
  });

  beforeEach(async () => {
    await factStore.purgeAll(TEST_USER);
    await vectorAdapter.purgeUser(TEST_USER);
    PromptTemplateBuilder.resetMemoryShadowLimiter();
  });

  afterEach(async () => {
    await factStore.purgeAll(TEST_USER);
    await vectorAdapter.purgeUser(TEST_USER);
  });

  it('full pipeline: extract → reinforce → maintain → retrieve → FACT CONTEXT rendered', async () => {
    // 1. Session 1: first extraction (reinforceCount = 1)
    const ok1 = await service.saveMessage(
      makeInput('msg-s1', 'My goal is to start exercise', 'sess-1'),
    );
    expect(ok1.ok).toBe(true);

    // 2. Session 2: same slot → reinforcement (reinforceCount = 2)
    const ok2 = await service.saveMessage(
      makeInput('msg-s2', 'My goal is exercise every day', 'sess-2'),
    );
    expect(ok2.ok).toBe(true);

    // 3. Maintain at session boundary
    const report = await service.maintainAnchors(TEST_USER, 'sess-2', 1700000020000);
    expect(report).not.toBeNull();

    // 4. Verify anchor is confirmed with reinforceCount >= 2
    const exported = await factStore.exportAll(TEST_USER);
    expect(exported).not.toBeNull();
    expect(exported!.confirmed.length).toBe(1);
    expect(exported!.confirmed[0].reinforceCount).toBeGreaterThanOrEqual(2);
    expect(exported!.confirmed[0].summary.slot).toBe('exercise');

    // 5. Retrieve context at B4
    const ctx = await service.retrieveContext(TEST_USER, '', {
      emotionVec: [0.6, 0.4, 0.8, 0.9],
      nowMs: 1700000030000,
      band: 'B4',
    });
    expect(ctx.degraded.falkor).toBe(false);
    expect(ctx.degraded.chroma).toBe(false);
    expect(ctx.anchors.length).toBeGreaterThanOrEqual(1);
    expect(ctx.anchors.length).toBeLessThanOrEqual(MAX_ANCHORS_IN_PROMPT);

    // 6. Build prompt with anchors via PromptTemplateBuilder
    const prompt = PromptTemplateBuilder.build(
      { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 1 },
      { value: 0.3, sessionEIVs: [], messageCount: 0, lastUpdated: 0 },
      { relevantAnchors: ctx.anchors },
    );

    // 7. Assert FACT CONTEXT block exists
    expect(prompt).toContain('FACT CONTEXT');
    expect(prompt).toContain('exercise');

    // 8. Assert MAX_ANCHORS_IN_PROMPT cap respected
    const anchorLines = prompt
      .split('\n')
      .filter((line) => line.startsWith('- ['));
    expect(anchorLines.length).toBeLessThanOrEqual(MAX_ANCHORS_IN_PROMPT);

    // 9. Assert only B2+ anchors appear (no B0/B1 in content summary)
    for (const a of ctx.anchors) {
      const band = a.metrics.band;
      expect(band).toBeDefined();
      expect(['B2', 'B3', 'B4']).toContain(band);
    }

    // 10. Assert no forbidden phrases in FACT CONTEXT block only
    const factSection = prompt.split('FACT CONTEXT')[1] ?? '';
    const lower = factSection.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(lower).not.toContain(phrase);
    }
  });
});
