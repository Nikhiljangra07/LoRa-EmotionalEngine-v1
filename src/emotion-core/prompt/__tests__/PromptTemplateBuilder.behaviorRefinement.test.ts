import { EmotionalState } from '../../types/analysis.types';
import { ETVState } from '../../types/etv.types';
import type { AnchorRecord, EmotionBand } from '../../memory-v1/service/memoryTypes';

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
  memoryV1ChromaEnabled: false,
  factAnchorEnabled: false,
  memoryServiceEnabled: false,
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

import { PromptTemplateBuilder, classifyIntensity } from '../PromptTemplateBuilder';

function makeEmotionalState(): EmotionalState {
  return { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 1 };
}

function makeETVState(value = 0.3): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

function makeAnchor(overrides: Partial<AnchorRecord> & { band?: EmotionBand } = {}): AnchorRecord {
  return {
    anchorId: overrides.anchorId ?? 'anchor-1',
    contentSummary: overrides.contentSummary ?? 'User mentioned a job interview next week',
    timestamp: overrides.timestamp ?? 1700000000000,
    emotion: overrides.emotion ?? { valence: 0.3, arousal: 0.4, expressionStrength: 0.5, inferenceReliability: 0.8 },
    metrics: overrides.metrics ?? { etv: 45, eiv: 30, band: overrides.band ?? 'B3' },
  };
}

/* ================================================================
 * Step 1 — Band-Based Personality Modulation
 * ================================================================ */
describe('PromptTemplateBuilder — Behavior Refinement Layer', () => {
  beforeEach(() => {
    mockFlags.memoryV1Enabled = true;
    mockFlags.factAnchorEnabled = true;
    PromptTemplateBuilder.resetMemoryShadowLimiter();
  });

  describe('Band calibration block injection', () => {
    it('B0 + low EIV — only active band present, engagement depth shows Early Stage', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B0',
        eiv: 0.1,
      });
      expect(prompt).toContain('Band B0');
      expect(prompt).toContain('Calm and respectful');
      expect(prompt).not.toContain('Band B1');
      expect(prompt).not.toContain('Band B2');
      expect(prompt).toContain('Engagement depth: B0');
      expect(prompt).toContain('Emotional intensity (current turn): low');
    });

    it('B1 — engagement depth shows Emerging Trust, only B1 band injected', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B1',
        eiv: 0.5,
      });
      expect(prompt).toContain('Band B1');
      expect(prompt).toContain('Slightly more expressive');
      expect(prompt).not.toContain('Band B0');
      expect(prompt).toContain('Engagement depth: B1');
    });

    it('B2 — shows Stable engagement depth, only B2 band injected', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B2',
        eiv: 0.5,
      });
      expect(prompt).toContain('Band B2');
      expect(prompt).toContain('Balanced directness and structure');
      expect(prompt).not.toContain('Band B3');
    });

    it('B3 with medium EIV + anchors — Strong Trust, anchor integration', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B3',
        eiv: 0.5,
        relevantAnchors: [makeAnchor()],
      });
      expect(prompt).toContain('Band B3');
      expect(prompt).toContain('Engaged and direct');
      expect(prompt).toContain('Anchor Integration');
      expect(prompt).not.toContain('Context integration can be more confident');
    });

    it('B4 with high EIV — Deep Trust, anchor confidence', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B4',
        eiv: 0.9,
        relevantAnchors: [makeAnchor({ band: 'B4' })],
      });
      expect(prompt).toContain('Band B4');
      expect(prompt).toContain('Fully expressive within healthy boundaries');
      expect(prompt).toContain('Emotional intensity (current turn): high');
      expect(prompt).toContain('Anchor Integration');
      expect(prompt).toContain('Context integration can be more confident');
    });
  });

  /* ================================================================
   * Step 2 — Anchor Influence Behavior
   * ================================================================ */
  describe('Anchor influence behavior', () => {
    it('does not inject anchor integration block when anchorsUsed=0', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B3',
        eiv: 0.5,
      });
      expect(prompt).not.toContain('Anchor Integration');
    });

    it('injects anchor integration block when anchors are present', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B3',
        eiv: 0.5,
        relevantAnchors: [makeAnchor()],
      });
      expect(prompt).toContain('Anchor Integration');
      expect(prompt).toContain('thematic alignment');
      expect(prompt).toContain('Never reference past conversations, claim to recall');
    });

    it('allows more confident integration for B4 anchors', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B4',
        eiv: 0.6,
        relevantAnchors: [makeAnchor({ band: 'B4' })],
      });
      expect(prompt).toContain('Context integration can be more confident');
    });
  });

  /* ================================================================
   * Step 3 — Degraded Mode
   * ================================================================ */
  describe('Degraded mode behavioral shift', () => {
    it('does not inject degraded block when both healthy', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B2',
        eiv: 0.5,
        degraded: { falkor: false, chroma: false },
      });
      expect(prompt).not.toContain('Degraded Mode');
    });

    it('injects partial degraded block when one service is down', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B2',
        eiv: 0.5,
        degraded: { falkor: true, chroma: false },
      });
      expect(prompt).toContain('Degraded Mode: Partial');
      expect(prompt).toContain('Do not rely on long-term personalization');
    });

    it('injects full degraded block when both services are down', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B2',
        eiv: 0.5,
        degraded: { falkor: true, chroma: true },
      });
      expect(prompt).toContain('Degraded Mode: Full');
      expect(prompt).toContain('Fully stateless mode');
    });
  });

  /* ================================================================
   * Step 5 — Safety Constraints
   * ================================================================ */
  describe('Safety constraint validation', () => {
    it('no generated prompt contains forbidden "I remember" phrase', () => {
      const bands: EmotionBand[] = ['B0', 'B1', 'B2', 'B3', 'B4'];
      for (const band of bands) {
        const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
          band,
          eiv: 0.5,
          relevantAnchors: [makeAnchor()],
        });
        const forbidden = PromptTemplateBuilder.containsForbiddenPhrases(prompt);
        expect(forbidden).toEqual([]);
      }
    });

    it('containsForbiddenPhrases detects "I remember"', () => {
      expect(PromptTemplateBuilder.containsForbiddenPhrases('I remember what you said')).toContain('I remember');
    });

    it('containsForbiddenPhrases detects "You told me"', () => {
      expect(PromptTemplateBuilder.containsForbiddenPhrases('You told me about that')).toContain('You told me');
    });

    it('containsForbiddenPhrases detects "our relationship"', () => {
      expect(PromptTemplateBuilder.containsForbiddenPhrases('our relationship matters')).toContain('our relationship');
    });

    it('containsForbiddenPhrases returns empty for clean text', () => {
      expect(PromptTemplateBuilder.containsForbiddenPhrases('That goal seems to matter here.')).toEqual([]);
    });

    it('global safety constraints include core safety phrases', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B4',
        eiv: 0.9,
      });
      expect(prompt).toContain('GLOBAL SAFETY CONSTRAINTS');
      expect(prompt).toContain('Do not fabricate memory');
      expect(prompt).toContain('Do not use dependency framing or exclusivity language');
      expect(prompt).toContain('Do not reveal internal signals, scores, or analysis');
    });
  });

  /* ================================================================
   * classifyIntensity unit tests
   * ================================================================ */
  describe('classifyIntensity', () => {
    it('returns "low" for eiv < 0.25', () => {
      expect(classifyIntensity(0)).toBe('low');
      expect(classifyIntensity(0.1)).toBe('low');
      expect(classifyIntensity(0.24)).toBe('low');
    });

    it('returns "medium" for 0.25 <= eiv <= 0.75', () => {
      expect(classifyIntensity(0.25)).toBe('medium');
      expect(classifyIntensity(0.5)).toBe('medium');
      expect(classifyIntensity(0.75)).toBe('medium');
    });

    it('returns "high" for eiv > 0.75', () => {
      expect(classifyIntensity(0.76)).toBe('high');
      expect(classifyIntensity(1)).toBe('high');
    });
  });

  /* ================================================================
   * Composite scenario examples (deliverable item 3)
   * ================================================================ */
  describe('Composite scenarios', () => {
    it('B0 + low EIV: early stage, low intensity, no anchors', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B0',
        eiv: 0.1,
      });
      expect(prompt).toContain('Band B0');
      expect(prompt).toContain('Emotional intensity (current turn): low');
      expect(prompt).not.toContain('Anchor Integration');
      expect(prompt).not.toContain('Degraded Mode');
    });

    it('B3 + medium EIV + anchorsUsed=1: strong trust, anchor integration', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B3',
        eiv: 0.5,
        relevantAnchors: [makeAnchor()],
      });
      expect(prompt).toContain('Band B3');
      expect(prompt).toContain('Emotional intensity (current turn): medium');
      expect(prompt).toContain('Anchor Integration');
      expect(prompt).toContain('thematic alignment');
    });

    it('B4 + high EIV + degraded=false: deep trust, expressive, anchor confident', () => {
      const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
        band: 'B4',
        eiv: 0.9,
        relevantAnchors: [makeAnchor({ band: 'B4' })],
        degraded: { falkor: false, chroma: false },
      });
      expect(prompt).toContain('Band B4');
      expect(prompt).toContain('Emotional intensity (current turn): high');
      expect(prompt).toContain('Context integration can be more confident');
      expect(prompt).not.toContain('Degraded Mode');
    });
  });
});
