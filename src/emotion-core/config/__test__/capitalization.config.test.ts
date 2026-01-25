import { CAPITALIZATION_CONFIG } from '../capitalization.config';

describe('CAPITALIZATION_CONFIG — Policy Invariants', () => {
  test('base caps weight matches VADER-derived range', () => {
    expect(CAPITALIZATION_CONFIG.BASE_WEIGHT)
      .toBeGreaterThanOrEqual(0.16);
    expect(CAPITALIZATION_CONFIG.BASE_WEIGHT)
      .toBeLessThanOrEqual(0.20);
  });

  test('max contribution prevents domination of EIV', () => {
    expect(CAPITALIZATION_CONFIG.MAX_CONTRIBUTION)
      .toBeGreaterThan(0);
    expect(CAPITALIZATION_CONFIG.MAX_CONTRIBUTION)
      .toBeLessThanOrEqual(0.4);
  });

  test('partial capitalization is weaker than full caps', () => {
    expect(CAPITALIZATION_CONFIG.PARTIAL_MULTIPLIER)
      .toBeGreaterThan(0);
    expect(CAPITALIZATION_CONFIG.PARTIAL_MULTIPLIER)
      .toBeLessThan(1);
  });

  test('minimum token length avoids acronym noise', () => {
    expect(CAPITALIZATION_CONFIG.MIN_TOKEN_LENGTH)
      .toBeGreaterThanOrEqual(2);
  });

  test('confidence boost is conservative', () => {
    expect(CAPITALIZATION_CONFIG.CONFIDENCE_BOOST)
      .toBeGreaterThan(0);
    expect(CAPITALIZATION_CONFIG.CONFIDENCE_BOOST)
      .toBeLessThanOrEqual(0.2);
  });
});
