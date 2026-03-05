import { computePolicy, computeBand } from '../policyMap';
import { toFullState } from '../betaUpdate';
import type { ETVStateStored, ETVStateDerived, ETVBand } from '../types';
import { ETV_CONFIG } from '../constants';

function makeFull(r: number, s: number): ETVStateDerived {
  return toFullState({
    userId: 'test',
    r,
    s,
    lastSessionEndedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

describe('computeBand', () => {
  test('thresholds map correctly', () => {
    expect(computeBand(-0.1)).toBe('BAND_0');
    expect(computeBand(0.0)).toBe('BAND_0');
    expect(computeBand(0.05)).toBe('BAND_0');
    expect(computeBand(0.06)).toBe('BAND_1');
    expect(computeBand(0.069)).toBe('BAND_1');
    expect(computeBand(0.07)).toBe('BAND_2');
    expect(computeBand(0.17)).toBe('BAND_2');
    expect(computeBand(0.18)).toBe('BAND_3');
    expect(computeBand(0.34)).toBe('BAND_3');
    expect(computeBand(0.35)).toBe('BAND_4');
    expect(computeBand(1.0)).toBe('BAND_4');
  });
});

describe('computePolicy', () => {
  test('cold-start state → BAND_0', () => {
    const state = makeFull(ETV_CONFIG.initR, ETV_CONFIG.initS);
    const policy = computePolicy(state);
    expect(policy.band).toBe('BAND_0');
  });

  test('boundedness — all knobs within declared ranges', () => {
    for (let i = 0; i < 5_000; i++) {
      const r = 0.01 + Math.random() * 100;
      const s = 0.01 + Math.random() * 100;
      const state = makeFull(r, s);
      const policy = computePolicy(state);

      expect(policy.maxInitiative).toBeGreaterThanOrEqual(0);
      expect(policy.maxInitiative).toBeLessThanOrEqual(1);
      expect(policy.maxDepth).toBeGreaterThanOrEqual(0);
      expect(policy.maxDepth).toBeLessThanOrEqual(1);
      expect(policy.assertiveness).toBeGreaterThanOrEqual(0);
      expect(policy.assertiveness).toBeLessThanOrEqual(1);
      expect(policy.personalizationStrength).toBeGreaterThanOrEqual(0);
      expect(policy.personalizationStrength).toBeLessThanOrEqual(1);
      expect(policy.clarificationBias).toBeGreaterThanOrEqual(0);
      expect(policy.clarificationBias).toBeLessThanOrEqual(1);
      expect(policy.maxResponseTokens).toBeGreaterThanOrEqual(120);
      expect(policy.maxResponseTokens).toBeLessThanOrEqual(520);
    }
  });

  test('monotonicity — higher riskAdjusted → higher initiative/depth', () => {
    const low = makeFull(2, 8); // mean ~0.20
    const high = makeFull(8, 2); // mean ~0.80
    const pLow = computePolicy(low);
    const pHigh = computePolicy(high);

    expect(pHigh.maxInitiative).toBeGreaterThanOrEqual(pLow.maxInitiative);
    expect(pHigh.maxDepth).toBeGreaterThanOrEqual(pLow.maxDepth);
    expect(pHigh.assertiveness).toBeGreaterThanOrEqual(pLow.assertiveness);
    expect(pHigh.personalizationStrength).toBeGreaterThanOrEqual(pLow.personalizationStrength);
  });

  test('INV-8 — higher riskAdjusted → lower clarificationBias', () => {
    const low = makeFull(2, 8);
    const high = makeFull(8, 2);
    expect(computePolicy(high).clarificationBias).toBeLessThanOrEqual(
      computePolicy(low).clarificationBias
    );
  });

  test('INV-9 — higher variance at same mean → lower assertiveness', () => {
    // Same mean (~0.5) but different evidence amounts
    const narrow = makeFull(50, 50); // high N → low variance
    const wide = makeFull(2, 2); // low N → high variance
    expect(computePolicy(wide).assertiveness).toBeLessThan(
      computePolicy(narrow).assertiveness
    );
  });

  test('INV-10 — under high uncertainty, assertiveness < 0.30', () => {
    // Very low evidence → very high variance → conf ≈ 0
    const state = makeFull(0.5, 0.5);
    const policy = computePolicy(state);
    const conf = Math.max(0, 1 - Math.sqrt(state.etvVar) * ETV_CONFIG.varianceConfidenceScale);
    if (conf < 0.3) {
      expect(policy.assertiveness).toBeLessThan(0.30);
    }
  });

  test('INV-13 — determinism: same inputs produce identical outputs', () => {
    const state = makeFull(7.3, 4.8);
    const p1 = computePolicy(state);
    const p2 = computePolicy(state);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });
});
