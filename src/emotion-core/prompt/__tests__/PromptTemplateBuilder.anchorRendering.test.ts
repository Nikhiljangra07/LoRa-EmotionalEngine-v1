import { EmotionalState } from '../../types/analysis.types';
import { ETVState } from '../../types/etv.types';
import type { AnchorRecord } from '../../memory-v1/service/memoryTypes';
import type { EmotionBand } from '../../memory-v1/service/memoryTypes';

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

import { PromptTemplateBuilder } from '../PromptTemplateBuilder';

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
    slotValue: overrides.slotValue,
    timestamp: overrides.timestamp ?? 1700000000000,
    emotion: overrides.emotion ?? { valence: 0.3, arousal: 0.4, expressionStrength: 0.5, inferenceReliability: 0.8 },
    metrics: overrides.metrics ?? { etv: 45, eiv: 30, band: overrides.band ?? 'B3' },
  };
}

const SAMPLE_MEMORY_CONTEXT = {
  topSchemas: [
    {
      schemaId: 'schema_abc',
      emotionTrajectory: 'calm-stable',
      behavioralTendency: 'responds-to-validation',
      relevance: 'HIGH',
    },
  ],
  sessionPattern: 'calm-stable',
  confidenceLevel: 'HIGH',
};

describe('PromptTemplateBuilder — Anchor Rendering (Phase 3)', () => {
  beforeEach(() => {
    mockFlags.memoryV1Enabled = true;
    mockFlags.factAnchorEnabled = true;
    PromptTemplateBuilder.resetMemoryShadowLimiter();
  });

  describe('prompt ordering: MEMORY CONTEXT > FACT CONTEXT > GLOBAL SAFETY CONSTRAINTS', () => {
    it('anchors appear AFTER memory context (schemas) and BEFORE global safety constraints', () => {
      const anchors = [
        makeAnchor({ anchorId: 'a1', contentSummary: 'Job interview prep', band: 'B3' }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        {
          memoryContext: SAMPLE_MEMORY_CONTEXT,
          relevantAnchors: anchors,
        },
      );

      const memoryContextIdx = prompt.indexOf('MEMORY CONTEXT');
      const factContextIdx = prompt.indexOf('FACT CONTEXT');
      const globalConstraintsIdx = prompt.indexOf('GLOBAL SAFETY CONSTRAINTS');

      expect(memoryContextIdx).toBeGreaterThan(-1);
      expect(factContextIdx).toBeGreaterThan(-1);
      expect(globalConstraintsIdx).toBeGreaterThan(-1);

      expect(memoryContextIdx).toBeLessThan(factContextIdx);
      expect(factContextIdx).toBeLessThan(globalConstraintsIdx);
    });

    it('anchors appear before global safety constraints even when no memory context provided', () => {
      const anchors = [
        makeAnchor({ anchorId: 'a1', contentSummary: 'Meeting with manager', band: 'B2' }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      const factContextIdx = prompt.indexOf('FACT CONTEXT');
      const globalConstraintsIdx = prompt.indexOf('GLOBAL SAFETY CONSTRAINTS');

      expect(factContextIdx).toBeGreaterThan(-1);
      expect(globalConstraintsIdx).toBeGreaterThan(-1);
      expect(factContextIdx).toBeLessThan(globalConstraintsIdx);
    });
  });

  describe('MAX_ANCHORS_IN_PROMPT=5 enforcement', () => {
    it('caps anchors at 5 even when 10 are provided', () => {
      const anchors = Array.from({ length: 10 }, (_, i) =>
        makeAnchor({
          anchorId: `a${i}`,
          contentSummary: `Anchor summary ${i}`,
          band: 'B3',
        }),
      );

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      const anchorLines = prompt
        .split('\n')
        .filter((line) => line.startsWith('- [') && line.includes('Anchor summary'));

      expect(anchorLines).toHaveLength(5);
      expect(prompt).toContain('Anchor summary 0');
      expect(prompt).toContain('Anchor summary 1');
      expect(prompt).toContain('Anchor summary 2');
      expect(prompt).toContain('Anchor summary 3');
      expect(prompt).toContain('Anchor summary 4');
      expect(prompt).not.toContain('Anchor summary 5');
    });

    it('renders exactly N anchors when N < 5', () => {
      const anchors = [
        makeAnchor({ anchorId: 'a1', contentSummary: 'First anchor', band: 'B4' }),
        makeAnchor({ anchorId: 'a2', contentSummary: 'Second anchor', band: 'B2' }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).toContain('First anchor');
      expect(prompt).toContain('Second anchor');
    });
  });

  describe('band gating', () => {
    it('filters out B0 and B1 anchors', () => {
      const anchors = [
        makeAnchor({ anchorId: 'b0', contentSummary: 'B0 content', band: 'B0' }),
        makeAnchor({ anchorId: 'b1', contentSummary: 'B1 content', band: 'B1' }),
        makeAnchor({ anchorId: 'b3', contentSummary: 'B3 content', band: 'B3' }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).not.toContain('B0 content');
      expect(prompt).not.toContain('B1 content');
      expect(prompt).toContain('B3 content');
    });

    it('renders no FACT CONTEXT when all anchors are B0/B1', () => {
      const anchors = [
        makeAnchor({ anchorId: 'b0', contentSummary: 'Low band', band: 'B0' }),
        makeAnchor({ anchorId: 'b1', contentSummary: 'Also low', band: 'B1' }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).not.toContain('FACT CONTEXT');
      expect(prompt).not.toContain('Possible context');
    });

    it('filters out anchors with undefined band', () => {
      const anchors = [
        makeAnchor({
          anchorId: 'no-band',
          contentSummary: 'No band anchor',
          metrics: { etv: 50, eiv: 30 },
        }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).not.toContain('FACT CONTEXT');
      expect(prompt).not.toContain('No band anchor');
    });

    it('renders B2, B3, B4 anchors', () => {
      const anchors = [
        makeAnchor({ anchorId: 'b2', contentSummary: 'B2 content', band: 'B2' }),
        makeAnchor({ anchorId: 'b3', contentSummary: 'B3 content', band: 'B3' }),
        makeAnchor({ anchorId: 'b4', contentSummary: 'B4 content', band: 'B4' }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).toContain('B2 content');
      expect(prompt).toContain('B3 content');
      expect(prompt).toContain('B4 content');
    });
  });

  describe('anchor block format', () => {
    it('includes "Possible context:" prefix', () => {
      const anchors = [makeAnchor({ band: 'B3' })];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).toContain('Possible context:');
    });

    it('includes trailing "Does this relate to what you mean today?"', () => {
      const anchors = [makeAnchor({ band: 'B3' })];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).toContain('Does this relate to what you mean today?');
    });

    it('renders timestamp and summary for each anchor', () => {
      const anchors = [
        makeAnchor({
          contentSummary: 'Interview at Google',
          timestamp: 1700000000000,
          band: 'B3',
        }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      expect(prompt).toContain('Interview at Google');
      expect(prompt).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/);
    });

    it('never contains "I remember" or "you said" or companionship language', () => {
      const anchors = [
        makeAnchor({ contentSummary: 'Some fact', band: 'B4' }),
        makeAnchor({ contentSummary: 'Another fact', band: 'B3', anchorId: 'a2' }),
      ];

      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: anchors },
      );

      const FORBIDDEN = [
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
      const anchorSection = prompt.split('FACT CONTEXT')[1] ?? '';
      const lower = anchorSection.toLowerCase();
      for (const f of FORBIDDEN) {
        expect(lower).not.toContain(f);
      }
    });
  });

  describe('Known facts (structured anchors with slotValue)', () => {
    it('includes Known facts section when anchors have slotValue', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        {
          relevantAnchors: [
            makeAnchor({
              contentSummary: 'launch_date = 2026-03-23',
              slotValue: 'launch_date = 2026-03-23',
              metrics: { etv: 50, eiv: 40, band: 'B4' },
            }),
          ],
        },
      );
      expect(prompt).toContain('Known facts:');
      expect(prompt).toContain('launch_date = 2026-03-23');
    });
  });

  describe('empty / absent anchors', () => {
    it('no FACT CONTEXT block when relevantAnchors is undefined', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
      );

      expect(prompt).not.toContain('FACT CONTEXT');
    });

    it('no FACT CONTEXT block when relevantAnchors is empty array', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { relevantAnchors: [] },
      );

      expect(prompt).not.toContain('FACT CONTEXT');
    });
  });
});
