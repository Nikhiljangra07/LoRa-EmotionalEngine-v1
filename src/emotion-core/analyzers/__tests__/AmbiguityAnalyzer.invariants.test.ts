import { AmbiguityAnalyzer } from '../content/AmbiguityAnalyzer';

describe('AmbiguityAnalyzer — Layer-1 Purity', () => {
  const analyzer = new AmbiguityAnalyzer();

  test('does not expose intent/emotion labels', () => {
    const result = analyzer.analyze('Maybe this is good… or bad?');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('intent');
    expect(serialized).not.toContain('emotion');
    expect(serialized).not.toContain('sentiment');
    expect(serialized).not.toContain('sarcasm');
  });

  test('outputs remain surface-marker only', () => {
    const result = analyzer.analyze('Perhaps, however, I guess…');

    expect(result).toHaveProperty('ambiguityScore');
    expect(result).toHaveProperty('ambiguitySources');
    expect(result).toHaveProperty('contradictionDetected');
    expect(result).toHaveProperty('confidencePenaltyHint');
  });
});
