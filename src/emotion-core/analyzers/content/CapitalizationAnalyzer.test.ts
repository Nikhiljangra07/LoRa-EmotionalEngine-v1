// src/emotion-core/analyzers/content/CapitalizationAnalyzer.test.ts

import { CapitalizationAnalyzer } from './CapitalizationAnalyzer';
import { AnalyzerResult } from '../../types/analysis.types';

describe('CapitalizationAnalyzer — Detection Layer', () => {
  let analyzer: CapitalizationAnalyzer;

  beforeEach(() => {
    analyzer = new CapitalizationAnalyzer();
  });

  // ─────────────────────────────────────────────
  // GROUP 1: BASIC CAPS DETECTION (6)
  // ─────────────────────────────────────────────

  test('detects single ALL-CAPS word', () => {
    const res = analyzer.analyze('I am HAPPY');
    expectSignal(res, 'ALL_CAPS', 1);
  });

  test('detects multiple ALL-CAPS words', () => {
    const res = analyzer.analyze('THIS IS BAD');
    expectSignal(res, 'ALL_CAPS', 3);
  });

  test('does not detect lowercase words', () => {
    const res = analyzer.analyze('this is fine');
    expect(res.signals.length).toBe(0);
  });

  test('ignores single-letter caps (I, A)', () => {
    const res = analyzer.analyze('I am A student');
    expect(res.signals.length).toBe(0);
  });

  test('ignores mixed-case words', () => {
    const res = analyzer.analyze('This Is Weird');
    expect(res.signals.length).toBe(0);
  });

  test('requires minimum length for caps', () => {
    const res = analyzer.analyze('OK');
    expect(res.signals.length).toBe(0);
  });

  // ─────────────────────────────────────────────
  // GROUP 2: REPEATED LETTERS (4)
  // ─────────────────────────────────────────────

  test('detects repeated letters (loooove)', () => {
    const res = analyzer.analyze('I loooove this');
    expectSignal(res, 'REPEATED_LETTERS', 1);
  });

  test('requires 3+ repeated letters', () => {
    const res = analyzer.analyze('soo good');
    expect(res.signals.length).toBe(0);
  });

  test('detects repeated letters with caps', () => {
    const res = analyzer.analyze('I LOOOOVE this');
    expectSignal(res, 'REPEATED_LETTERS', 1);
    expectSignal(res, 'ALL_CAPS', 1);
  });

  test('repeated letters do not trigger caps implicitly', () => {
    const res = analyzer.analyze('loooove');
    expect(res.signals.some(s => s.weightSource === 'ALL_CAPS')).toBe(false);
  });

  // ─────────────────────────────────────────────
  // GROUP 3: ACRONYM & CODE EXCLUSIONS (5)
  // ─────────────────────────────────────────────

  test('ignores known acronyms (USA)', () => {
    const res = analyzer.analyze('I live in the USA');
    expect(res.signals.length).toBe(0);
  });

  test('ignores technical acronyms (API, JSON)', () => {
    const res = analyzer.analyze('Use the API and parse JSON');
    expect(res.signals.length).toBe(0);
  });

  test('ignores SCREAMING_SNAKE_CASE', () => {
    const res = analyzer.analyze('const MAX_VALUE = 10');
    expect(res.signals.length).toBe(0);
  });

  test('ignores CamelCase identifiers', () => {
    const res = analyzer.analyze('RenderUserProfile now');
    expect(res.signals.length).toBe(0);
  });

  test('ignores uppercase words with underscores', () => {
    const res = analyzer.analyze('LOAD_ENV_FILE');
    expect(res.signals.length).toBe(0);
  });

  // ─────────────────────────────────────────────
  // GROUP 4: POSITION & STRUCTURE (4)
  // ─────────────────────────────────────────────

  test('detects caps at sentence start', () => {
    const res = analyzer.analyze('STOP this now');
    expectSignal(res, 'ALL_CAPS', 1);
  });

  test('detects caps at sentence end', () => {
    const res = analyzer.analyze('This is insane STOP');
    expectSignal(res, 'ALL_CAPS', 1);
  });

  test('detects caps in middle of sentence', () => {
    const res = analyzer.analyze('This is REALLY bad');
    expectSignal(res, 'ALL_CAPS', 1);
  });

  test('does not falsely elevate sentence titles', () => {
    const res = analyzer.analyze('TERMS AND CONDITIONS');
    expect(res.signals.length).toBe(0);
  });

  // ─────────────────────────────────────────────
  // GROUP 5: SIGNAL METADATA INTEGRITY (5)
  // ─────────────────────────────────────────────

  test('signals include value and confidence', () => {
    const res = analyzer.analyze('THIS sucks');
    const signal = res.signals[0];
    expect(signal.value).toBeGreaterThan(0);
    expect(signal.confidence).toBeGreaterThan(0);
  });

  test('confidence is lower for single caps', () => {
    const res = analyzer.analyze('THIS');
    expect(res.signals[0].confidence).toBeLessThan(0.7);
  });

  test('confidence increases with repeated caps', () => {
    const res = analyzer.analyze('THIS IS BAD');
    const confidences = res.signals.map(s => s.confidence);
    expect(Math.max(...confidences)).toBeGreaterThan(0.7);
  });

  test('weightSource is correctly assigned', () => {
    const res = analyzer.analyze('STOP');
    expect(res.signals[0].weightSource).toBe('ALL_CAPS');
  });

  test('analyzer returns valid AnalyzerResult shell', () => {
    const res = analyzer.analyze('HELLO');
    expect(res.analyzerId).toBe('capitalization');
    expect(res.confidence).toBe(0);
  });
});

// ─────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────

function expectSignal(
  result: AnalyzerResult,
  weightSource: string,
  count: number
) {
  const signals = result.signals.filter(
    s => s.weightSource === weightSource
  );
  expect(signals.length).toBe(count);
}
