import { NegationScopeAnalyzer } from './NegationScopeAnalyzer';


describe('NegationScopeAnalyzer — Core Semantics', () => {

  test('negates simple positive emotion', () => {
    const text = 'I am not happy';

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.negationDetected).toBe(true);
    expect(result.scopes.length).toBe(1);
    expect(result.scopes[0].negatedTokens)
      .toContain('happy');
  });

  test('handles negation with modifiers', () => {
    const text = 'I am not very happy today';

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.scopes[0].negatedTokens)
      .toContain('happy');
  });

  test('terminates scope on contrastive conjunction', () => {
    const text = 'I am not happy but hopeful';

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.scopes[0].negatedTokens)
      .toEqual(['happy']);
  });

  test('normalizes contractions', () => {
    const text = "I don't feel sad";

    const result = NegationScopeAnalyzer.analyze(text);

    expect(result.negationDetected).toBe(true);
    expect(result.scopes[0].negatedTokens)
      .toContain('sad');
  });

});
