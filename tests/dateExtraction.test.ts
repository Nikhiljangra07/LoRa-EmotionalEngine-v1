import { extractNormalizedDates } from '../utils/extractDates';
import { containsDateEquivalent } from '../scripts/utils/dateRecallEvaluator';

// ---------------------------------------------------------------------------
// extractNormalizedDates — core extraction
// ---------------------------------------------------------------------------

describe('extractNormalizedDates', () => {
  describe('basic formats', () => {
    it('"March 20 2026" → 2026-03-20', () => {
      expect(extractNormalizedDates('March 20 2026', 2026)).toContain('2026-03-20');
    });

    it('"March 20, 2026" → 2026-03-20', () => {
      expect(extractNormalizedDates('March 20, 2026', 2026)).toContain('2026-03-20');
    });

    it('"20 March 2026" → 2026-03-20', () => {
      expect(extractNormalizedDates('20 March 2026', 2026)).toContain('2026-03-20');
    });
  });

  describe('noisy punctuation', () => {
    it('"March 20; 2026" → 2026-03-20 (semicolon separator)', () => {
      expect(extractNormalizedDates('March 20; 2026', 2026)).toContain('2026-03-20');
    });

    it('"March 20; 2026 — 13 days from today" → 2026-03-20', () => {
      expect(extractNormalizedDates('March 20; 2026 — 13 days from today', 2026)).toContain('2026-03-20');
    });
  });

  describe('embedded in prose', () => {
    it('"deploy March 20 2026" → includes 2026-03-20', () => {
      expect(extractNormalizedDates('deploy March 20 2026', 2026)).toContain('2026-03-20');
    });

    it('multiple dates: "Based on this conversation: March 20 but maybe March 8"', () => {
      const dates = extractNormalizedDates(
        'Based on this conversation: March 20 but maybe March 8',
        2026,
      );
      expect(dates).toContain('2026-03-20');
      expect(dates).toContain('2026-03-08');
    });
  });

  describe('month-day without year (inferred from referenceYear)', () => {
    it('"March 20 is the deployment date." with referenceYear=2026 → 2026-03-20', () => {
      expect(extractNormalizedDates('March 20 is the deployment date.', 2026)).toContain('2026-03-20');
    });

    it('"Deploying Mar 20." with referenceYear=2026 → 2026-03-20', () => {
      expect(extractNormalizedDates('Deploying Mar 20.', 2026)).toContain('2026-03-20');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for text with no dates', () => {
      expect(extractNormalizedDates('no dates here at all', 2026)).toEqual([]);
    });

    it('deduplicates the same date', () => {
      const dates = extractNormalizedDates('March 20 2026 and March 20, 2026', 2026);
      const count = dates.filter((d) => d === '2026-03-20').length;
      expect(count).toBe(1);
    });

    it('ordinal: "March 20th, 2026" → 2026-03-20', () => {
      expect(extractNormalizedDates('March 20th, 2026', 2026)).toContain('2026-03-20');
    });
  });
});

// ---------------------------------------------------------------------------
// containsDateEquivalent — presence-based evaluation
// ---------------------------------------------------------------------------

describe('containsDateEquivalent (presence match)', () => {
  it('passes when expected date is NOT the first date in response', () => {
    const result = containsDateEquivalent(
      'Based on this conversation; you said March 20 — but also maybe tomorrow; which is March 8.',
      'March 20 2026',
    );
    expect(result.match).toBe(true);
    expect(result.debug.detectedDates).toContain('2026-03-20');
  });

  it('passes with semicolon-separated date', () => {
    const result = containsDateEquivalent(
      'March 20; 2026 — 13 days from today.',
      'March 20 2026',
    );
    expect(result.match).toBe(true);
  });

  it('passes with month-day only (year inferred from expected)', () => {
    const result = containsDateEquivalent(
      'You mentioned deploying on March 20.',
      'March 20 2026',
    );
    expect(result.match).toBe(true);
  });

  it('fails when expected date is absent', () => {
    const result = containsDateEquivalent(
      'Your launch is April 10, 2026',
      'March 20 2026',
    );
    expect(result.match).toBe(false);
  });

  it('provides debug info on failure', () => {
    const result = containsDateEquivalent(
      'Your launch is April 10, 2026',
      'March 20 2026',
    );
    expect(result.debug.expectedNormalized).toBe('2026-03-20');
    expect(result.debug.detectedDates).toContain('2026-04-10');
    expect(result.debug.match).toBe(false);
  });
});
