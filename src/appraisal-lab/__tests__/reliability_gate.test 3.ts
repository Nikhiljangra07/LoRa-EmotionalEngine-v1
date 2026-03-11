/**
 * Tests for the reliability gating layer.
 *
 * Uses small hand-crafted posteriors — no filesystem, no model dependency.
 */

import {
  applyReliabilityGate,
  ReliabilityResult,
} from '../model/reliability_gate';

// ============================================================
// Helper: build a 6-class posterior from a partial spec
// ============================================================

const LABELS = ['JOY', 'ANGER', 'FEAR', 'SADNESS', 'DISGUST', 'SURPRISE'];

function makePosterior(overrides: Record<string, number>): Record<string, number> {
  const total = Object.values(overrides).reduce((s, v) => s + v, 0);
  const remaining = 1 - total;
  const unset = LABELS.filter(l => !(l in overrides));
  const each = unset.length > 0 ? remaining / unset.length : 0;

  const posterior: Record<string, number> = {};
  for (const l of LABELS) {
    posterior[l] = overrides[l] ?? each;
  }
  return posterior;
}

function uniform(): Record<string, number> {
  const p = 1 / LABELS.length;
  const posterior: Record<string, number> = {};
  for (const l of LABELS) posterior[l] = p;
  return posterior;
}

// ============================================================
// TEST 1 — Strong commit case
// ============================================================

describe('Strong commit case', () => {
  const posterior = makePosterior({ ANGER: 0.75, FEAR: 0.10 });
  let result: ReliabilityResult;

  beforeAll(() => {
    result = applyReliabilityGate(posterior);
  });

  it('decision is COMMIT', () => {
    expect(result.decision).toBe('COMMIT');
  });

  it('pmax equals the dominant class', () => {
    expect(result.pmax).toBeCloseTo(0.75, 4);
  });

  it('margin is large', () => {
    expect(result.margin).toBeGreaterThanOrEqual(0.15);
  });

  it('entropyNorm is below hedge threshold', () => {
    expect(result.entropyNorm).toBeLessThan(0.80);
  });
});

// ============================================================
// TEST 2 — High entropy (uniform) → NEUTRAL
// ============================================================

describe('High entropy case — uniform distribution', () => {
  const posterior = uniform();
  let result: ReliabilityResult;

  beforeAll(() => {
    result = applyReliabilityGate(posterior);
  });

  it('decision is NEUTRAL', () => {
    expect(result.decision).toBe('NEUTRAL');
  });

  it('entropyNorm is approximately 1', () => {
    expect(result.entropyNorm).toBeCloseTo(1.0, 4);
  });

  it('margin is approximately 0', () => {
    expect(result.margin).toBeCloseTo(0, 4);
  });
});

// ============================================================
// TEST 3 — Small margin → HEDGE
// ============================================================

describe('Small margin case', () => {
  const posterior = makePosterior({ ANGER: 0.42, FEAR: 0.40 });
  let result: ReliabilityResult;

  beforeAll(() => {
    result = applyReliabilityGate(posterior);
  });

  it('decision is HEDGE', () => {
    expect(result.decision).toBe('HEDGE');
  });

  it('margin is small', () => {
    expect(result.margin).toBeLessThan(0.15);
  });
});

// ============================================================
// TEST 4 — Slightly-off sum (0.999999) still works
// ============================================================

describe('Posterior sum slightly off', () => {
  it('does not throw on sum ≈ 0.999999', () => {
    const posterior: Record<string, number> = {
      JOY: 0.70, ANGER: 0.10, FEAR: 0.05,
      SADNESS: 0.05, DISGUST: 0.049999, SURPRISE: 0.050001,
    };
    expect(() => applyReliabilityGate(posterior)).not.toThrow();
  });

  it('returns a valid decision', () => {
    const posterior: Record<string, number> = {
      JOY: 0.70, ANGER: 0.10, FEAR: 0.05,
      SADNESS: 0.05, DISGUST: 0.049999, SURPRISE: 0.050001,
    };
    const r = applyReliabilityGate(posterior);
    expect(['COMMIT', 'HEDGE', 'NEUTRAL']).toContain(r.decision);
  });
});

// ============================================================
// TEST 5 — No NaN or Infinity from entropy
// ============================================================

describe('No NaN or Infinity', () => {
  it('strong posterior produces finite entropy', () => {
    const r = applyReliabilityGate(makePosterior({ ANGER: 0.90 }));
    expect(Number.isFinite(r.entropy)).toBe(true);
    expect(Number.isFinite(r.entropyNorm)).toBe(true);
    expect(Number.isNaN(r.entropy)).toBe(false);
    expect(Number.isNaN(r.entropyNorm)).toBe(false);
  });

  it('uniform posterior produces finite entropy', () => {
    const r = applyReliabilityGate(uniform());
    expect(Number.isFinite(r.entropy)).toBe(true);
    expect(Number.isFinite(r.entropyNorm)).toBe(true);
  });

  it('near-degenerate posterior produces finite entropy', () => {
    const posterior: Record<string, number> = {
      JOY: 0.9999, ANGER: 0.00002, FEAR: 0.00002,
      SADNESS: 0.00002, DISGUST: 0.00002, SURPRISE: 0.00002,
    };
    const r = applyReliabilityGate(posterior);
    expect(Number.isFinite(r.entropy)).toBe(true);
    expect(Number.isFinite(r.entropyNorm)).toBe(true);
  });
});

// ============================================================
// TEST 6 — Deterministic stability
// ============================================================

describe('Deterministic stability', () => {
  it('same input twice produces identical result', () => {
    const posterior = makePosterior({ FEAR: 0.55, ANGER: 0.30 });
    const r1 = applyReliabilityGate(posterior);
    const r2 = applyReliabilityGate(posterior);
    expect(r1).toEqual(r2);
  });
});
