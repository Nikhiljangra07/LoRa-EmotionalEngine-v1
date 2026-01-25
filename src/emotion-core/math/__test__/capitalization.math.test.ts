import { computeCapitalizationEIV } from '../capitalization.math';
import { AnalyzerSignal } from '../../types/analysis.types';

function capsSignal(value = 0.18): AnalyzerSignal {
  return {
    type: 'capitalization',
    value,
    position: 'mid',
    weightSource: 'ALL_CAPS',
    confidence: 0,
    metadata: {},
  };
}

describe('Capitalization Math — Intensity', () => {
  test('returns zero intensity when no signals present', () => {
    const res = computeCapitalizationEIV([]);
    expect(res.intensity).toBe(0);
    expect(res.confidence).toBe(1);
  });

  test('single ALL-CAPS token produces VADER-aligned intensity', () => {
    const res = computeCapitalizationEIV([capsSignal()]);
    expect(res.intensity).toBeCloseTo(0.18, 2);
  });

  test('intensity increases linearly with caps count', () => {
    const one = computeCapitalizationEIV([capsSignal()]).intensity;
    const three = computeCapitalizationEIV([
      capsSignal(),
      capsSignal(),
      capsSignal(),
    ]).intensity;

    expect(three).toBeGreaterThan(one);
  });

  test('intensity is clamped at 1.0', () => {
    const manyCaps = Array.from({ length: 20 }, () =>
      capsSignal()
    );
    const res = computeCapitalizationEIV(manyCaps);
    expect(res.intensity).toBeLessThanOrEqual(1.0);
  });
});

describe('Capitalization Math — Confidence', () => {
  test('single caps token has lower confidence (ambiguity)', () => {
    const res = computeCapitalizationEIV([capsSignal()]);
    expect(res.confidence).toBeLessThan(0.7);
  });

  test('multiple caps tokens raise confidence', () => {
    const res = computeCapitalizationEIV([
      capsSignal(),
      capsSignal(),
    ]);
    expect(res.confidence).toBeGreaterThan(0.7);
  });

  test('overuse reduces confidence', () => {
    const manyCaps = Array.from({ length: 8 }, () =>
      capsSignal()
    );
    const res = computeCapitalizationEIV(manyCaps);
    expect(res.confidence).toBeLessThan(0.7);
  });

  test('high density metadata penalizes confidence', () => {
    const res = computeCapitalizationEIV(
      [capsSignal(), capsSignal(), capsSignal()],
      {
        tokenCount: 5,
        capsCount: 3,
        density: 0.6,
      }
    );

    expect(res.confidence).toBeLessThan(0.7);
  });
});
