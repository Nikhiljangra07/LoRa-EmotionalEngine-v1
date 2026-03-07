import { normalizeDate, normalizeDatesAll } from '../utils/normalizeDate';
import { extractNormalizedDates } from '../utils/extractDates';
import { containsDateEquivalent, extractDatesFromText } from '../scripts/utils/dateRecallEvaluator';

// ---------------------------------------------------------------------------
// normalizeDate — standalone utility (delegates to extractDates)
// ---------------------------------------------------------------------------

describe('normalizeDate', () => {
  const cases: [string, string][] = [
    ['March 20 2026', '2026-03-20'],
    ['March 20, 2026', '2026-03-20'],
    ['March 20; 2026', '2026-03-20'],
    ['deploy March 20 2026', '2026-03-20'],
    ['March 20 2026 — 13 days from today', '2026-03-20'],
  ];

  test.each(cases)('normalizeDate(%j) === %j', (input, expected) => {
    expect(normalizeDate(input, 2026)).toBe(expected);
  });

  it('returns null for text with no dates', () => {
    expect(normalizeDate('no dates here at all')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeDatesAll — multiple dates
// ---------------------------------------------------------------------------

describe('normalizeDatesAll', () => {
  it('extracts multiple dates from a response', () => {
    const dates = normalizeDatesAll('We could do March 8 2026 or April 15, 2026.');
    expect(dates).toContain('2026-03-08');
    expect(dates).toContain('2026-04-15');
  });

  it('deduplicates identical dates', () => {
    const dates = normalizeDatesAll('March 20 2026 and March 20, 2026');
    const unique = dates.filter((d) => d === '2026-03-20');
    expect(unique.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractNormalizedDates — core chrono-node extraction
// ---------------------------------------------------------------------------

describe('extractNormalizedDates', () => {
  it('extracts date with semicolon separator', () => {
    expect(extractNormalizedDates('March 20; 2026', 2026)).toContain('2026-03-20');
  });

  it('extracts month-day without year using referenceYear', () => {
    expect(extractNormalizedDates('March 20 is the date', 2026)).toContain('2026-03-20');
  });

  it('extracts multiple dates from prose', () => {
    const dates = extractNormalizedDates(
      'Based on this conversation: March 20 but maybe March 8',
      2026,
    );
    expect(dates).toContain('2026-03-20');
    expect(dates).toContain('2026-03-08');
  });
});

// ---------------------------------------------------------------------------
// extractDatesFromText — regex layer (semicolon fix)
// ---------------------------------------------------------------------------

describe('extractDatesFromText (regex + chrono fallback)', () => {
  it('handles semicolons: "March 20; 2026"', () => {
    const dates = extractDatesFromText('March 20; 2026');
    expect(dates).toContain('2026-03-20');
  });

  it('handles commas: "March 20, 2026"', () => {
    const dates = extractDatesFromText('March 20, 2026');
    expect(dates).toContain('2026-03-20');
  });

  it('handles em-dash: "March 20 2026 — 13 days"', () => {
    const dates = extractDatesFromText('March 20 2026 — 13 days from today');
    expect(dates).toContain('2026-03-20');
  });

  it('handles day-month-year: "20 March 2026"', () => {
    const dates = extractDatesFromText('20 March 2026');
    expect(dates).toContain('2026-03-20');
  });
});

// ---------------------------------------------------------------------------
// containsDateEquivalent — end-to-end evaluator
// ---------------------------------------------------------------------------

describe('containsDateEquivalent', () => {
  const passingCases: [string, string][] = [
    ['March 20 2026', 'March 20 2026'],
    ['March 20, 2026', 'March 20 2026'],
    ['March 20; 2026', 'March 20 2026'],
    ['March 20; 2026 — 13 days from today.', 'March 20 2026'],
    ['deploy March 20 2026 with the team', 'March 20 2026'],
    ['Deployment is on 20 March 2026.', 'March 20 2026'],
    ['I believe you are deploying on March 20, 2026.', 'March 20 2026'],
    ['scheduled for March 8th, 2026', 'March 8 2026'],
  ];

  test.each(passingCases)(
    'response %j matches expected %j',
    (response, expected) => {
      const result = containsDateEquivalent(response, expected);
      expect(result.match).toBe(true);
    },
  );

  const failingCases: [string, string][] = [
    ['Your launch is April 10, 2026', 'March 20 2026'],
    ['We are targeting March 21 for launch.', 'March 20 2026'],
  ];

  test.each(failingCases)(
    'response %j does NOT match expected %j',
    (response, expected) => {
      const result = containsDateEquivalent(response, expected);
      expect(result.match).toBe(false);
    },
  );

  it('returns match=true for empty expectedDate', () => {
    const result = containsDateEquivalent('anything', '');
    expect(result.match).toBe(true);
  });
});
