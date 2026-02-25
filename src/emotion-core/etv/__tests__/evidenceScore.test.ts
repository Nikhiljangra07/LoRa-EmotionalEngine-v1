import { computeEvidenceScore } from '../evidenceScore';
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

  test('violation alone → z_t = 0.70', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 0,
      aviMax: 0,
      hasViolation: true,
    }));
    expect(z).toBeCloseTo(0.70, 2);
  });

  test('moderate AVI, no violation → z_t ≈ 0.625', () => {
    const z = computeEvidenceScore(makeSummary({
      aviMean: 0.5,
      aviMax: 0.7,
      hasViolation: false,
    }));
    // stability = 1 - 0.40*0.5 - 0.25*0.7 = 1 - 0.2 - 0.175 = 0.625
    expect(z).toBeCloseTo(0.625, 3);
  });

  test('boundedness — z_t in [0, 1] for 5k random summaries', () => {
    for (let i = 0; i < 5_000; i++) {
      const z = computeEvidenceScore(makeSummary({
        aviMean: Math.random(),
        aviMax: Math.random(),
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
});
