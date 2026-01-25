// src/emotion-core/analyzers/content/RepetitionAnalyzer.test.ts

import { RepetitionAnalyzer } from './RepetitionAnalyzer';
import { AnalyzerResult } from '../../types/analysis.types';

describe('RepetitionAnalyzer — Detection Layer', () => {
  let analyzer: RepetitionAnalyzer;

  beforeEach(() => {
    analyzer = new RepetitionAnalyzer();
  });

  /* ─────────────────────────────────────────────
   * GROUP 1: BASIC DETECTION (6)
   * ───────────────────────────────────────────── */

  test('detects simple repetition', () => {
    const res = analyzer.analyze('no no');
    expectSignal(res, 'no', 2);
  });

  test('detects triple repetition', () => {
    const res = analyzer.analyze('yes yes yes');
    expectSignal(res, 'yes', 3);
  });

  test('does not detect single token', () => {
    const res = analyzer.analyze('okay');
    expect(res.signals.length).toBe(0);
  });

  test('does not detect spaced repetition', () => {
    const res = analyzer.analyze('no maybe no');
    expect(res.signals.length).toBe(0);
  });

  test('detects multiple repetition groups', () => {
    const res = analyzer.analyze('no no stop stop stop');
    expectSignal(res, 'no', 2);
    expectSignal(res, 'stop', 3);
  });

  test('handles repetition at sentence start', () => {
    const res = analyzer.analyze('wait wait this');
    expectSignal(res, 'wait', 2);
  });

  /* ─────────────────────────────────────────────
   * GROUP 2: CASE & NORMALIZATION (5)
   * ───────────────────────────────────────────── */

  test('is case-insensitive', () => {
    const res = analyzer.analyze('NO no No');
    expectSignal(res, 'no', 3);
  });

  test('normalizes punctuation', () => {
    const res = analyzer.analyze('stop, stop!');
    expectSignal(res, 'stop', 2);
  });

  test('ignores symbols-only tokens', () => {
    const res = analyzer.analyze('!!! !!!');
    expect(res.signals.length).toBe(0);
  });

  test('handles mixed punctuation and words', () => {
    const res = analyzer.analyze('no!!! no???');
    expectSignal(res, 'no', 2);
  });

  test('handles trailing punctuation safely', () => {
    const res = analyzer.analyze('wait. wait.');
    expectSignal(res, 'wait', 2);
  });

  /* ─────────────────────────────────────────────
   * GROUP 3: POSITION & STRUCTURE (5)
   * ───────────────────────────────────────────── */

  test('assigns start position correctly', () => {
    const res = analyzer.analyze('go go now');
    expect(res.signals[0].position).toBe('start');
  });

  test('assigns mid position correctly', () => {
    const res = analyzer.analyze('this is bad bad behavior');
    expect(res.signals[0].position).toBe('mid');
  });

  test('detects repetition at end', () => {
    const res = analyzer.analyze('this is bad bad');
    expectSignal(res, 'bad', 2);
  });

  test('handles single repetition group only once', () => {
    const res = analyzer.analyze('no no no');
    expect(res.signals.length).toBe(1);
  });

  test('records correct token indices', () => {
    const res = analyzer.analyze('wait wait now');
    const meta = res.signals[0].metadata;

    expect(meta).toBeDefined();
    expect(meta!.startIndex).toBe(0);
    expect(meta!.endIndex).toBe(1);
  });

  /* ─────────────────────────────────────────────
   * GROUP 4: SAFETY & EDGE CASES (5)
   * ───────────────────────────────────────────── */

  test('ignores empty input', () => {
    const res = analyzer.analyze('');
    expect(res.signals.length).toBe(0);
  });

  test('ignores whitespace-only input', () => {
    const res = analyzer.analyze('   ');
    expect(res.signals.length).toBe(0);
  });

  test('handles newline separation', () => {
    const res = analyzer.analyze('no\nno');
    expectSignal(res, 'no', 2);
  });

  test('handles tabs as separators', () => {
    const res = analyzer.analyze('stop\tstop');
    expectSignal(res, 'stop', 2);
  });

  test('returns valid AnalyzerResult shell', () => {
    const res = analyzer.analyze('yes yes');
    expect(res.analyzerId).toBe('repetition');
    expect(res.confidence).toBe(0);
  });
});

/* ─────────────────────────────────────────────
 * HELPERS
 * ───────────────────────────────────────────── */

function expectSignal(
  result: AnalyzerResult,
  token: string,
  count: number
) {
  const signal = result.signals.find(
    s => s.metadata?.token === token
  );

  expect(signal).toBeDefined();
  expect(signal!.metadata).toBeDefined();
  expect(signal!.metadata!.token).toBe(token);
  expect(signal!.value).toBe(count);
}
