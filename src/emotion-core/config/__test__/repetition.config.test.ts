import { REPETITION_CONFIG } from '../repetition.config';

describe('Repetition Config — Policy Invariants', () => {
  test('configuration surface is complete', () => {
    expect(REPETITION_CONFIG).toHaveProperty('BASE_INCREMENT');
    expect(REPETITION_CONFIG).toHaveProperty('MAX_CONTRIBUTION');
    expect(REPETITION_CONFIG).toHaveProperty('DIMINISHING_MODE');
    expect(REPETITION_CONFIG).toHaveProperty('DECAY_FACTOR');
    expect(REPETITION_CONFIG).toHaveProperty('MAX_EFFECTIVE_COUNT');
    expect(REPETITION_CONFIG).toHaveProperty('CONFIDENCE_PROFILE');
  });

  test('base increment is within defensible perceptual range', () => {
    expect(REPETITION_CONFIG.BASE_INCREMENT)
      .toBeGreaterThanOrEqual(0.06);

    expect(REPETITION_CONFIG.BASE_INCREMENT)
      .toBeLessThanOrEqual(0.10);
  });

  test('maximum contribution is bounded and non-dominant', () => {
    expect(REPETITION_CONFIG.MAX_CONTRIBUTION)
      .toBeGreaterThan(0);

    expect(REPETITION_CONFIG.MAX_CONTRIBUTION)
      .toBeLessThanOrEqual(0.3);
  });

  test('diminishing mode is logarithmic by declared policy', () => {
    expect(REPETITION_CONFIG.DIMINISHING_MODE)
      .toBe('logarithmic');
  });

  test('saturation threshold matches human perceptual limits', () => {
    expect(REPETITION_CONFIG.MAX_EFFECTIVE_COUNT)
      .toBeGreaterThanOrEqual(4);

    expect(REPETITION_CONFIG.MAX_EFFECTIVE_COUNT)
      .toBeLessThanOrEqual(7);
  });

  test('confidence profile reflects rise then decay pattern', () => {
    const { SINGLE, FEW, EXCESSIVE } =
      REPETITION_CONFIG.CONFIDENCE_PROFILE;

    expect(FEW).toBeGreaterThan(SINGLE);
    expect(EXCESSIVE).toBeLessThan(FEW);
  });
});
