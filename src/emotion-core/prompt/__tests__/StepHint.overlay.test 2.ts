export {};

import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';

const MINIMAL_STATE: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'LOW',
  valence: 'NEUTRAL',
  confidence: 0.5,
};

const MINIMAL_ETV: ETVState = {
  value: 0.5,
  sessionEIVs: [],
  messageCount: 0,
  lastUpdated: Date.now(),
};

function buildWith(stepHint?: string) {
  return PromptTemplateBuilder.build(MINIMAL_STATE, MINIMAL_ETV, {
    guidanceMode: 'CALM_NEUTRAL',
    ...(stepHint ? { stepHint } : {}),
  } as any);
}

describe('StepHint overlay', () => {
  test('undefined → no marker in prompt', () => {
    const prompt = buildWith(undefined);
    expect(prompt).not.toContain('[STEP_HINT:');
  });

  test('ONE_STEP → [STEP_HINT:ONE_STEP] marker present', () => {
    const prompt = buildWith('ONE_STEP');
    expect(prompt).toContain('[STEP_HINT:ONE_STEP]');
  });

  test('TWO_STEPS → [STEP_HINT:TWO_STEPS] marker present', () => {
    const prompt = buildWith('TWO_STEPS');
    expect(prompt).toContain('[STEP_HINT:TWO_STEPS]');
  });

  test('different hints produce different overlay content', () => {
    const one = buildWith('ONE_STEP');
    const two = buildWith('TWO_STEPS');
    expect(one).not.toBe(two);
  });
});
