import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';

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

function makeETVState(value = 0.3): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

describe('PromptTemplateBuilder — Ekman dominant signal', () => {
  test('includes Ekman dominant signal line when ekmanDominant is set', () => {
    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'LOW',
      valence: 'NEUTRAL',
      confidence: 1,
      ekmanDominant: 'ANGER',
      ekmanConfidence: 0.7,
    };

    const prompt = PromptTemplateBuilder.build(state, makeETVState());
    expect(prompt).toContain('Dominant signal: ANGER');
  });

  test('omits Ekman signal line when ekmanDominant is undefined', () => {
    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'LOW',
      valence: 'NEUTRAL',
      confidence: 1,
    };

    const prompt = PromptTemplateBuilder.build(state, makeETVState());
    expect(prompt).not.toContain('Dominant signal:');
  });

  test('SADNESS Ekman with LOW arousal produces sadness-specific guidance', () => {
    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'LOW',
      valence: 'NEUTRAL',
      confidence: 1,
      ekmanDominant: 'SADNESS',
      ekmanConfidence: 0.65,
    };

    const prompt = PromptTemplateBuilder.build(state, makeETVState());
    expect(prompt).toContain('Quiet weight detected');
    expect(prompt).not.toContain('Stay calm and neutral');
  });

  test('ANGER Ekman with LOW arousal produces tension-specific guidance', () => {
    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'LOW',
      valence: 'NEUTRAL',
      confidence: 1,
      ekmanDominant: 'ANGER',
      ekmanConfidence: 0.6,
    };

    const prompt = PromptTemplateBuilder.build(state, makeETVState());
    expect(prompt).toContain('tension detected');
    expect(prompt).not.toContain('Stay calm and neutral');
  });

  test('FEAR Ekman with LOW arousal produces apprehension-specific guidance', () => {
    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'LOW',
      valence: 'NEUTRAL',
      confidence: 1,
      ekmanDominant: 'FEAR',
      ekmanConfidence: 0.5,
    };

    const prompt = PromptTemplateBuilder.build(state, makeETVState());
    expect(prompt).toContain('apprehension detected');
    expect(prompt).not.toContain('Stay calm and neutral');
  });

  test('JOY Ekman with LOW arousal falls through to default neutral guidance', () => {
    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'LOW',
      valence: 'NEUTRAL',
      confidence: 1,
      ekmanDominant: 'JOY',
      ekmanConfidence: 0.8,
    };

    const prompt = PromptTemplateBuilder.build(state, makeETVState());
    expect(prompt).toContain('Dominant signal: JOY');
    expect(prompt).toContain('Stay calm and neutral');
  });

  test('HIGH arousal overrides Ekman-specific guidance', () => {
    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'HIGH',
      valence: 'NEGATIVE',
      confidence: 1,
      ekmanDominant: 'ANGER',
      ekmanConfidence: 0.8,
    };

    const prompt = PromptTemplateBuilder.build(state, makeETVState());
    expect(prompt).toContain('Dominant signal: ANGER');
    expect(prompt).toContain('grounded');
  });

  test('no banned phrases leak from Ekman guidance', () => {
    const BANNED = [
      "it sounds like",
      "it's okay to feel",
      "i hear you",
      "that must be",
      "it's natural to feel",
    ];

    for (const ekman of ['ANGER', 'FEAR', 'SADNESS', 'DISGUST'] as const) {
      const state: EmotionalState = {
        dominant: 'NEUTRAL',
        arousal: 'LOW',
        valence: 'NEUTRAL',
        confidence: 1,
        ekmanDominant: ekman,
        ekmanConfidence: 0.7,
      };

      const prompt = PromptTemplateBuilder.build(state, makeETVState()).toLowerCase();
      for (const banned of BANNED) {
        expect(prompt).not.toContain(banned);
      }
    }
  });
});
