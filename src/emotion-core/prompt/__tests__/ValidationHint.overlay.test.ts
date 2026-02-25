export {};

import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';

const EMOTIONAL_STATE: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'LOW',
  valence: 'NEUTRAL',
  confidence: 0.5,
};

const ETV_STATE: ETVState = {
  value: 0.5,
  sessionEIVs: [],
  messageCount: 0,
  lastUpdated: Date.now(),
};

describe('ValidationHint overlay', () => {
  test('undefined → no marker in prompt', () => {
    const prompt = PromptTemplateBuilder.build(EMOTIONAL_STATE, ETV_STATE, {
      guidanceMode: 'CALM_NEUTRAL',
    });
    expect(prompt).not.toContain('[VALIDATION_HINT:');
  });

  test('LIGHT → [VALIDATION_HINT:LIGHT] marker present', () => {
    const prompt = PromptTemplateBuilder.build(EMOTIONAL_STATE, ETV_STATE, {
      guidanceMode: 'CALM_NEUTRAL',
      validationHint: 'LIGHT',
    });
    expect(prompt).toContain('[VALIDATION_HINT:LIGHT]');
    expect(prompt).not.toContain('[VALIDATION_HINT:STRONG]');
  });

  test('STRONG → [VALIDATION_HINT:STRONG] marker present', () => {
    const prompt = PromptTemplateBuilder.build(EMOTIONAL_STATE, ETV_STATE, {
      guidanceMode: 'CALM_NEUTRAL',
      validationHint: 'STRONG',
    });
    expect(prompt).toContain('[VALIDATION_HINT:STRONG]');
    expect(prompt).not.toContain('[VALIDATION_HINT:LIGHT]');
  });

  test('STRONG and LIGHT produce different overlay content', () => {
    const strong = PromptTemplateBuilder.build(EMOTIONAL_STATE, ETV_STATE, {
      guidanceMode: 'CALM_NEUTRAL',
      validationHint: 'STRONG',
    });
    const light = PromptTemplateBuilder.build(EMOTIONAL_STATE, ETV_STATE, {
      guidanceMode: 'CALM_NEUTRAL',
      validationHint: 'LIGHT',
    });
    expect(strong).not.toBe(light);
  });
});
