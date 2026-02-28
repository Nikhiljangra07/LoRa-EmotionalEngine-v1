import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';
import type { PromptProfile } from '../../types/logging.types';

jest.mock('../../config/featureFlags', () => ({
  get featureFlags() {
    return {
      strictGuidanceModeEnabled: false,
      etvPolicyPromptEnabled: false,
      etvPolicyPromptShadowEnabled: false,
      memoryV1Enabled: false,
      memoryV1ShadowEnabled: false,
    };
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
  return { dominant: 'NEUTRAL', arousal: 'MEDIUM', valence: 'NEGATIVE', confidence: 1 };
}

function makeETVState(value = 0.5): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

const MODE_EXPECTED_PHRASES: Record<string, string> = {
  CALM_NEUTRAL: 'progress-forward',
  ENERGY_MATCH: 'Increase pace slightly',
  STABILIZING: 'narrow scope',
  CONTAINMENT: 'contain to one thread',
  DE_ESCALATE: 'Soften edges',
  STABILIZE: 'grounding and stability',
  SUPPORTIVE_REFLECTION: 'Observe what the user has shared',
};

describe('PromptTemplateBuilder — guidance mode overlays', () => {
  describe.each(Object.entries(MODE_EXPECTED_PHRASES))(
    'mode: %s',
    (mode, expectedPhrase) => {
      test(`produces non-empty overlay containing "${expectedPhrase}"`, () => {
        const prompt = PromptTemplateBuilder.build(
          makeEmotionalState(),
          makeETVState(),
          { guidanceMode: mode as PromptProfile['guidanceMode'] },
        );

        expect(prompt).toContain(expectedPhrase);
      });
    },
  );

  test('unknown mode produces no overlay but does not throw (strict mode off)', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
      { guidanceMode: 'VALIDATING' as PromptProfile['guidanceMode'] },
    );

    expect(prompt).toContain('RESPONSE PRINCIPLES');
    expect(prompt).not.toContain('progress-forward');
    expect(prompt).not.toContain('contain to one thread');
  });

  test('no overlay when guidanceMode is undefined', () => {
    const prompt = PromptTemplateBuilder.build(
      makeEmotionalState(),
      makeETVState(),
    );

    expect(prompt).not.toContain('progress-forward');
    expect(prompt).not.toContain('contain to one thread');
    expect(prompt).not.toContain('Soften edges');
    expect(prompt).not.toContain('Increase pace slightly');
  });

  test('no banned therapy phrases in any overlay', () => {
    const BANNED = [
      "it sounds like",
      "it's okay to feel",
      "i hear you",
      "that must be",
      "it's natural to feel",
      "how does that make you feel",
    ];

    for (const mode of Object.keys(MODE_EXPECTED_PHRASES)) {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(),
        { guidanceMode: mode as PromptProfile['guidanceMode'] },
      ).toLowerCase();

      for (const banned of BANNED) {
        expect(prompt).not.toContain(banned);
      }
    }
  });
});
