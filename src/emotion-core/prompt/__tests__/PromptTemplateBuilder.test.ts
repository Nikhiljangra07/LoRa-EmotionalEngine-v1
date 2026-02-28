// src/emotion-core/prompt/__tests__/PromptTemplateBuilder.test.ts

import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import { EmotionalState } from '../../types/analysis.types';
import { ETVState } from '../../types/etv.types';

describe('PromptTemplateBuilder — Behavioral Prompt Engineering', () => {
  /**
   * Helper to assert forbidden content
   *
   * NOTE:
   * - We intentionally block numeric leaks (EIV/ETV, raw scores, analyzer names).
   * - This helper is strict by design.
   */
  function expectNoNumericLeak(prompt: string) {
    expect(prompt).not.toMatch(/\b0\.\d+\b/); // no floats like 0.3
    expect(prompt).not.toMatch(/EIV/i);
    expect(prompt).not.toMatch(/ETV/i);
    expect(prompt).not.toMatch(/emoji/i);
    expect(prompt).not.toMatch(/punctuation/i);
    expect(prompt).not.toMatch(/capital/i);
    expect(prompt).not.toMatch(/analyzer/i);
  }

  /**
   * Factory helpers (tests may cast to avoid coupling to internal type shapes)
   * We ONLY set fields the builder is expected to read; everything else is irrelevant.
   */
  function makeEmotionalState(
    arousal: 'LOW' | 'MEDIUM' | 'HIGH',
    valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE'
  ): EmotionalState {
    return {
      dominant: 'NEUTRAL',
      arousal,
      valence,
      confidence: 1,
    };
  }

  function makeETVState(value: number): ETVState {
    return {
      value,
      sessionEIVs: [],
      messageCount: 0,
      lastUpdated: 0,
    };
  }

  /**
   * BASELINE: Neutral / Low intensity / Stranger
   */
  it('builds a neutral, professional prompt for low-intensity stranger context', () => {
    const emotionalState = makeEmotionalState('LOW', 'NEUTRAL');
    const etvState = makeETVState(0.3);

    const prompt = PromptTemplateBuilder.build(emotionalState, etvState);

    expect(prompt).toContain('calm');
    expect(prompt).toContain('professional');
    expect(prompt).toContain('neutral');

    expectNoNumericLeak(prompt);
  });

  /**
   * POSITIVE + HIGH INTENSITY
   */
  it('encourages energy matching for high positive intensity', () => {
    const emotionalState = makeEmotionalState('HIGH', 'POSITIVE');
    const etvState = makeETVState(0.3);

    const prompt = PromptTemplateBuilder.build(emotionalState, etvState);

    expect(prompt).toMatch(/grounded/i);

    expect(prompt).toMatch(/over-perform|don't overdo|do not overdo|lose focus/i);

    expectNoNumericLeak(prompt);
  });

  /**
   * NEGATIVE + HIGH INTENSITY
   */
  it('enforces calm, validating tone for high negative intensity', () => {
    const emotionalState = makeEmotionalState('HIGH', 'NEGATIVE');
    const etvState = makeETVState(0.3);

    const prompt = PromptTemplateBuilder.build(emotionalState, etvState);

    expect(prompt).toMatch(/calm/i);
    expect(prompt).toMatch(/validate/i);
    expect(prompt).toMatch(/slow.*interaction|do not escalate/i);

    expectNoNumericLeak(prompt);
  });

  /**
   * ETV EFFECT: Stranger vs Familiar
   *
   * IMPORTANT:
   * - We do NOT rely on ETV "labels" in tests; only numeric values.
   * - We assert *observable* differences in guidance wording.
   */
  it('changes intimacy based on ETV without changing emotion logic', () => {
    const emotionalState = makeEmotionalState('MEDIUM', 'POSITIVE');

    const strangerPrompt = PromptTemplateBuilder.build(emotionalState, makeETVState(0.3));
    const familiarPrompt = PromptTemplateBuilder.build(emotionalState, makeETVState(0.7));

    expect(strangerPrompt).toMatch(/professional/i);
    expect(familiarPrompt).toMatch(/friendly|casual/i);

    expectNoNumericLeak(strangerPrompt);
    expectNoNumericLeak(familiarPrompt);
  });

  /**
   * HARD CONSTRAINT: No emotional reasoning inside LLM
   */
  it('does not instruct the LLM to infer emotions', () => {
    const emotionalState = makeEmotionalState('HIGH', 'NEGATIVE');
    const etvState = makeETVState(0.3);

    const prompt = PromptTemplateBuilder.build(emotionalState, etvState);

    expect(prompt).not.toMatch(/analyze/i);
    expect(prompt).not.toMatch(/detect/i);
    expect(prompt).not.toMatch(/infer/i);
    expect(prompt).not.toMatch(/guess/i);
  });

  /**
   * SAFETY: Prompt must always include role identity
   */
  it('always establishes system identity and boundaries', () => {
    const emotionalState = makeEmotionalState('LOW', 'NEUTRAL');
    const etvState = makeETVState(0.3);

    const prompt = PromptTemplateBuilder.build(emotionalState, etvState);

    expect(prompt).toMatch(/you are/i);
    expect(prompt).toMatch(/perceptive conversational presence/i);
    expect(prompt).toMatch(/Nikhil/i); // stable creator identity
    expect(prompt).not.toMatch(/NeuraSoul/i);
    expect(prompt).toMatch(/do not/i); // must include constraints

    expectNoNumericLeak(prompt);
  });
});
