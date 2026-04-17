import { EmotionalState } from '../../types/analysis.types';
import { ETVState } from '../../types/etv.types';

const mockFlags: Record<string, boolean | number> = {
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

describe('PromptTemplateBuilder — Response Shape Contract block', () => {
  it('includes RESPONSE SHAPE CONTRACT when rsc option provided', () => {
    const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
      band: 'B2',
      eiv: 0.5,
      responseShapeContract: {
        blockText: 'Test RSC block content here.',
        contractId: 'rsc.validation.B2.medium',
      },
    });
    expect(prompt).toContain('RESPONSE SHAPE CONTRACT');
    expect(prompt).toContain('Test RSC block content here.');
  });

  it('does NOT include RESPONSE SHAPE CONTRACT when option is absent', () => {
    const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
      band: 'B2',
      eiv: 0.5,
    });
    expect(prompt).not.toContain('RESPONSE SHAPE CONTRACT');
  });

  it('RSC appears after NARRATIVE MOMENTUM when both present', () => {
    const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
      band: 'B2',
      eiv: 0.5,
      narrativeMomentum: {
        dominantTheme: 'work',
        emotionalTrajectory: 'rising',
        currentPhase: 'probing',
        suggestedStrategy: 'synthesis',
      },
      responseShapeContract: {
        blockText: 'RSC content here.',
        contractId: 'rsc.synthesis.B2.medium',
      },
    });

    const narrativeIdx = prompt.indexOf('NARRATIVE MOMENTUM');
    const rscIdx = prompt.indexOf('RESPONSE SHAPE CONTRACT');
    expect(narrativeIdx).toBeGreaterThan(-1);
    expect(rscIdx).toBeGreaterThan(-1);
    expect(rscIdx).toBeGreaterThan(narrativeIdx);
  });

  it('RSC lives in the dynamic suffix (after GLOBAL SAFETY CONSTRAINTS)', () => {
    // Static blocks are now at the top for prompt caching; per-request blocks
    // like RESPONSE SHAPE CONTRACT live after GLOBAL SAFETY CONSTRAINTS.
    const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
      band: 'B2',
      eiv: 0.5,
      responseShapeContract: {
        blockText: 'RSC content.',
        contractId: 'rsc.test',
      },
    });

    const rscIdx = prompt.indexOf('RESPONSE SHAPE CONTRACT');
    const constraintsIdx = prompt.indexOf('GLOBAL SAFETY CONSTRAINTS');
    expect(rscIdx).toBeGreaterThan(-1);
    expect(constraintsIdx).toBeGreaterThan(-1);
    expect(rscIdx).toBeGreaterThan(constraintsIdx);
  });

  it('existing context blocks remain unaffected when RSC is present', () => {
    const prompt = PromptTemplateBuilder.build(makeEmotionalState(), makeETVState(), {
      band: 'B2',
      eiv: 0.5,
      sessionHistory: [{ role: 'user', text: 'hello', ts: 1000 }],
      responseShapeContract: {
        blockText: 'RSC content.',
        contractId: 'rsc.test',
      },
    });

    expect(prompt).toContain('SESSION CONTEXT');
    expect(prompt).toContain('RESPONSE SHAPE CONTRACT');
    expect(prompt).toContain('GLOBAL SAFETY CONSTRAINTS');
  });
});
