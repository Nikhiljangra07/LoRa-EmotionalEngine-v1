export {};

import {
  mapLayerASnapshot,
  sanitize01,
  sanitize11,
  sanitizeDelta,
} from '../mapLayerASnapshot';
import { AppraisalBridgeRunner } from '../AppraisalBridgeRunner';

// ─── Helpers ─────────────────────────────────────────────────────────

const POISON_VALUES = [NaN, Infinity, -Infinity];

function baseArgs() {
  return {
    messageIndex: 1,
    timestampMs: 1000,
    deltaMessageSeconds: 0,
    analyzerScalars: {
      valenceScore: 0,
      valenceConfidence: 0.5,
      arousalScore: 0.3,
      arousalConfidence: 0.5,
      expressionStrength: 0.2,
      esConfidence: 0.5,
    },
    eiv: { value: 0.3, tier: 'minimal' },
    emotionalState: {
      dominant: 'NEUTRAL' as const,
      arousal: 'LOW' as const,
      valence: 'NEUTRAL' as const,
      confidence: 0.5,
    },
  };
}

// ─── sanitize helpers ────────────────────────────────────────────────

describe('sanitize01', () => {
  it('clamps values to [0, 1]', () => {
    expect(sanitize01(-0.5)).toBe(0);
    expect(sanitize01(0)).toBe(0);
    expect(sanitize01(0.5)).toBe(0.5);
    expect(sanitize01(1)).toBe(1);
    expect(sanitize01(1.5)).toBe(1);
  });

  it.each(POISON_VALUES)('maps %s to 0', (v) => {
    expect(sanitize01(v)).toBe(0);
  });
});

describe('sanitize11', () => {
  it('clamps values to [-1, 1]', () => {
    expect(sanitize11(-2)).toBe(-1);
    expect(sanitize11(-0.5)).toBe(-0.5);
    expect(sanitize11(0)).toBe(0);
    expect(sanitize11(0.7)).toBe(0.7);
    expect(sanitize11(3)).toBe(1);
  });

  it.each(POISON_VALUES)('maps %s to 0', (v) => {
    expect(sanitize11(v)).toBe(0);
  });
});

describe('sanitizeDelta', () => {
  it('clamps to [0, 86400]', () => {
    expect(sanitizeDelta(-10)).toBe(0);
    expect(sanitizeDelta(0)).toBe(0);
    expect(sanitizeDelta(60)).toBe(60);
    expect(sanitizeDelta(100_000)).toBe(86_400);
  });

  it.each(POISON_VALUES)('maps %s to 0', (v) => {
    expect(sanitizeDelta(v)).toBe(0);
  });
});

// ─── mapLayerASnapshot NaN injection ─────────────────────────────────

describe('mapLayerASnapshot boundary sanitization', () => {
  it('produces finite, bounded output when all scalars are NaN', () => {
    const snapshot = mapLayerASnapshot({
      ...baseArgs(),
      deltaMessageSeconds: NaN,
      analyzerScalars: {
        valenceScore: NaN,
        valenceConfidence: NaN,
        arousalScore: NaN,
        arousalConfidence: NaN,
        expressionStrength: NaN,
        esConfidence: NaN,
      },
      eiv: { value: NaN, tier: 'minimal' },
    });

    expect(Number.isFinite(snapshot.deltaMessageSeconds)).toBe(true);
    expect(Number.isFinite(snapshot.valenceScore)).toBe(true);
    expect(Number.isFinite(snapshot.valenceConfidence)).toBe(true);
    expect(Number.isFinite(snapshot.arousalScore)).toBe(true);
    expect(Number.isFinite(snapshot.arousalConfidence)).toBe(true);
    expect(Number.isFinite(snapshot.expressionStrength)).toBe(true);
    expect(Number.isFinite(snapshot.esConfidence)).toBe(true);
    expect(Number.isFinite(snapshot.eivValue)).toBe(true);

    expect(snapshot.deltaMessageSeconds).toBe(0);
    expect(snapshot.valenceScore).toBe(0);
    expect(snapshot.eivValue).toBe(0);
  });

  it('produces finite, bounded output when all scalars are Infinity', () => {
    const snapshot = mapLayerASnapshot({
      ...baseArgs(),
      deltaMessageSeconds: Infinity,
      analyzerScalars: {
        valenceScore: Infinity,
        valenceConfidence: Infinity,
        arousalScore: Infinity,
        arousalConfidence: Infinity,
        expressionStrength: Infinity,
        esConfidence: Infinity,
      },
      eiv: { value: Infinity, tier: 'minimal' },
    });

    // Non-finite values all collapse to 0 (the safe default)
    expect(snapshot.deltaMessageSeconds).toBe(0);
    expect(snapshot.valenceScore).toBe(0);
    expect(snapshot.valenceConfidence).toBe(0);
    expect(snapshot.arousalScore).toBe(0);
    expect(snapshot.arousalConfidence).toBe(0);
    expect(snapshot.expressionStrength).toBe(0);
    expect(snapshot.esConfidence).toBe(0);
    expect(snapshot.eivValue).toBe(0);
  });

  it('produces finite, bounded output when all scalars are -Infinity', () => {
    const snapshot = mapLayerASnapshot({
      ...baseArgs(),
      deltaMessageSeconds: -Infinity,
      analyzerScalars: {
        valenceScore: -Infinity,
        valenceConfidence: -Infinity,
        arousalScore: -Infinity,
        arousalConfidence: -Infinity,
        expressionStrength: -Infinity,
        esConfidence: -Infinity,
      },
      eiv: { value: -Infinity, tier: 'minimal' },
    });

    expect(snapshot.deltaMessageSeconds).toBe(0);
    expect(snapshot.valenceScore).toBe(0);
    expect(snapshot.valenceConfidence).toBe(0);
    expect(snapshot.arousalScore).toBe(0);
    expect(snapshot.eivValue).toBe(0);
  });

  it('sanitizes patternSignals when present', () => {
    const snapshot = mapLayerASnapshot({
      ...baseArgs(),
      patternSignals: {
        capsRatio: NaN,
        punctuationHits: Infinity,
        emojiHits: -Infinity,
        repetitionScore: NaN,
        questionMarks: NaN,
      },
    });

    expect(snapshot.patternSignals).toBeDefined();
    const ps = snapshot.patternSignals!;
    expect(Number.isFinite(ps.capsRatio)).toBe(true);
    expect(Number.isFinite(ps.punctuationHits)).toBe(true);
    expect(Number.isFinite(ps.emojiHits)).toBe(true);
    expect(Number.isFinite(ps.repetitionScore)).toBe(true);
    expect(Number.isFinite(ps.questionMarks)).toBe(true);

    expect(ps.capsRatio).toBe(0);
    expect(ps.punctuationHits).toBe(0);
    expect(ps.emojiHits).toBe(0);
    expect(ps.repetitionScore).toBe(0);
    expect(ps.questionMarks).toBe(0);
  });

  it('preserves valid values without distortion', () => {
    const snapshot = mapLayerASnapshot({
      ...baseArgs(),
      deltaMessageSeconds: 5.5,
      analyzerScalars: {
        valenceScore: -0.3,
        valenceConfidence: 0.8,
        arousalScore: 0.4,
        arousalConfidence: 0.7,
        expressionStrength: 0.6,
        esConfidence: 0.9,
      },
      eiv: { value: 0.45, tier: 'moderate' },
    });

    expect(snapshot.deltaMessageSeconds).toBe(5.5);
    expect(snapshot.valenceScore).toBe(-0.3);
    expect(snapshot.valenceConfidence).toBe(0.8);
    expect(snapshot.arousalScore).toBe(0.4);
    expect(snapshot.arousalConfidence).toBe(0.7);
    expect(snapshot.expressionStrength).toBe(0.6);
    expect(snapshot.esConfidence).toBe(0.9);
    expect(snapshot.eivValue).toBe(0.45);
  });
});

// ─── Runner finite output stress test ────────────────────────────────

describe('AppraisalBridgeRunner finite output bounds', () => {
  it('produces finite, bounded outputs across 50 adversarial steps', () => {
    const runner = new AppraisalBridgeRunner();

    const adversarialInputs = [
      { v: 0, a: 0, es: 0, eiv: 0, delta: 0 },
      { v: NaN, a: NaN, es: NaN, eiv: NaN, delta: NaN },
      { v: Infinity, a: Infinity, es: Infinity, eiv: Infinity, delta: Infinity },
      { v: -Infinity, a: -Infinity, es: -Infinity, eiv: -Infinity, delta: -Infinity },
      { v: -1, a: 1, es: 1, eiv: 1, delta: 0 },
      { v: 1, a: 0, es: 0, eiv: 0, delta: 100_000 },
      { v: -0.99, a: 0.99, es: 0.99, eiv: 0.99, delta: 0.001 },
      { v: 0.5, a: 0.5, es: 0.5, eiv: 0.5, delta: 30 },
    ];

    for (let i = 0; i < 50; i++) {
      const input = adversarialInputs[i % adversarialInputs.length];
      const snapshot = mapLayerASnapshot({
        messageIndex: i + 1,
        timestampMs: 1000 + i * 1000,
        deltaMessageSeconds: input.delta,
        analyzerScalars: {
          valenceScore: input.v,
          valenceConfidence: 0.8,
          arousalScore: input.a,
          arousalConfidence: 0.8,
          expressionStrength: input.es,
          esConfidence: 0.8,
        },
        eiv: { value: input.eiv, tier: 'test' },
        emotionalState: {
          dominant: 'NEUTRAL',
          arousal: 'MEDIUM',
          valence: 'NEUTRAL',
          confidence: 0.5,
        },
      });

      const result = runner.step(snapshot);

      // Pressure bounds
      expect(Number.isFinite(result.pressure.scalar)).toBe(true);
      expect(result.pressure.scalar).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.pressure.slope)).toBe(true);
      expect(Number.isFinite(result.pressure.volatility)).toBe(true);
      expect(result.pressure.volatility).toBeGreaterThanOrEqual(0);

      // Escalation bounds
      expect(Number.isFinite(result.escalation.score)).toBe(true);
      expect(result.escalation.score).toBeGreaterThanOrEqual(0);
      expect(result.escalation.score).toBeLessThanOrEqual(1);

      // Intervention level is one of 0|1|2|3
      expect([0, 1, 2, 3]).toContain(result.intervention.interruptionLevel);

      // Mood confidence is finite
      expect(Number.isFinite(result.mood.confidence)).toBe(true);

      // Collapse severity is finite and non-negative
      expect(Number.isFinite(result.collapse.severity)).toBe(true);
      expect(result.collapse.severity).toBeGreaterThanOrEqual(0);
    }
  });
});
