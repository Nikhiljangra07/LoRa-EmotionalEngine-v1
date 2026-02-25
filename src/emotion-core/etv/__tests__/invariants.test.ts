/**
 * Runtime invariant tests:
 * - Force extreme z values, ensure no NaN, no negative variance.
 * - Invariant utility correctly throws in dev.
 */

import { etvInvariant, assertStoredValid, assertDerivedValid, assertPolicyValid } from '../invariants';
import { computeDerived, applyDecay, applyEvidence, toFullState } from '../betaUpdate';
import { computePolicy, computeRiskAdjusted, computeConf } from '../policyMap';
import { ETV_CONFIG } from '../constants';
import type { ETVStateStored } from '../types';

describe('etvInvariant utility', () => {
  test('does not throw when condition is true', () => {
    expect(() => etvInvariant(true, 'should not throw')).not.toThrow();
  });

  test('throws when condition is false (dev mode)', () => {
    expect(() => etvInvariant(false, 'test violation')).toThrow(
      '[ETV Invariant Violation] test violation',
    );
  });
});

describe('assertStoredValid', () => {
  test('passes for valid r, s', () => {
    expect(() => assertStoredValid(1.5, 2.5)).not.toThrow();
  });

  test('throws for r = 0', () => {
    expect(() => assertStoredValid(0, 2.5)).toThrow();
  });

  test('throws for negative s', () => {
    expect(() => assertStoredValid(1.5, -1)).toThrow();
  });
});

describe('assertDerivedValid', () => {
  test('passes for valid mean and variance', () => {
    expect(() => assertDerivedValid(0.5, 0.02)).not.toThrow();
  });

  test('throws for mean > 1', () => {
    expect(() => assertDerivedValid(1.1, 0.02)).toThrow();
  });

  test('throws for negative variance', () => {
    expect(() => assertDerivedValid(0.5, -0.01)).toThrow();
  });

  test('throws for NaN mean', () => {
    expect(() => assertDerivedValid(NaN, 0.02)).toThrow();
  });
});

describe('assertPolicyValid', () => {
  test('passes for in-range values', () => {
    expect(() => assertPolicyValid(0.5, 0.8)).not.toThrow();
  });

  test('boundary: 0 and 1 are valid', () => {
    expect(() => assertPolicyValid(0, 1)).not.toThrow();
    expect(() => assertPolicyValid(1, 0)).not.toThrow();
  });
});

describe('invariants integrated with computeDerived', () => {
  test('extreme but valid pseudo-counts do not violate invariants', () => {
    expect(() => computeDerived(0.01, 0.01)).not.toThrow();
    expect(() => computeDerived(1000, 1000)).not.toThrow();
    expect(() => computeDerived(0.01, 1000)).not.toThrow();
    expect(() => computeDerived(1000, 0.01)).not.toThrow();
  });

  test('derived values are always well-formed for random inputs', () => {
    for (let i = 0; i < 1_000; i++) {
      const r = 0.01 + Math.random() * 100;
      const s = 0.01 + Math.random() * 100;
      const d = computeDerived(r, s);
      expect(d.etvMean).toBeGreaterThanOrEqual(0);
      expect(d.etvMean).toBeLessThanOrEqual(1);
      expect(d.etvVar).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(d.etvMean)).toBe(true);
      expect(Number.isFinite(d.etvVar)).toBe(true);
    }
  });
});

describe('invariants hold after full pipeline', () => {
  function makeState(r: number, s: number): ETVStateStored {
    return {
      userId: 'inv_test',
      r,
      s,
      lastSessionEndedAt: Date.now() - 3_600_000,
      updatedAt: Date.now() - 3_600_000,
    };
  }

  test('decay + evidence + derive + policy — no violations for extreme inputs', () => {
    const extremeCases = [
      { r: 0.01, s: 0.01, z: 0, hours: 0 },
      { r: 0.01, s: 0.01, z: 1, hours: 0 },
      { r: 100, s: 100, z: 0.5, hours: 0 },
      { r: 0.01, s: 100, z: 1, hours: 336 }, // 14 days
      { r: 100, s: 0.01, z: 0, hours: 336 },
      { r: 0.01, s: 0.01, z: 0, hours: 8760 }, // 1 year
    ];

    for (const { r, s, z, hours } of extremeCases) {
      const st = makeState(r, s);
      const { state: decayed } = applyDecay(st, hours);
      const updated = applyEvidence(decayed, z, 1.0);
      const full = toFullState(updated);
      const policy = computePolicy(full);
      const ra = computeRiskAdjusted(full);
      const conf = computeConf(full);

      expect(full.etvMean).toBeGreaterThanOrEqual(0);
      expect(full.etvMean).toBeLessThanOrEqual(1);
      expect(full.etvVar).toBeGreaterThanOrEqual(0);
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThanOrEqual(1);
      expect(conf).toBeGreaterThanOrEqual(0);
      expect(conf).toBeLessThanOrEqual(1);
      expect(Number.isNaN(full.etvMean)).toBe(false);
      expect(Number.isNaN(full.etvVar)).toBe(false);
      expect(Number.isNaN(ra)).toBe(false);
      expect(policy.band).toBeDefined();
    }
  });
});
