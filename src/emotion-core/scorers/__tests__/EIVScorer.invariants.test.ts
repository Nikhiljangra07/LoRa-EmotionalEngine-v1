import { buildEIVComponents } from '../../processors/EIVComponentAssembler';
import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import { EIVScorer } from '../EIVScorer';
import { getEIVTier } from '../eivTiers';

describe('EIVScorer — Architectural Invariants', () => {
  test('EIV is always within [0,1]', () => {
    const samples: AnalyzerOutputs[] = [
      {
        expressionStrength: { score: 0, confidence: 1 },
        valence: { score: 0, confidence: 1 },
        arousal: { score: 0, confidence: 1 },
      },
      {
        expressionStrength: { score: 1, confidence: 1 },
        valence: { score: 1, confidence: 1 },
        arousal: { score: 1, confidence: 1 },
      },
      {
        expressionStrength: { score: 0.5, confidence: 0.8 },
        valence: { score: 0.2, confidence: 0.7 },
        arousal: { score: 0.4, confidence: 0.7 },
      },
    ];

    samples.forEach(sample => {
      const components = buildEIVComponents(sample);
      const { value } = EIVScorer.calculate(components);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });

  test('invalid components throw (NaN / Infinity)', () => {
    const bad: AnalyzerOutputs[] = [
      {
        expressionStrength: { score: NaN, confidence: 1 },
        valence: { score: 0, confidence: 1 },
        arousal: { score: 0, confidence: 1 },
      },
      {
        expressionStrength: { score: Infinity, confidence: 1 },
        valence: { score: 0, confidence: 1 },
        arousal: { score: 0, confidence: 1 },
      },
      {
        expressionStrength: { score: 0.5, confidence: NaN },
        valence: { score: 0.2, confidence: 0.7 },
        arousal: { score: 0.4, confidence: 0.7 },
      },
    ];

    bad.forEach(sample => {
      const components = buildEIVComponents(sample);
      expect(() => EIVScorer.calculate(components)).toThrow();
    });
  });

  test('tier comes from getEIVTier only (SSoT)', () => {
    const components = buildEIVComponents({
      expressionStrength: { score: 0.5, confidence: 0.8 },
      valence: { score: 0.2, confidence: 0.7 },
      arousal: { score: 0.4, confidence: 0.7 },
    });

    const result = EIVScorer.calculate(components);
    expect(result.breakdown.tier).toBe(getEIVTier(result.value));
  });
});
