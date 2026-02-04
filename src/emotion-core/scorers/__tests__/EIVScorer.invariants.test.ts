import { EIVScorer } from '../EIVScorer';
import { EIVComponents } from '../../types/eiv.types';
import { getEIVTier } from '../eivTiers';

describe('EIVScorer — Architectural Invariants', () => {
  test('EIV is always within [0,1]', () => {
    const samples: EIVComponents[] = [
      { linguistic: 0, punctuation: 0, capitalization: 0, emoji: 0 },
      { linguistic: 1, punctuation: 1, capitalization: 1, emoji: 1 },
      { linguistic: 0.4, punctuation: 0.7, capitalization: 0.2, emoji: 0.1 },
    ];

    samples.forEach(c => {
      const { value } = EIVScorer.calculate(c);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });

  test('invalid components throw (NaN / Infinity / out-of-bounds)', () => {
    const bad: EIVComponents[] = [
      { linguistic: NaN, punctuation: 0, capitalization: 0, emoji: 0 },
      { linguistic: Infinity, punctuation: 0, capitalization: 0, emoji: 0 },
      { linguistic: -0.1, punctuation: 0, capitalization: 0, emoji: 0 },
      { linguistic: 1.1, punctuation: 0, capitalization: 0, emoji: 0 },
    ];

    bad.forEach(c =>
      expect(() => EIVScorer.calculate(c)).toThrow()
    );
  });

  test('tier comes from getEIVTier only (SSoT)', () => {
    const c: EIVComponents = {
      linguistic: 0.5,
      punctuation: 0.5,
      capitalization: 0.5,
      emoji: 0.5,
    };

    const result = EIVScorer.calculate(c);
    expect(result.breakdown.tier).toBe(getEIVTier(result.value));
  });
});
