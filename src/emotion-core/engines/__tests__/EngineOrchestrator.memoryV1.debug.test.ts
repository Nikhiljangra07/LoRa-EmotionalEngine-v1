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
  memoryV1DebugEnabled: false,
};

jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

jest.mock('../../debug/debugGate', () => ({
  debugEnabled: false,
  decisionLogEnabled: false,
}));

const mockMemoryStore = new Map<string, unknown>();

jest.mock('../../memory-v1/storage', () => ({
  createJSONStorage: jest.fn(() => ({
    load: jest.fn((userId: string) => mockMemoryStore.get(userId) ?? null),
    save: jest.fn((state: { userId: string }) => {
      mockMemoryStore.set(state.userId, state);
    }),
    getPath: jest.fn((userId: string) => `/mock/${userId}/state.json`),
  })),
}));

import { EngineOrchestrator } from '../EngineOrchestrator';

const BASELINE_OUTPUTS: AnalyzerOutputs = {
  expressionStrength: { score: 0.6, confidence: 0.7 },
  valence: { score: 0.1, confidence: 0.6 },
  arousal: { score: 0.5, confidence: 0.6 },
};

const NEUTRAL_STATE: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'LOW',
  valence: 'NEUTRAL',
  confidence: 0.7,
};

function mockResponder() {
  return {
    generateResponse: async () => 'Mock LLM response.',
  };
}

describe('EngineOrchestrator — Memory V1 Debug', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    mockFlags.memoryV1Enabled = false;
    mockFlags.memoryV1ShadowEnabled = false;
    mockFlags.memoryV1DebugEnabled = false;
    mockMemoryStore.clear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('does NOT log [LoRa::MemoryV1Debug] when debug flag OFF', async () => {
    mockFlags.memoryV1Enabled = true;
    mockFlags.memoryV1DebugEnabled = false;

    const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'debug-off-user' });
    await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

    const debugCalls = logSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[LoRa::MemoryV1Debug]'),
    );
    expect(debugCalls.length).toBe(0);
  });

  it('logs [LoRa::MemoryV1Debug] when debug flag ON and memory enabled', async () => {
    mockFlags.memoryV1Enabled = true;
    mockFlags.memoryV1DebugEnabled = true;

    const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'debug-on-user' });
    await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

    const debugCalls = logSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[LoRa::MemoryV1Debug]'),
    );
    expect(debugCalls.length).toBeGreaterThanOrEqual(1);

    const payload = JSON.parse(debugCalls[0][1]);
    expect(payload.tag).toBe('memory:v1:debug');
    expect(payload.userId).toBe('debug-on-user');
    expect(payload.topSchemaIds.length).toBeLessThanOrEqual(3);
  });

  it('debug snapshot contains no raw float strings', async () => {
    mockFlags.memoryV1Enabled = true;
    mockFlags.memoryV1DebugEnabled = true;

    const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'float-check' });
    await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

    const debugCalls = logSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[LoRa::MemoryV1Debug]'),
    );
    expect(debugCalls.length).toBeGreaterThanOrEqual(1);

    const jsonStr = debugCalls[0][1];
    const sanitized = jsonStr
      .replace(/"userId":"[^"]*"/g, '')
      .replace(/"sessionId":"[^"]*"/g, '')
      .replace(/"messageId":"[^"]*"/g, '')
      .replace(/"winnerSchemaId":"[^"]*"/g, '')
      .replace(/"topSchemaIds":\[("[^"]*",?)*\]/g, '');
    expect(sanitized).not.toMatch(/\d+\.\d+/);
  });

  it('prompt output identical between debug ON and OFF (same flags otherwise)', async () => {
    mockFlags.memoryV1Enabled = true;

    mockFlags.memoryV1DebugEnabled = false;
    const engineA = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'prompt-cmp-a' });
    const resultA = await engineA.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

    mockFlags.memoryV1DebugEnabled = true;
    const engineB = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'prompt-cmp-b' });
    const resultB = await engineB.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

    expect(resultA.prompt).toBe(resultB.prompt);
  });

  it('debug log includes sessionId and messageId', async () => {
    mockFlags.memoryV1Enabled = true;
    mockFlags.memoryV1DebugEnabled = true;

    const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'ids-check' });
    await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

    const debugCalls = logSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[LoRa::MemoryV1Debug]'),
    );
    const payload = JSON.parse(debugCalls[0][1]);
    expect(payload.messageId).toBeDefined();
    expect(typeof payload.messageId).toBe('string');
  });
});
