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

function buildWith(questionBudgetHint?: string) {
  return PromptTemplateBuilder.build(MINIMAL_STATE, MINIMAL_ETV, {
    guidanceMode: 'CALM_NEUTRAL',
    ...(questionBudgetHint ? { questionBudgetHint } : {}),
  } as any);
}

describe('QuestionBudgetHint overlay', () => {
  test('undefined → no marker in prompt', () => {
    const prompt = buildWith(undefined);
    expect(prompt).not.toContain('[QUESTION_BUDGET:');
  });

  test('ZERO → [QUESTION_BUDGET:ZERO] marker present', () => {
    const prompt = buildWith('ZERO');
    expect(prompt).toContain('[QUESTION_BUDGET:ZERO]');
  });

  test('ONE → [QUESTION_BUDGET:ONE] marker present', () => {
    const prompt = buildWith('ONE');
    expect(prompt).toContain('[QUESTION_BUDGET:ONE]');
  });

  test('ZERO and ONE produce different overlay content', () => {
    const zero = buildWith('ZERO');
    const one = buildWith('ONE');
    expect(zero).not.toBe(one);
  });
});
