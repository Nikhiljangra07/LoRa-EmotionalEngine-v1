import { EmotionalState } from '../../types/analysis.types';
import { ETVState } from '../../types/etv.types';

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
}));

jest.mock('../etvPolicyPromptMap', () => ({
  mapETVPolicyToPrompt: jest.fn(),
  renderConstraintOverlay: jest.fn(() => ''),
  computePromptSignature: jest.fn(() => 'sig'),
}));

jest.mock('../../logging/DecisionLogger', () => ({
  DecisionLogger: {
    logPromptProfileDiff: jest.fn(),
    logMessageDecision: jest.fn(),
    logSessionEnd: jest.fn(),
    resetDiffLimiter: jest.fn(),
  },
}));

import { PromptTemplateBuilder } from '../PromptTemplateBuilder';

function makeEmotionalState(
  arousal: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW',
  valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE' = 'NEUTRAL',
): EmotionalState {
  return { dominant: 'NEUTRAL', arousal, valence, confidence: 1 };
}

function makeETVState(value: number = 0.3): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

const SAMPLE_MEMORY_CONTEXT = {
  topSchemas: [
    {
      schemaId: 'schema_abc',
      emotionTrajectory: 'calm-stable',
      behavioralTendency: 'responds-to-validation',
      relevance: 'HIGH',
    },
    {
      schemaId: 'schema_def',
      emotionTrajectory: 'volatile',
      behavioralTendency: 'needs-structure',
      relevance: 'MED',
    },
  ],
  sessionPattern: 'calm-stable',
  confidenceLevel: 'HIGH',
};

function expectNoNumericLeak(prompt: string) {
  expect(prompt).not.toMatch(/\b0\.\d+\b/);
  expect(prompt).not.toMatch(/\b\d+\b/);
  expect(prompt).not.toMatch(/EIV/i);
  expect(prompt).not.toMatch(/ETV/i);
}

describe('PromptTemplateBuilder — Memory V1 Integration', () => {
  beforeEach(() => {
    mockFlags.memoryV1Enabled = false;
    mockFlags.memoryV1ShadowEnabled = false;
    PromptTemplateBuilder.resetMemoryShadowLimiter();
  });

  describe('flags OFF (byte-identical behavior)', () => {
    it('output is identical whether memoryContext is provided or not', () => {
      const es = makeEmotionalState();
      const etv = makeETVState();

      const withoutCtx = PromptTemplateBuilder.build(es, etv, {
        guidanceMode: 'CALM_NEUTRAL',
      });
      const withCtx = PromptTemplateBuilder.build(es, etv, {
        guidanceMode: 'CALM_NEUTRAL',
        memoryContext: SAMPLE_MEMORY_CONTEXT,
      });

      expect(withCtx).toBe(withoutCtx);
    });

    it('memory section is absent in prompt', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: SAMPLE_MEMORY_CONTEXT },
      );
      expect(prompt).not.toContain('MEMORY CONTEXT');
      expect(prompt).not.toContain('topSchemas');
      expect(prompt).not.toContain('schema_abc');
    });
  });

  describe('shadow mode (memoryV1ShadowEnabled only)', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      mockFlags.memoryV1ShadowEnabled = true;
      mockFlags.memoryV1Enabled = false;
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('output is identical to flags-off (no section injected)', () => {
      const es = makeEmotionalState();
      const etv = makeETVState();

      mockFlags.memoryV1ShadowEnabled = false;
      const baseline = PromptTemplateBuilder.build(es, etv, {
        guidanceMode: 'CALM_NEUTRAL',
      });

      mockFlags.memoryV1ShadowEnabled = true;
      const shadow = PromptTemplateBuilder.build(es, etv, {
        guidanceMode: 'CALM_NEUTRAL',
        memoryContext: SAMPLE_MEMORY_CONTEXT,
      });

      expect(shadow).toBe(baseline);
    });

    it('emits a shadow diff log', () => {
      PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        {
          memoryContext: SAMPLE_MEMORY_CONTEXT,
          userId: 'user-123',
        },
      );

      const shadowLog = consoleSpy.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('MemoryV1Shadow'),
      );
      expect(shadowLog).toBeDefined();

      const payload = JSON.parse(shadowLog![1]);
      expect(payload.event).toBe('memory_would_inject');
      expect(payload.userId).toBe('user-123');
      expect(payload.signature).toContain('schema_abc');
    });

    it('throttles shadow log to once per 5 minutes per user+signature', () => {
      const opts = {
        memoryContext: SAMPLE_MEMORY_CONTEXT,
        userId: 'user-throttle',
      };

      PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), opts);
      PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), opts);
      PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), opts);

      const shadowLogs = consoleSpy.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('MemoryV1Shadow'),
      );
      expect(shadowLogs).toHaveLength(1);
    });

    it('does not contain MEMORY CONTEXT in prompt', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: SAMPLE_MEMORY_CONTEXT },
      );
      expect(prompt).not.toContain('MEMORY CONTEXT');
    });
  });

  describe('memoryV1Enabled ON', () => {
    beforeEach(() => {
      mockFlags.memoryV1Enabled = true;
      mockFlags.memoryV1ShadowEnabled = false;
    });

    it('injects MEMORY CONTEXT section when memoryContext provided', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: SAMPLE_MEMORY_CONTEXT },
      );

      expect(prompt).toContain('MEMORY CONTEXT (privacy-safe, categorical)');
      expect(prompt).toContain('sessionPattern: calm-stable');
      expect(prompt).toContain('confidence: HIGH');
      expect(prompt).toContain('[schema_abc]');
      expect(prompt).toContain('trajectory=calm-stable');
      expect(prompt).toContain('tendency=responds-to-validation');
      expect(prompt).toContain('relevance=HIGH');
      expect(prompt).toContain('[schema_def]');
    });

    it('does not inject section when memoryContext is undefined', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
      );
      expect(prompt).not.toContain('MEMORY CONTEXT');
    });

    it('limits topSchemas to 3', () => {
      const ctx = {
        ...SAMPLE_MEMORY_CONTEXT,
        topSchemas: [
          { schemaId: 's_a', emotionTrajectory: 'calm-stable', behavioralTendency: 'unknown', relevance: 'HIGH' },
          { schemaId: 's_b', emotionTrajectory: 'calm-stable', behavioralTendency: 'unknown', relevance: 'MED' },
          { schemaId: 's_c', emotionTrajectory: 'calm-stable', behavioralTendency: 'unknown', relevance: 'LOW' },
          { schemaId: 's_d', emotionTrajectory: 'calm-stable', behavioralTendency: 'unknown', relevance: 'LOW' },
        ],
      };

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: ctx },
      );

      expect(prompt).toContain('[s_a]');
      expect(prompt).toContain('[s_b]');
      expect(prompt).toContain('[s_c]');
      expect(prompt).not.toContain('[s_d]');
    });

    it('contains no raw floats in memory section', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: SAMPLE_MEMORY_CONTEXT },
      );

      const memorySection = prompt.split('MEMORY CONTEXT')[1] ?? '';
      expect(memorySection).not.toMatch(/\b0\.\d+\b/);
      expect(memorySection).not.toMatch(/\b\d+\.\d+\b/);
    });

    it('memory section does not leak internal terminology', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: SAMPLE_MEMORY_CONTEXT },
      );

      const memorySection = prompt.split('MEMORY CONTEXT')[1] ?? '';
      expect(memorySection).not.toMatch(/EIV/i);
      expect(memorySection).not.toMatch(/ETV/i);
      expect(memorySection).not.toMatch(/analyzer/i);
      expect(memorySection).not.toMatch(/salience/i);
      expect(memorySection).not.toMatch(/centroid/i);
    });
  });

  describe('precedence: memoryV1Enabled takes priority over shadow', () => {
    it('when both flags are on, section is injected (not shadow-only)', () => {
      mockFlags.memoryV1Enabled = true;
      mockFlags.memoryV1ShadowEnabled = true;

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: SAMPLE_MEMORY_CONTEXT },
      );

      expect(prompt).toContain('MEMORY CONTEXT (privacy-safe, categorical)');
    });
  });

  describe('governor-shaped context (omitted labels)', () => {
    beforeEach(() => {
      mockFlags.memoryV1Enabled = true;
      mockFlags.memoryV1ShadowEnabled = false;
    });

    it('Band B1 scenario: no MEMORY CONTEXT block when context is null', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: undefined },
      );
      expect(prompt).not.toContain('MEMORY CONTEXT');
    });

    it('Band B2 scenario: tendency omitted, sessionPattern omitted', () => {
      const ctx = {
        topSchemas: [
          {
            schemaId: 'schema_b2',
            emotionTrajectory: 'calm-stable',
            behavioralTendency: 'omitted',
            relevance: 'HIGH',
          },
        ],
        sessionPattern: 'omitted',
        confidenceLevel: 'MED',
      };
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: ctx },
      );
      expect(prompt).toContain('MEMORY CONTEXT');
      expect(prompt).not.toContain('sessionPattern');
      expect(prompt).not.toContain('tendency=');
      expect(prompt).toContain('trajectory=calm-stable');
      expect(prompt).toContain('relevance=HIGH');
      expect(prompt).toContain('[schema_b2]');
    });

    it('Band B4 scenario: tendency label visible, still passes blacklist', () => {
      const ctx = {
        topSchemas: [
          {
            schemaId: 'schema_b4',
            emotionTrajectory: 'volatile',
            behavioralTendency: 'responds-to-validation',
            relevance: 'MED',
          },
        ],
        sessionPattern: 'recovering',
        confidenceLevel: 'HIGH',
      };
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: ctx },
      );
      expect(prompt).toContain('MEMORY CONTEXT');
      expect(prompt).toContain('tendency=responds-to-validation');
      expect(prompt).toContain('sessionPattern: recovering');

      const FORBIDDEN = [
        'companion', 'companionship', 'intimacy', 'intimate', 'bond',
        'attachment', 'affection', 'closeness', 'love you', 'miss you',
      ];
      const memSection = prompt.split('MEMORY CONTEXT')[1] ?? '';
      for (const f of FORBIDDEN) {
        expect(memSection.toLowerCase()).not.toContain(f);
      }
    });

    it('no numeric leak with governed context', () => {
      const ctx = {
        topSchemas: [
          {
            schemaId: 'schema_gov',
            emotionTrajectory: 'omitted',
            behavioralTendency: 'omitted',
            relevance: 'LOW',
          },
        ],
        sessionPattern: 'omitted',
        confidenceLevel: 'LOW',
      };
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: ctx },
      );
      const memSection = prompt.split('MEMORY CONTEXT')[1] ?? '';
      expect(memSection).not.toMatch(/\b0\.\d+\b/);
      expect(memSection).not.toMatch(/\b\d+\.\d+\b/);
    });

    it('all labels omitted renders schemaId + relevance only', () => {
      const ctx = {
        topSchemas: [
          {
            schemaId: 'schema_minimal',
            emotionTrajectory: 'omitted',
            behavioralTendency: 'omitted',
            relevance: 'MED',
          },
        ],
        sessionPattern: 'omitted',
        confidenceLevel: 'MED',
      };
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: ctx },
      );
      expect(prompt).toContain('[schema_minimal] relevance=MED');
      expect(prompt).not.toContain('trajectory=');
      expect(prompt).not.toContain('tendency=');
    });

    it('partial omission: trajectory shown, tendency omitted', () => {
      const ctx = {
        topSchemas: [
          {
            schemaId: 'schema_partial',
            emotionTrajectory: 'escalating-negative',
            behavioralTendency: 'omitted',
            relevance: 'HIGH',
          },
        ],
        sessionPattern: 'unknown',
        confidenceLevel: 'HIGH',
      };
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { memoryContext: ctx },
      );
      expect(prompt).toContain('trajectory=escalating-negative');
      expect(prompt).not.toContain('tendency=');
      expect(prompt).toContain('relevance=HIGH');
    });
  });
});
