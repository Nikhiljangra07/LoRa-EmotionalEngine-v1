import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';
import type { PromptProfile } from '../../types/logging.types';

const ALL_MODES: PromptProfile['guidanceMode'][] = [
  'CALM_NEUTRAL',
  'ENERGY_MATCH',
  'VALIDATING',
  'DE_ESCALATE',
  'SUPPORTIVE',
  'FALLBACK',
  'STABILIZE',
  'SUPPORTIVE_REFLECTION',
];

function makeEmotionalState(
  arousal: 'LOW' | 'MEDIUM' | 'HIGH',
  valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE',
): EmotionalState {
  return { dominant: 'NEUTRAL', arousal, valence, confidence: 1 };
}

function makeETVState(value: number): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

describe('GuidanceMode compatibility matrix', () => {
  const emotionalState = makeEmotionalState('MEDIUM', 'NEGATIVE');
  const etvState = makeETVState(0.5);

  describe.each(ALL_MODES)('mode: %s', (mode) => {
    let prompt: string;

    beforeAll(() => {
      prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
        guidanceMode: mode,
        momentumConfidence: 0.5,
      });
    });

    test('does not throw', () => {
      expect(() =>
        PromptTemplateBuilder.build(emotionalState, etvState, {
          guidanceMode: mode,
        }),
      ).not.toThrow();
    });

    test('returns a non-empty string', () => {
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('contains system identity marker', () => {
      expect(prompt).toMatch(/You are LoRa/);
    });

    test('contains RESPONSE PRINCIPLES section', () => {
      expect(prompt).toContain('RESPONSE PRINCIPLES');
    });

    test('contains GLOBAL SAFETY CONSTRAINTS section', () => {
      expect(prompt).toContain('GLOBAL SAFETY CONSTRAINTS');
    });
  });

  test('STABILIZE mode includes grounding guidance', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      guidanceMode: 'STABILIZE',
    });
    expect(prompt).toMatch(/grounding/i);
    expect(prompt).toMatch(/stability/i);
    expect(prompt).toMatch(/calm/i);
  });

  test('SUPPORTIVE_REFLECTION mode includes reflective guidance', () => {
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      guidanceMode: 'SUPPORTIVE_REFLECTION',
    });
    expect(prompt).toMatch(/reflect/i);
    expect(prompt).toMatch(/validate/i);
    expect(prompt).toMatch(/patience/i);
  });

  test('legacy modes do NOT include new overlay text', () => {
    const legacyModes: PromptProfile['guidanceMode'][] = [
      'CALM_NEUTRAL',
      'ENERGY_MATCH',
      'VALIDATING',
      'DE_ESCALATE',
      'SUPPORTIVE',
      'FALLBACK',
    ];
    for (const mode of legacyModes) {
      const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
        guidanceMode: mode,
      });
      expect(prompt).not.toMatch(/grounding and stability/i);
      expect(prompt).not.toMatch(/Gently reflect what the user has shared/i);
    }
  });
});
