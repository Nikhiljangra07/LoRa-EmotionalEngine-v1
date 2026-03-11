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

function buildWith(interruptHint?: string) {
  return PromptTemplateBuilder.build(MINIMAL_STATE, MINIMAL_ETV, {
    guidanceMode: 'CALM_NEUTRAL',
    ...(interruptHint ? { interruptHint } : {}),
  } as any);
}

describe('InterruptHint overlay', () => {
  test('undefined → no marker in prompt', () => {
    const prompt = buildWith(undefined);
    expect(prompt).not.toContain('[INTERRUPT_HINT:');
  });

  test('SOFT → [INTERRUPT_HINT:SOFT] marker present', () => {
    const prompt = buildWith('SOFT');
    expect(prompt).toContain('[INTERRUPT_HINT:SOFT]');
  });

  test('FIRM → [INTERRUPT_HINT:FIRM] marker present', () => {
    const prompt = buildWith('FIRM');
    expect(prompt).toContain('[INTERRUPT_HINT:FIRM]');
  });

  test('HARD_STOP → [INTERRUPT_HINT:HARD_STOP] marker present', () => {
    const prompt = buildWith('HARD_STOP');
    expect(prompt).toContain('[INTERRUPT_HINT:HARD_STOP]');
  });

  test('different hints produce different overlay content', () => {
    const soft = buildWith('SOFT');
    const firm = buildWith('FIRM');
    const hardStop = buildWith('HARD_STOP');
    expect(soft).not.toBe(firm);
    expect(firm).not.toBe(hardStop);
  });
});
