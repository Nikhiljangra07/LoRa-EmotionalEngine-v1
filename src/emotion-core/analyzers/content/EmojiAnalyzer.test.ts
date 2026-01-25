// src/emotion-core/analyzers/content/EmojiAnalyzer.test.ts

import { EmojiAnalyzer } from './EmojiAnalyzer';

describe('EmojiAnalyzer — Detection Layer', () => {
  const analyzer = new EmojiAnalyzer();

  /* ============================================================================
   * A. BASIC DETECTION (4)
   * ========================================================================== */

  test('detects a single emoji', () => {
    const res = analyzer.analyze('hello 🙂');
    expect(res.signals.length).toBe(1);
    expect(res.signals[0].metadata?.emoji).toBe('🙂');
  });

  test('detects repeated emojis', () => {
    const res = analyzer.analyze('🙂🙂🙂');
    expect(res.signals.length).toBe(1);
    expect(res.signals[0].value).toBe(3);
  });

  test('detects multiple emoji types', () => {
    const res = analyzer.analyze('🙂😂');
    expect(res.signals.length).toBe(2);
  });

  test('detects emojis mixed with text', () => {
    const res = analyzer.analyze('this is funny 😂 lol');
    expect(res.signals.length).toBe(1);
  });

  /* ============================================================================
   * B. AGGREGATION & COUNTING (4)
   * ========================================================================== */

  test('groups identical emojis into one signal', () => {
    const res = analyzer.analyze('🔥🔥🔥');
    expect(res.signals.length).toBe(1);
  });

  test('counts emoji frequency correctly', () => {
    const res = analyzer.analyze('🔥🔥🔥');
    expect(res.signals[0].value).toBe(3);
  });

  test('keeps different emojis separate', () => {
    const res = analyzer.analyze('🔥💀🔥');
    expect(res.signals.length).toBe(2);
  });

  test('is order-agnostic for grouping', () => {
    const a = analyzer.analyze('😂🙂');
    const b = analyzer.analyze('🙂😂');
    expect(a.signals.length).toBe(b.signals.length);
  });

  /* ============================================================================
   * C. SIGNAL CONTRACT (4)
   * ========================================================================== */

  test('signal type is emoji', () => {
    const res = analyzer.analyze('🙂');
    expect(res.signals[0].type).toBe('emoji');
  });

  test('weightSource is EMOJI', () => {
    const res = analyzer.analyze('🙂');
    expect(res.signals[0].weightSource).toBe('EMOJI');
  });

  test('metadata includes emoji string', () => {
    const res = analyzer.analyze('🙂');
    expect(res.signals[0].metadata?.emoji).toBeDefined();
  });

  test('position is assigned deterministically', () => {
    const res = analyzer.analyze('🙂😂');
    expect(['start', 'mid']).toContain(res.signals[0].position);
  });

  /* ============================================================================
   * D. NOISE & SAFETY (4)
   * ========================================================================== */

  test('returns no signals when no emoji present', () => {
    const res = analyzer.analyze('hello world');
    expect(res.signals.length).toBe(0);
  });

  test('ignores punctuation-only input', () => {
    const res = analyzer.analyze('!!! ???');
    expect(res.signals.length).toBe(0);
  });

  test('ignores ASCII emoticons', () => {
    const res = analyzer.analyze(':) :(');
    expect(res.signals.length).toBe(0);
  });

  test('ignores emojis inside code blocks', () => {
    const res = analyzer.analyze('```const x = 🙂```');
    expect(res.signals.length).toBe(0);
  });

  /* ============================================================================
   * E. STRUCTURAL ROBUSTNESS (4)
   * ========================================================================== */

  test('handles newline-separated emojis', () => {
    const res = analyzer.analyze('🙂\n🙂');
    expect(res.signals[0].value).toBe(2);
  });

  test('handles tab-separated emojis', () => {
    const res = analyzer.analyze('🙂\t🙂');
    expect(res.signals[0].value).toBe(2);
  });

  test('handles mixed unicode text safely', () => {
    const res = analyzer.analyze('こんにちは 🙂');
    expect(res.signals.length).toBe(1);
  });

  test('handles empty and whitespace input', () => {
    const res = analyzer.analyze('   ');
    expect(res.signals.length).toBe(0);
  });

  /* ============================================================================
   * F. REGRESSION GUARDS (4)
   * ========================================================================== */

  test('returns a valid AnalyzerResult shell', () => {
    const res = analyzer.analyze('🙂');
    expect(res.analyzerId).toBe('emoji');
    expect(res.confidence).toBeDefined();
  });

  test('confidence is always present', () => {
    const res = analyzer.analyze('🙂');
    expect(typeof res.confidence).toBe('number');
  });

  test('same input yields stable output', () => {
    const a = analyzer.analyze('🙂🙂');
    const b = analyzer.analyze('🙂🙂');
    expect(a.signals[0].value).toBe(b.signals[0].value);
  });

  test('analyzerId is locked', () => {
    const res = analyzer.analyze('🙂');
    expect(res.analyzerId).toBe('emoji');
  });
});
