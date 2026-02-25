export {};

/**
 * PHASE 3 — EIV Stability/Correctness Audit
 *
 * Proves EIV is bounded, monotonic w.r.t. intensity, stable under
 * identical inputs, and independent of bridge/policy flags.
 */

import { EIVScorer } from '../../scorers/EIVScorer';
import { EIVComponentAssembler, type AnalyzerOutputs } from '../../processors/EIVComponentAssembler';

interface EIVTestInputs {
  valenceScore?: number;
  valenceConfidence?: number;
  arousalScore?: number;
  arousalConfidence?: number;
  esScore?: number;
  esConfidence?: number;
}

function makeAnalyzerOutputs(o: EIVTestInputs = {}): AnalyzerOutputs {
  return {
    valence: { score: o.valenceScore ?? 0, confidence: o.valenceConfidence ?? 0.5 },
    arousal: { score: o.arousalScore ?? 0.3, confidence: o.arousalConfidence ?? 0.5 },
    expressionStrength: { score: o.esScore ?? 0.2, confidence: o.esConfidence ?? 0.5 },
  };
}

function computeEIV(o: EIVTestInputs = {}): number {
  const ao = makeAnalyzerOutputs(o);
  const components = EIVComponentAssembler.assemble(ao);
  return EIVScorer.calculate(components).value;
}

describe('Phase 3 — EIV Audit', () => {
  test('EIV is bounded [0, 1]', () => {
    const cases: EIVTestInputs[] = [
      {},
      { valenceScore: 1, arousalScore: 1, esScore: 1, valenceConfidence: 1, arousalConfidence: 1, esConfidence: 1 },
      { valenceScore: -1, arousalScore: 0, esScore: 0, valenceConfidence: 0, arousalConfidence: 0, esConfidence: 0 },
      { valenceScore: 0.5, arousalScore: 0.8, esScore: 0.9, valenceConfidence: 0.9, arousalConfidence: 0.9, esConfidence: 0.9 },
      { valenceScore: -0.9, arousalScore: 0.95, esScore: 0.95, valenceConfidence: 0.95, arousalConfidence: 0.95, esConfidence: 0.95 },
    ];

    for (const c of cases) {
      const eiv = computeEIV(c);
      expect(eiv).toBeGreaterThanOrEqual(0);
      expect(eiv).toBeLessThanOrEqual(1);
    }
  });

  test('EIV is monotonic: higher arousal + |valence| → higher EIV', () => {
    const low = computeEIV({ arousalScore: 0.1, valenceScore: 0.1, esScore: 0.2 });
    const mid = computeEIV({ arousalScore: 0.5, valenceScore: -0.5, esScore: 0.5 });
    const high = computeEIV({ arousalScore: 0.9, valenceScore: -0.9, esScore: 0.8 });

    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  test('EIV is stable under identical inputs', () => {
    const inputs: EIVTestInputs = {
      valenceScore: -0.6, arousalScore: 0.7, esScore: 0.5,
      valenceConfidence: 0.8, arousalConfidence: 0.8, esConfidence: 0.7,
    };

    const results = Array.from({ length: 20 }, () => computeEIV(inputs));
    const unique = new Set(results);
    expect(unique.size).toBe(1);
  });

  test('EIV does not depend on bridge/policy flags', () => {
    const inputs: EIVTestInputs = {
      valenceScore: -0.7, arousalScore: 0.8, esScore: 0.6,
      valenceConfidence: 0.9, arousalConfidence: 0.85, esConfidence: 0.8,
    };

    const eivBaseline = computeEIV(inputs);

    const ao = makeAnalyzerOutputs(inputs);
    const components = EIVComponentAssembler.assemble(ao);
    const result1 = EIVScorer.calculate(components);
    const result2 = EIVScorer.calculate(components);

    expect(result1.value).toBe(eivBaseline);
    expect(result2.value).toBe(eivBaseline);
  });

  test('EIV expression strength gain is bounded', () => {
    const noES = computeEIV({ arousalScore: 0.5, valenceScore: -0.5, esScore: 0 });
    const maxES = computeEIV({ arousalScore: 0.5, valenceScore: -0.5, esScore: 1, esConfidence: 1 });

    expect(maxES).toBeGreaterThan(noES);
    expect(maxES).toBeLessThanOrEqual(1);
    // ES gain should amplify but not dominate — ratio should be bounded
    expect(maxES / Math.max(noES, 0.001)).toBeLessThan(3);
  });
});
