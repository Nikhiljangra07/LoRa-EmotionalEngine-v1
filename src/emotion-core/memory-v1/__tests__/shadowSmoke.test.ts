import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import type { EmotionalState } from '../../types/analysis.types';

const mockFlags: Record<string, boolean> = {
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
  memoryV1Enabled: false,
  memoryV1ShadowEnabled: false,
};

jest.mock('../../../emotion-core/config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

jest.mock('../../../emotion-core/debug/debugGate', () => ({
  debugEnabled: false,
  decisionLogEnabled: true,
}));

const mockStore = new Map<string, unknown>();

jest.mock('../storage', () => ({
  createJSONStorage: jest.fn(() => ({
    load: jest.fn((userId: string) => mockStore.get(userId) ?? null),
    save: jest.fn((state: { userId: string }) => {
      mockStore.set(state.userId, state);
    }),
    getPath: jest.fn((userId: string) => `/mock/${userId}/state.json`),
  })),
}));

import { EngineOrchestrator } from '../../engines/EngineOrchestrator';

const MESSAGES: Array<{ out: AnalyzerOutputs; es: EmotionalState }> = [
  {
    out: { expressionStrength: { score: 0.3, confidence: 0.7 }, valence: { score: 0.0, confidence: 0.6 }, arousal: { score: 0.2, confidence: 0.6 } },
    es: { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.7 },
  },
  {
    out: { expressionStrength: { score: 0.9, confidence: 0.8 }, valence: { score: -0.7, confidence: 0.8 }, arousal: { score: 0.8, confidence: 0.8 } },
    es: { dominant: 'SADNESS', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
  },
  {
    out: { expressionStrength: { score: 0.85, confidence: 0.8 }, valence: { score: -0.8, confidence: 0.8 }, arousal: { score: 0.9, confidence: 0.8 } },
    es: { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
  },
  {
    out: { expressionStrength: { score: 0.4, confidence: 0.7 }, valence: { score: 0.3, confidence: 0.6 }, arousal: { score: 0.3, confidence: 0.6 } },
    es: { dominant: 'CONTENTMENT', arousal: 'LOW', valence: 'POSITIVE', confidence: 0.6 },
  },
];

function mockResponder() {
  return { generateResponse: async () => 'Mock shadow response.' };
}

describe('Memory V1 — Shadow Smoke', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockFlags.memoryV1Enabled = false;
    mockFlags.memoryV1ShadowEnabled = false;
    mockStore.clear();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('shadow prompt equals baseline prompt for all messages', async () => {
    // Baseline run
    mockFlags.memoryV1ShadowEnabled = false;
    const engineBase = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'smoke-user' });
    const basePrompts: string[] = [];
    for (const m of MESSAGES) {
      const r = await engineBase.processMessage(m.out, m.es);
      basePrompts.push(r.prompt);
    }
    engineBase.endSession();

    // Shadow run
    mockFlags.memoryV1ShadowEnabled = true;
    const engineShadow = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'smoke-user' });
    const shadowPrompts: string[] = [];
    for (const m of MESSAGES) {
      const r = await engineShadow.processMessage(m.out, m.es);
      shadowPrompts.push(r.prompt);
    }
    engineShadow.endSession();

    for (let i = 0; i < basePrompts.length; i++) {
      expect(shadowPrompts[i]).toBe(basePrompts[i]);
    }
  });

  it('shadow run emits at least one memory log event', async () => {
    mockFlags.memoryV1ShadowEnabled = true;

    const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'log-user' });
    for (const m of MESSAGES) {
      await engine.processMessage(m.out, m.es);
    }
    engine.endSession();

    const memoryLogs = consoleSpy.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0].includes('[LoRa::Memory]') || c[0].includes('[LoRa::MemoryV1Shadow]')),
    );
    expect(memoryLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('shadow prompt never contains MEMORY CONTEXT overlay', async () => {
    mockFlags.memoryV1ShadowEnabled = true;

    const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'overlay-user' });
    for (const m of MESSAGES) {
      const r = await engine.processMessage(m.out, m.es);
      expect(r.prompt).not.toContain('MEMORY CONTEXT');
    }
    engine.endSession();
  });

  it('persists state on endSession', async () => {
    mockFlags.memoryV1ShadowEnabled = true;

    const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'persist-user' });
    for (const m of MESSAGES) {
      await engine.processMessage(m.out, m.es);
    }
    engine.endSession();

    expect(mockStore.has('persist-user')).toBe(true);
    const stored = mockStore.get('persist-user') as Record<string, unknown>;
    expect(stored.version).toBe(1);
    expect(Array.isArray(stored.schemas)).toBe(true);
  });
});
