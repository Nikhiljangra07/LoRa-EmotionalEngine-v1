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

function buildWith(actionHint?: string) {
  return PromptTemplateBuilder.build(MINIMAL_STATE, MINIMAL_ETV, {
    guidanceMode: 'CALM_NEUTRAL',
    ...(actionHint ? { actionHint } : {}),
  } as any);
}

describe('ActionHint overlay', () => {
  test('undefined → no marker in prompt', () => {
    const prompt = buildWith(undefined);
    expect(prompt).not.toContain('[ACTION_HINT:');
  });

  test('ASK_ONE_QUESTION → [ACTION_HINT:ASK_ONE_QUESTION] marker present', () => {
    const prompt = buildWith('ASK_ONE_QUESTION');
    expect(prompt).toContain('[ACTION_HINT:ASK_ONE_QUESTION]');
  });

  test('OFFER_STEPS → [ACTION_HINT:OFFER_STEPS] marker present', () => {
    const prompt = buildWith('OFFER_STEPS');
    expect(prompt).toContain('[ACTION_HINT:OFFER_STEPS]');
  });

  test('ENCOURAGE_BREATH → [ACTION_HINT:ENCOURAGE_BREATH] marker present', () => {
    const prompt = buildWith('ENCOURAGE_BREATH');
    expect(prompt).toContain('[ACTION_HINT:ENCOURAGE_BREATH]');
  });

  test('SUGGEST_BREAK → [ACTION_HINT:SUGGEST_BREAK] marker present', () => {
    const prompt = buildWith('SUGGEST_BREAK');
    expect(prompt).toContain('[ACTION_HINT:SUGGEST_BREAK]');
  });

  test('NO_ACTION → [ACTION_HINT:NO_ACTION] marker present', () => {
    const prompt = buildWith('NO_ACTION');
    expect(prompt).toContain('[ACTION_HINT:NO_ACTION]');
  });

  test('different hints produce different overlay content', () => {
    const a = buildWith('ASK_ONE_QUESTION');
    const b = buildWith('SUGGEST_BREAK');
    expect(a).not.toBe(b);
  });
});
