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

jest.mock('../../../emotion-core/config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

jest.mock('../../../emotion-core/debug/debugGate', () => ({
  debugEnabled: false,
  decisionLogEnabled: false,
}));

jest.mock('../../prompt/etvPolicyPromptMap', () => ({
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

import { PromptTemplateBuilder } from '../../prompt/PromptTemplateBuilder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeES(
  arousal: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW',
  valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE' = 'NEUTRAL',
): EmotionalState {
  return { dominant: 'NEUTRAL', arousal, valence, confidence: 1 };
}

function makeETV(value: number = 0.3): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

const MEMORY_CTX = {
  topSchemas: [
    { schemaId: 'schema_x', emotionTrajectory: 'calm-stable', behavioralTendency: 'responds-to-validation', relevance: 'HIGH' },
    { schemaId: 'schema_y', emotionTrajectory: 'volatile', behavioralTendency: 'needs-structure', relevance: 'MED' },
    { schemaId: 'schema_z', emotionTrajectory: 'recovering', behavioralTendency: 'responds-to-clarification', relevance: 'LOW' },
  ],
  sessionPattern: 'calm-stable',
  confidenceLevel: 'HIGH',
};

/**
 * Extracts only the MEMORY CONTEXT section from a prompt.
 * Returns null if the section is not present.
 */
function extractMemorySection(prompt: string): string | null {
  const marker = 'MEMORY CONTEXT (privacy-safe, categorical)';
  const idx = prompt.indexOf(marker);
  if (idx === -1) return null;
  return prompt.slice(idx);
}

const FLOAT_RE = /\d+\.\d+|\b0\.\d+\b|\b1\.\d+\b/;

const FORBIDDEN_PHRASES = [
  'companion', 'companionship', 'intimacy', 'intimate', 'bond', 'bonding',
  'attachment', 'affection', 'closeness', 'rapport', 'love you', 'miss you',
  'need me', 'depend on me', 'buddy', 'best friend', 'soulmate', 'partner',
  'casual',
];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_PHRASES.join('|')})\\b`, 'i');

const VALID_TRAJECTORIES = ['calm-stable', 'escalating-negative', 'volatile', 'recovering', 'unknown'];
const VALID_TENDENCIES = ['responds-to-clarification', 'responds-to-validation', 'resists-directiveness', 'needs-structure', 'unknown'];
const VALID_CONFIDENCE = ['HIGH', 'MED', 'LOW'];
const VALID_RELEVANCE = ['HIGH', 'MED', 'LOW'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Memory V1 — Live Enable (PromptTemplateBuilder)', () => {
  beforeEach(() => {
    mockFlags.memoryV1Enabled = false;
    mockFlags.memoryV1ShadowEnabled = false;
    PromptTemplateBuilder.resetMemoryShadowLimiter();
  });

  describe('flags OFF', () => {
    it('no MEMORY CONTEXT block appears', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      expect(extractMemorySection(prompt)).toBeNull();
    });
  });

  describe('LORA_MEMORY_V1=1', () => {
    beforeEach(() => {
      mockFlags.memoryV1Enabled = true;
    });

    it('MEMORY CONTEXT block is present', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt);
      expect(section).not.toBeNull();
      expect(section).toContain('privacy-safe, categorical');
    });

    it('section contains no raw floats', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      expect(section).not.toMatch(FLOAT_RE);
    });

    it('section contains no forbidden companionship/intimacy/dependency phrases', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      expect(section).not.toMatch(FORBIDDEN_RE);
    });

    it('section contains no "casual" label', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      expect(section).not.toMatch(/\bcasual\b/i);
    });

    it('all trajectory values are categorical', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      const matches = section.match(/trajectory=(\S+)/g) ?? [];
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        const val = m.replace('trajectory=', '');
        expect(VALID_TRAJECTORIES).toContain(val);
      }
    });

    it('all tendency values are categorical', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      const matches = section.match(/tendency=(\S+)/g) ?? [];
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        const val = m.replace('tendency=', '');
        expect(VALID_TENDENCIES).toContain(val);
      }
    });

    it('all relevance values are categorical', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      const matches = section.match(/relevance=(\S+)/g) ?? [];
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        const val = m.replace('relevance=', '');
        expect(VALID_RELEVANCE).toContain(val);
      }
    });

    it('confidence level is categorical', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      const match = section.match(/confidence:\s*(\S+)/);
      expect(match).not.toBeNull();
      expect(VALID_CONFIDENCE).toContain(match![1]);
    });

    it('sessionPattern is a valid trajectory label', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      const match = section.match(/sessionPattern:\s*(\S+)/);
      expect(match).not.toBeNull();
      expect(VALID_TRAJECTORIES).toContain(match![1]);
    });

    it('section does not leak internal terminology', () => {
      const prompt = PromptTemplateBuilder.build(makeES(), makeETV(), {
        memoryContext: MEMORY_CTX,
      });
      const section = extractMemorySection(prompt)!;
      expect(section).not.toMatch(/\bEIV\b/i);
      expect(section).not.toMatch(/\bETV\b/i);
      expect(section).not.toMatch(/\bsalience\b/i);
      expect(section).not.toMatch(/\bcentroid\b/i);
      expect(section).not.toMatch(/\banalyzer\b/i);
      expect(section).not.toMatch(/\bvector\b/i);
      expect(section).not.toMatch(/\bembedding\b/i);
    });
  });
});
