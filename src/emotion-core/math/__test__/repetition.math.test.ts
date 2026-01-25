// src/emotion-core/math/__test__/repetition.math.test.ts

import { repetitionIntensityBoost } from '../repetition.math';

describe('Repetition Math — Intensity Boost (Signal Layer)', () => {
  test('single occurrence produces zero boost', () => {
    expect(repetitionIntensityBoost(1)).toBe(0);
  });

  test('monotonicity: boost never decreases as repetition increases', () => {
    let prev = 0;

    for (let n = 2; n <= 20; n++) {
      const current = repetitionIntensityBoost(n);
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });

  test('diminishing returns: marginal gains decrease with repetition', () => {
    const b2 = repetitionIntensityBoost(2);
    const b3 = repetitionIntensityBoost(3);
    const b4 = repetitionIntensityBoost(4);
    const b5 = repetitionIntensityBoost(5);

    const d23 = b3 - b2;
    const d34 = b4 - b3;
    const d45 = b5 - b4;

    expect(d34).toBeLessThan(d23);
    expect(d45).toBeLessThan(d34);
  });

  test('saturation: gains after saturation threshold are minimal', () => {
    const five = repetitionIntensityBoost(5);
    const ten = repetitionIntensityBoost(10);
    const fifty = repetitionIntensityBoost(50);

    expect(ten - five).toBeLessThan(0.1);
    expect(fifty - ten).toBeLessThan(0.05);
  });

  test('boundedness: boost is always within allowed range', () => {
    for (let n = 1; n <= 200; n++) {
      const value = repetitionIntensityBoost(n);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0.4);
    }
  });

  test('semantic dominance preserved: repetition never dominates intensity', () => {
    const high = repetitionIntensityBoost(10);
    expect(high).toBeLessThan(0.35);
  });

  test('numerical stability: no NaN or Infinity across range', () => {
    for (let n = 1; n <= 200; n++) {
      const value = repetitionIntensityBoost(n);
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
