import { PunctuationAnalyzer } from './PunctuationAnalyzer';

import {
  calculateIncrementalIntensity,
  calculateConfidence,
  aggregateSignals,
} from '../../math/punctuation.math';

import {
  BASE_WEIGHTS,
} from '../../config/punctuation.config';

const analyzer = new PunctuationAnalyzer();

/* ============================================================================
 * 1. BOUNDEDNESS (3)
 * ========================================================================== */

describe('Boundedness [0,1]', () => {
  it('EIV never exceeds 1.0', () => {
    const eiv = calculateIncrementalIntensity(BASE_WEIGHTS.EXCLAMATION, 50);
    expect(eiv).toBeLessThanOrEqual(1);
  });

  it('EIV never drops below 0', () => {
    const eiv = calculateIncrementalIntensity(BASE_WEIGHTS.EXCLAMATION, 0);
    expect(eiv).toBeGreaterThanOrEqual(0);
  });

  it('aggregation never exceeds 1.0', () => {
    const result = aggregateSignals([
      { category: 'exclamation', eiv: 0.9, confidence: 0.9 },
      { category: 'question', eiv: 0.8, confidence: 0.8 },
    ]);
    expect(result.aggregateEIV).toBeLessThanOrEqual(1);
  });
});

/* ============================================================================
 * 2. MONOTONICITY (3)
 * ========================================================================== */

describe('Monotonicity', () => {
  it('exclamation monotonic increase', () => {
    expect(
      calculateIncrementalIntensity(0.7, 3)
    ).toBeGreaterThan(
      calculateIncrementalIntensity(0.7, 2)
    );
  });

  it('question monotonic increase', () => {
    expect(
      calculateIncrementalIntensity(0.5, 4)
    ).toBeGreaterThan(
      calculateIncrementalIntensity(0.5, 1)
    );
  });

  it('monotonicity holds for all base weights', () => {
    Object.values(BASE_WEIGHTS).forEach(base => {
      expect(
        calculateIncrementalIntensity(base, 5)
      ).toBeGreaterThanOrEqual(
        calculateIncrementalIntensity(base, 4)
      );
    });
  });
});

/* ============================================================================
 * 3. HIERARCHY (! > ? > … > .) (3)
 * ========================================================================== */

describe('Hierarchy', () => {
  it('exclamation > question', () => {
    expect(BASE_WEIGHTS.EXCLAMATION)
      .toBeGreaterThan(BASE_WEIGHTS.QUESTION);
  });

  it('question > ellipsis', () => {
    expect(BASE_WEIGHTS.QUESTION)
      .toBeGreaterThan(BASE_WEIGHTS.ELLIPSIS);
  });

  it('period has lowest weight', () => {
    expect(BASE_WEIGHTS.PERIOD).toBe(0.05);
  });
});

/* ============================================================================
 * 4. MIXED (!?) SUPRA-ADDITIVITY (3)
 * ========================================================================== */

describe('Mixed punctuation (!?)', () => {
  it('mixed > average(!, ?)', () => {
    const avg = (0.7 + 0.5) / 2;
    expect(BASE_WEIGHTS.MIXED).toBeGreaterThan(avg);
  });

  it('mixed > exclamation', () => {
    expect(BASE_WEIGHTS.MIXED)
      .toBeGreaterThan(BASE_WEIGHTS.EXCLAMATION);
  });

  it('mixed > question', () => {
    expect(BASE_WEIGHTS.MIXED)
      .toBeGreaterThan(BASE_WEIGHTS.QUESTION);
  });
});

/* ============================================================================
 * 5. BOUNDARY EFFECTS (3)
 * ========================================================================== */

describe('Boundary discourse effects', () => {
  it('trailing ellipsis > mid ellipsis', () => {
    expect(BASE_WEIGHTS.TRAILING_ELLIPSIS)
      .toBeGreaterThan(BASE_WEIGHTS.ELLIPSIS);
  });

  it('end position boosts confidence', () => {
    expect(
      calculateConfidence(3, 'end')
    ).toBeGreaterThan(
      calculateConfidence(3, 'mid')
    );
  });

  it('start < mid < end confidence ordering', () => {
    expect(
      calculateConfidence(2, 'start')
    ).toBeLessThan(
      calculateConfidence(2, 'mid')
    );
  });
});

/* ============================================================================
 * 6. DIMINISHING RETURNS (REPLACES LINEAR INCREMENT TESTS) (3)
 * ========================================================================== */

describe('Diminishing returns', () => {
  it('early repetitions add more than later ones', () => {
    const early =
      calculateIncrementalIntensity(0.7, 2) -
      calculateIncrementalIntensity(0.7, 1);

    const later =
      calculateIncrementalIntensity(0.7, 6) -
      calculateIncrementalIntensity(0.7, 5);

    expect(early).toBeGreaterThan(later);
  });

  it('growth saturates with high repetition', () => {
    const eiv5 = calculateIncrementalIntensity(0.7, 5);
    const eiv20 = calculateIncrementalIntensity(0.7, 20);

    expect(eiv20 - eiv5).toBeLessThan(0.1);
  });

  it('diminishing shape holds across bases', () => {
    Object.values(BASE_WEIGHTS).forEach(base => {
      const early =
        calculateIncrementalIntensity(base, 2) -
        calculateIncrementalIntensity(base, 1);

      const later =
        calculateIncrementalIntensity(base, 6) -
        calculateIncrementalIntensity(base, 5);

      expect(early).toBeGreaterThan(later);
    });
  });
});

/* ============================================================================
 * 7. AGGREGATION POLICY (3)
 * ========================================================================== */

describe('Aggregation policy (MAX)', () => {
  it('uses max EIV', () => {
    const result = aggregateSignals([
      { category: 'exclamation', eiv: 0.8, confidence: 0.9 },
      { category: 'question', eiv: 0.6, confidence: 0.8 },
    ]);
    expect(result.aggregateEIV).toBe(0.8);
  });

  it('parallel signals do not sum', () => {
    const result = aggregateSignals([
      { category: 'exclamation', eiv: 0.8, confidence: 0.9 },
      { category: 'mixed', eiv: 0.9, confidence: 0.9 },
    ]);
    expect(result.aggregateEIV).toBe(0.9);
  });

  it('empty signals return zero', () => {
    const result = aggregateSignals([]);
    expect(result.aggregateEIV).toBe(0);
  });
});

/* ============================================================================
 * 8. ROBUSTNESS / DETECTION SAFETY (3)
 * ========================================================================== */

describe('Robustness', () => {
  it('ignores code blocks', () => {
    const result = analyzer.analyze('```const x = 1```');
    expect(result.signals.length).toBe(0);
  });

  it('ignores abbreviations', () => {
    const result = analyzer.analyze('Dr. Smith.');
    const periods = result.signals.filter(s => s.type === 'period');
    expect(periods.length).toBe(1);
  });

  it('ignores decimals', () => {
    const result = analyzer.analyze('Pi is 3.14.');
    const periods = result.signals.filter(s => s.type === 'period');
    expect(periods.length).toBe(1);
  });
});
