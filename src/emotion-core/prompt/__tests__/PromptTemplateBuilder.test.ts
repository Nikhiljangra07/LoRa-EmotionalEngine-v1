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
    expect(prompt).not.toMatch(/\b\d+\b/); // no raw numbers
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
    intensity: 'LOW' | 'MEDIUM' | 'HIGH',
    tone: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE'
  ): EmotionalState {
    return { intensity, tone } as unknown as EmotionalState;
  }

  function makeETVState(value: number): ETVState {
    return { value } as unknown as ETVState;
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

    expect(prompt).toMatch(/calm/i);
    expect(prompt).toMatch(/warm/i);

    // Your test comment says "must include moderation" but the matcher was inverted.
    // If you truly require moderation guidance, this should be a positive assertion.
    expect(prompt).toMatch(/don't overdo|do not overdo|avoid overdoing|keep it natural|moderate/i);

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
    expect(prompt).toMatch(/neutral/i);
    expect(prompt).toMatch(/do not escalate/i);

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
    expect(prompt).toMatch(/emotionally aware/i);
    expect(prompt).toMatch(/do not/i); // must include constraints

    expectNoNumericLeak(prompt);
  });
});
