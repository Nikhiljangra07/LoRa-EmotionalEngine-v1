// src/emotion-core/math/__test__/punctuation.math.test.ts

import {
  calculatePunctuationIntensity,
  PUNCTUATION_BASE_WEIGHTS,
} from '../punctuation.math';

describe('Punctuation Math — Emotional Intensity (Research-Aligned)', () => {
  /* ============================================================================
   * Base Semantics
   * ========================================================================== */

  test('base punctuation weights reflect emotional salience ordering', () => {
    expect(PUNCTUATION_BASE_WEIGHTS['!?'])
      .toBeGreaterThan(PUNCTUATION_BASE_WEIGHTS['!']);

    expect(PUNCTUATION_BASE_WEIGHTS['!'])
      .toBeGreaterThan(PUNCTUATION_BASE_WEIGHTS['?']);

    expect(PUNCTUATION_BASE_WEIGHTS['?'])
      .toBeGreaterThan(PUNCTUATION_BASE_WEIGHTS['...']);
  });

  test('single punctuation yields baseline intensity only', () => {
    for (const symbol of ['!', '?', '...', '!?']) {
      const value = calculatePunctuationIntensity(symbol, 1);
      expect(value).toBeCloseTo(
        PUNCTUATION_BASE_WEIGHTS[symbol],
        4
      );
    }
  });

  /* ============================================================================
   * Monotonicity & Diminishing Returns
   * ========================================================================== */

  test('repetition monotonically increases intensity', () => {
    let prev = calculatePunctuationIntensity('!', 1);

    for (let n = 2; n <= 10; n++) {
      const current = calculatePunctuationIntensity('!', n);
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });

  test('diminishing returns: marginal gains shrink as repetition increases', () => {
    const values = [1, 2, 3, 4, 5].map(n =>
      calculatePunctuationIntensity('!', n)
    );

    const deltas = values
      .slice(1)
      .map((v, i) => v - values[i]);

    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeLessThanOrEqual(deltas[i - 1]);
    }
  });

  /* ============================================================================
   * Saturation & Spam Resistance
   * ========================================================================== */

  test('saturation: gains after perceptual threshold are minimal', () => {
    const four = calculatePunctuationIntensity('!', 4);
    const ten = calculatePunctuationIntensity('!', 10);
    const hundred = calculatePunctuationIntensity('!', 100);

    const gainEarly = ten - four;
    const gainLate = hundred - ten;

    // Later gains must be significantly smaller
    expect(gainLate).toBeLessThan(gainEarly);
  });

  test('extreme repetition plateaus well below runaway intensity', () => {
    const extreme = calculatePunctuationIntensity('!', 200);

    expect(extreme).toBeGreaterThan(0.7);   // Still expressive
    expect(extreme).toBeLessThan(1.0);      // Never maxes out alone
  });

  /* ============================================================================
   * Psychological Realism
   * ========================================================================== */

  test('psychological equivalence: 4 vs 5 repetitions are nearly indistinguishable', () => {
    const four = calculatePunctuationIntensity('!', 4);
    const five = calculatePunctuationIntensity('!', 5);

    const difference = five - four;

    // Humans barely perceive a difference beyond saturation
    expect(difference).toBeLessThan(0.02);
  });

  test('mixed punctuation dominates single-type punctuation', () => {
    const bang = calculatePunctuationIntensity('!', 1);
    const mixed = calculatePunctuationIntensity('!?', 1);

    expect(mixed).toBeGreaterThan(bang);
  });

  /* ============================================================================
   * Semantic Dominance Guardrails
   * ========================================================================== */

  test('punctuation amplifies emotion but does not dominate semantics', () => {
    const ten = calculatePunctuationIntensity('!', 10);

    // Leaves headroom for lexical + contextual emotion
    expect(ten).toBeLessThan(0.95);
  });

  /* ============================================================================
   * Numerical Stability
   * ========================================================================== */

  test('numerical stability: no NaN or Infinity across wide range', () => {
    for (let n = 0; n <= 500; n++) {
      const value = calculatePunctuationIntensity('!', n);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
