import { EMOJI_CONFIG } from '../emoji.config';

describe('EMOJI_CONFIG — Policy Invariants', () => {
  test('base increment is within empirically supported range', () => {
    expect(EMOJI_CONFIG.BASE_INCREMENT).toBeGreaterThanOrEqual(0.08);
    expect(EMOJI_CONFIG.BASE_INCREMENT).toBeLessThanOrEqual(0.25);
  });

  test('max contribution is bounded and conservative', () => {
    expect(EMOJI_CONFIG.MAX_CONTRIBUTION).toBeGreaterThan(0);
    expect(EMOJI_CONFIG.MAX_CONTRIBUTION).toBeLessThanOrEqual(0.5);
  });

  test('diminishing returns configuration is valid', () => {
    const d = EMOJI_CONFIG.DIMINISHING;

    expect(['linear', 'capped-linear', 'logarithmic', 'power']).toContain(
      d.mode
    );

    if (d.mode === 'power') {
      expect(d.decayFactor).toBeGreaterThan(0);
      expect(d.decayFactor).toBeLessThan(1);
    }

    if (d.maxEffectiveCount !== undefined) {
      expect(d.maxEffectiveCount).toBeGreaterThan(0);
      expect(d.maxEffectiveCount).toBeLessThanOrEqual(10);
    }
  });

  test('confidence penalties obey collapse logic', () => {
    expect(EMOJI_CONFIG.CONFIDENCE.BASE)
      .toBeGreaterThan(EMOJI_CONFIG.CONFIDENCE.OVERUSE_PENALTY);
  });
});
