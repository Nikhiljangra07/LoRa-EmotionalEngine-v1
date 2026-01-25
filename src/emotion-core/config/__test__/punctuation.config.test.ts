import {
  BASE_WEIGHTS,
  PUNCTUATION_BASE_WEIGHTS,
  PUNCTUATION_DIMINISHING_POLICY,
  MAX_INTENSITY,
  AGGREGATION_STRATEGY,
} from '../punctuation.config';

describe('Punctuation Config — Policy Invariants', () => {
  test('base weights preserve emotional hierarchy', () => {
    expect(BASE_WEIGHTS.MIXED)
      .toBeGreaterThan(BASE_WEIGHTS.EXCLAMATION);

    expect(BASE_WEIGHTS.EXCLAMATION)
      .toBeGreaterThan(BASE_WEIGHTS.QUESTION);

    expect(BASE_WEIGHTS.QUESTION)
      .toBeGreaterThan(BASE_WEIGHTS.ELLIPSIS);
  });

  test('compatibility alias points to same base weights', () => {
    expect(PUNCTUATION_BASE_WEIGHTS)
      .toBe(BASE_WEIGHTS);
  });

  test('diminishing policy is bounded and sane', () => {
    expect(PUNCTUATION_DIMINISHING_POLICY.baseIncrement)
      .toBeGreaterThan(0);

    expect(PUNCTUATION_DIMINISHING_POLICY.maxContribution)
      .toBeLessThan(1);

    expect(PUNCTUATION_DIMINISHING_POLICY.maxEffectiveCount)
      .toBeGreaterThanOrEqual(3);
  });

  test('global intensity cap is normalized', () => {
    expect(MAX_INTENSITY).toBe(1.0);
  });

  test('aggregation strategy is explicitly MAX', () => {
    expect(AGGREGATION_STRATEGY).toBe('MAX');
  });
});
