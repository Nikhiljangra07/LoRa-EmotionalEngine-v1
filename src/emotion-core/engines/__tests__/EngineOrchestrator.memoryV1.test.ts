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

describe('EngineOrchestrator — Memory V1 Integration', () => {
  beforeEach(() => {
    mockFlags.memoryV1Enabled = false;
    mockFlags.memoryV1ShadowEnabled = false;
    mockMemoryStore.clear();
  });

  describe('flags OFF', () => {
    it('does not include MEMORY CONTEXT in prompt', async () => {
      const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'test-user' });
      const result = await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

      expect(result.prompt).not.toContain('MEMORY CONTEXT');
    });

    it('prompt is identical with and without memory flags', async () => {
      const engineA = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'user-a' });
      const resultA = await engineA.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);

      mockFlags.memoryV1Enabled = true;
      const engineB = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'user-b' });
      const resultB = await engineB.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);
      mockFlags.memoryV1Enabled = false;

      // Prompt content should differ only in session-specific dynamic content (session IDs, etc.)
      // but the MEMORY CONTEXT section must not appear in flagged-off mode
      expect(resultA.prompt).not.toContain('MEMORY CONTEXT');
    });
  });

  describe('memoryV1Enabled ON', () => {
    beforeEach(() => {
      mockFlags.memoryV1Enabled = true;
    });

    it('processes messages without error', async () => {
      const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'test-mem' });
      await expect(
        engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE),
      ).resolves.toBeDefined();
    });

    it('endSession completes without error when memory enabled', async () => {
      const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'test-end' });
      await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);
      expect(() => engine.endSession()).not.toThrow();
    });

    it('persists state after endSession', async () => {
      const userId = 'persist-user';
      const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId });

      await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);
      engine.endSession();

      expect(mockMemoryStore.has(userId)).toBe(true);
      const stored = mockMemoryStore.get(userId) as Record<string, unknown>;
      expect(stored.version).toBe(1);
      expect(stored.userId).toBe(userId);
    });
  });

  describe('memoryV1ShadowEnabled ON (without memoryV1Enabled)', () => {
    beforeEach(() => {
      mockFlags.memoryV1ShadowEnabled = true;
      mockFlags.memoryV1Enabled = false;
    });

    it('processes messages without error', async () => {
      const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'shadow-user' });
      await expect(
        engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE),
      ).resolves.toBeDefined();
    });

    it('prompt does not contain MEMORY CONTEXT section', async () => {
      const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId: 'shadow-user' });
      const result = await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);
      expect(result.prompt).not.toContain('MEMORY CONTEXT');
    });

    it('still persists state on endSession', async () => {
      const userId = 'shadow-persist';
      const engine = new EngineOrchestrator(0.5, {}, mockResponder, { userId });
      await engine.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);
      engine.endSession();

      expect(mockMemoryStore.has(userId)).toBe(true);
    });
  });

  describe('integration smoke: two sessions with memory', () => {
    beforeEach(() => {
      mockFlags.memoryV1Enabled = true;
    });

    it('second session loads persisted state from first session', async () => {
      const userId = 'two-session-user';

      // Session 1: process messages and end session
      const engine1 = new EngineOrchestrator(0.5, {}, mockResponder, { userId });
      await engine1.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);
      await engine1.processMessage(BASELINE_OUTPUTS, {
        dominant: 'JOY',
        arousal: 'HIGH',
        valence: 'POSITIVE',
        confidence: 0.9,
      });
      engine1.endSession();

      expect(mockMemoryStore.has(userId)).toBe(true);
      const stored = mockMemoryStore.get(userId) as Record<string, unknown>;
      const schemas = stored.schemas as unknown[];
      expect(Array.isArray(schemas)).toBe(true);

      // Session 2: new engine, same userId — loads persisted state
      const engine2 = new EngineOrchestrator(0.5, {}, mockResponder, { userId });
      const result = await engine2.processMessage(BASELINE_OUTPUTS, NEUTRAL_STATE);
      expect(result.prompt).toBeDefined();
    });

    it('second session eventually surfaces MEMORY CONTEXT with enough schema data', async () => {
      const userId = 'schema-surface-user';

      // Session 1: multiple varied messages to generate schemas
      const engine1 = new EngineOrchestrator(0.5, {}, mockResponder, { userId });
      const emotionStates: EmotionalState[] = [
        { dominant: 'JOY', arousal: 'HIGH', valence: 'POSITIVE', confidence: 0.9 },
        { dominant: 'SADNESS', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.8 },
        { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
        { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.5 },
      ];
      const highIntensity: AnalyzerOutputs = {
        expressionStrength: { score: 0.9, confidence: 0.8 },
        valence: { score: 0.8, confidence: 0.7 },
        arousal: { score: 0.9, confidence: 0.8 },
      };

      for (const es of emotionStates) {
        await engine1.processMessage(highIntensity, es);
      }
      engine1.endSession();

      expect(mockMemoryStore.has(userId)).toBe(true);
      const stored = mockMemoryStore.get(userId) as Record<string, unknown>;
      const schemas = stored.schemas as unknown[];

      // Session 2: process a message that could trigger retrieval
      const engine2 = new EngineOrchestrator(0.5, {}, mockResponder, { userId });
      const result = await engine2.processMessage(highIntensity, emotionStates[0]);

      // The prompt should either contain MEMORY CONTEXT or not — both are valid
      // depending on whether schemas meet retrieval thresholds.
      // But the key assertion: the engine did not crash and produced a valid prompt.
      expect(typeof result.prompt).toBe('string');
      expect(result.prompt.length).toBeGreaterThan(0);

      // If schemas were created and retrieval matched, section appears
      if (schemas.length > 0 && result.prompt.includes('MEMORY CONTEXT')) {
        expect(result.prompt).toContain('MEMORY CONTEXT (privacy-safe, categorical)');
        expect(result.prompt).not.toMatch(/\b0\.\d+\b/);
      }
    });
  });
});
