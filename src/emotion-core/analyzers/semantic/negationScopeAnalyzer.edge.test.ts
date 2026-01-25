import { NegationScopeAnalyzer } from './NegationScopeAnalyzer';

describe('NegationScopeAnalyzer — Edge Cases', () => {

  test('flags double negation without inversion', () => {
    const text = 'I am not unhappy';

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.doubleNegationDetected).toBe(true);
    expect(result.scopes[0].recommendation)
      .toBe('NEUTRALIZE');
  });

  test('does not treat pseudo-negation as real negation', () => {
    const text = 'This is a false negative result';

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.negationDetected).toBe(false);
  });

  test('hard stops scope at sentence boundary', () => {
    const text = 'I am not happy. I feel hopeful now';

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.scopes[0].negatedTokens)
      .toEqual(['happy']);
  });

  test('handles list negation correctly', () => {
    const text = 'No joy, happiness, or excitement here';

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.scopes[0].negatedTokens)
      .toEqual(['joy', 'happiness', 'excitement']);
  });

});
