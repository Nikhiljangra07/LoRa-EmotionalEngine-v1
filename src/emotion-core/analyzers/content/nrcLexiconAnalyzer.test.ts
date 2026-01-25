import { NrcLexiconAnalyzer } from './NrcLexiconAnalyzer';
import { NRCEmotion } from '../../types';

describe('NrcLexiconAnalyzer — Production Behavior', () => {
  test('normalizes distribution from raw counts', () => {
    const result = NrcLexiconAnalyzer.analyze('happy love');
    const total = Object.values(result.rawCounts).reduce((a, b) => a + b, 0);

    expect(total).toBeGreaterThan(0);

    for (const emotion of Object.values(NRCEmotion) as NRCEmotion[]) {
      const expected =
        total === 0
          ? 0
          : Number((result.rawCounts[emotion] / total).toFixed(4));
      expect(result.distribution[emotion]).toBe(expected);
    }
  });

  test('tokenization lowercases and strips punctuation', () => {
    const result = NrcLexiconAnalyzer.analyze('HAPPY!!!');

    expect(result.tokenCount).toBe(1);
    expect(sumValues(result.distribution)).toBeCloseTo(1, 4);
  });

  test('mixed valence keeps dominance suppressed under default gap', () => {
    const result = NrcLexiconAnalyzer.analyze('sadness love');

    expect(result.distribution[NRCEmotion.NEGATIVE]).toBeGreaterThan(0);
    expect(result.distribution[NRCEmotion.POSITIVE]).toBeGreaterThan(0);

    const expectedGap = confidenceGap(result.distribution);
    expect(result.confidenceGap).toBeCloseTo(expectedGap, 4);
    expect(result.dominantEmotion).toBeUndefined();
  });

  test('zero-emotion input returns zero distribution', () => {
    const result = NrcLexiconAnalyzer.analyze('zxqv blargh trnq');

    expect(result.tokenCount).toBe(0);
    expect(Object.values(result.distribution).every(v => v === 0)).toBe(
      true
    );
    expect(result.dominantEmotion).toBeUndefined();
    expect(result.confidenceGap).toBe(1);
  });

  test('confidence level is based on token length', () => {
    const low = NrcLexiconAnalyzer.analyze('one two three four five six seven eight nine');
    const moderate = NrcLexiconAnalyzer.analyze(
      'one two three four five six seven eight nine ten'
    );
    const high = NrcLexiconAnalyzer.analyze(
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty'
    );

    expect(low.confidenceLevel).toBe('LOW');
    expect(moderate.confidenceLevel).toBe('MODERATE');
    expect(high.confidenceLevel).toBe('HIGH');
  });
});

function sumValues(distribution: Record<NRCEmotion, number>): number {
  return Object.values(distribution).reduce((a, b) => a + b, 0);
}

function confidenceGap(distribution: Record<NRCEmotion, number>): number {
  const sorted = Object.values(distribution)
    .filter(v => v > 0)
    .sort((a, b) => b - a);

  if (sorted.length < 2) return 1;
  return Number((sorted[0] - sorted[1]).toFixed(4));
}