import { computeEvidenceScore } from '../evidenceScore';
import { ETV_EIV_RISK } from '../constants';
import type { SessionSummaryV1 } from '../types';

function makeSummary(overrides: Partial<SessionSummaryV1> = {}): SessionSummaryV1 {
  return {
    sessionId: 'test-session',
    userId: 'test-user',
    startedAt: 1000,
    endedAt: 2000,
    messageCount: 10,
    eivMean: 0.5,
    eivMax: 0.7,
    aviMean: 0,
    aviMax: 0,
    hasViolation: false,
    ...overrides,
  };
}

describe('computeEvidenceScore', () => {
  test('perfect session → z_t = 1.0', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 0,
      aviMax: 0,
      eivMean: 0.3,
      hasViolation: false,
    }));
    expect(z).toBe(1.0);
  });

  test('worst session → z_t near 0', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 1,
      aviMax: 1,
      hasViolation: true,
    }));
    expect(z).toBeGreaterThanOrEqual(0);
    expect(z).toBeLessThanOrEqual(0.10);
  });

  test('violation alone → z_t = 0.70 (eivMean below risk start)', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 0,
      aviMax: 0,
      eivMean: 0.3,
      hasViolation: true,
    }));
    expect(z).toBeCloseTo(0.70, 2);
  });

  test('moderate AVI, no violation, low eivMean → z_t ≈ 0.625', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 0.5,
      aviMax: 0.7,
      eivMean: 0.3,
      hasViolation: false,
    }));
    // stability = 1 - 0.40*0.5 - 0.25*0.7 = 0.625, eivRisk = 0
    expect(z).toBeCloseTo(0.625, 3);
  });

  test('boundedness — z_t in [0, 1] for 5k random summaries', () => {
    for (let i = 0; i < 5_000; i++) {
      const z = computeEvidenceScore(makeSummary({
        aviMean: Math.random(),
        aviMax: Math.random(),
        eivMean: Math.random(),
        hasViolation: Math.random() > 0.5,
      }));
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(1);
    }
  });

  test('NaN inputs → fallback to 0.5', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: NaN,
      aviMax: 0,
      hasViolation: false,
    }));
    expect(z).toBe(0.5);
  });

  // ── V1 eivRisk term tests ──

  test('eivRisk: eivMean below threshold → no penalty', () => {
    // Use eivMean well below the threshold (0.45) to verify no penalty
    const zLow = computeEvidenceScore(makeSummary({
      aviMean: 0, aviMax: 0, eivMean: 0.3, hasViolation: false,
    }));
    const zAtThreshold = computeEvidenceScore(makeSummary({
      aviMean: 0, aviMax: 0, eivMean: ETV_EIV_RISK.startThreshold, hasViolation: false,
    }));
    expect(zLow).toBe(1.0);
    expect(zAtThreshold).toBe(1.0);
  });

  test('eivRisk: eivMean=1.0 → max penalty (0.20)', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 0, aviMax: 0, eivMean: 1.0, hasViolation: false,
    }));
    // stability=1, safetyPenalty=0, eivRisk=0.20*1.0=0.20
    expect(z).toBeCloseTo(0.80, 4);
  });

  test('eivRisk: eivMean=0.85 → penalty above threshold (T=0.45)', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 0, aviMax: 0, eivMean: 0.85, hasViolation: false,
    }));
    // eivRisk = 0.20 * (0.85 - 0.45) / (1 - 0.45) = 0.20 * (0.40/0.55) ≈ 0.20 * 0.7273 ≈ 0.1455
    // z ≈ 1.0 - 0.1455 ≈ 0.8545
    expect(z).toBeCloseTo(1 - 0.20 * (0.85 - ETV_EIV_RISK.startThreshold) / (1 - ETV_EIV_RISK.startThreshold), 4);
  });

  test('eivRisk: monotonicity — higher eivMean → lower z_t', () => {
    const z1 = computeEvidenceScore(makeSummary({ eivMean: 0.75, aviMean: 0, aviMax: 0 }));
    const z2 = computeEvidenceScore(makeSummary({ eivMean: 0.85, aviMean: 0, aviMax: 0 }));
    const z3 = computeEvidenceScore(makeSummary({ eivMean: 0.95, aviMean: 0, aviMax: 0 }));
    expect(z1).toBeGreaterThan(z2);
    expect(z2).toBeGreaterThan(z3);
  });

  test('eivRisk + violation: both penalties stack', () => {
    const zViolationOnly = computeEvidenceScore(makeSummary({
      aviMean: 0, aviMax: 0, eivMean: 0.3, hasViolation: true,
    }));
    const zBoth = computeEvidenceScore(makeSummary({
      aviMean: 0, aviMax: 0, eivMean: 1.0, hasViolation: true,
    }));
    expect(zBoth).toBeLessThan(zViolationOnly);
  });

  test('monotonicity: higher aviMean → lower z_t', () => {
    const z1 = computeEvidenceScore(makeSummary({ aviMean: 0.1, aviMax: 0, eivMean: 0.3 }));
    const z2 = computeEvidenceScore(makeSummary({ aviMean: 0.5, aviMax: 0, eivMean: 0.3 }));
    const z3 = computeEvidenceScore(makeSummary({ aviMean: 0.9, aviMax: 0, eivMean: 0.3 }));
    expect(z1).toBeGreaterThan(z2);
    expect(z2).toBeGreaterThan(z3);
  });
});
