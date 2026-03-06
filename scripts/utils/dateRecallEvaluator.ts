/**
 * Date recall evaluator: normalize and compare date expressions in text.
 * Used by the memory stress test to decide if a response correctly recalls an expected date.
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBR: Record<string, number> = {};
MONTH_NAMES.forEach((m, i) => {
  MONTH_ABBR[m] = i + 1;
  MONTH_ABBR[m.slice(0, 3)] = i + 1;
});

function stripOrdinal(s: string): string {
  return s.replace(/(\d+)(?:st|nd|rd|th)\b/gi, '$1');
}

export function normalizeText(s: string): string {
  return stripOrdinal(s).replace(/,/g, ' ').replace(/[—–\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateToCanonical(d: ParsedDate): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

function parseOneDateString(raw: string): ParsedDate | null {
  const s = normalizeText(raw);

  // ISO: 2026-03-20
  const isoMatch = s.match(/(\d{4})\s*(\d{2})\s*(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const month = parseInt(m!, 10);
    if (month >= 1 && month <= 12) {
      return { year: parseInt(y!, 10), month, day: parseInt(d!, 10) };
    }
  }

  // "March 20 2026" or "march 20 2026"
  const mdyMatch = s.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (mdyMatch) {
    const month = MONTH_ABBR[mdyMatch[1]!];
    if (month) {
      return { year: parseInt(mdyMatch[3]!, 10), month, day: parseInt(mdyMatch[2]!, 10) };
    }
  }

  // "20 March 2026"
  const dmyMatch = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (dmyMatch) {
    const month = MONTH_ABBR[dmyMatch[2]!];
    if (month) {
      return { year: parseInt(dmyMatch[3]!, 10), month, day: parseInt(dmyMatch[1]!, 10) };
    }
  }

  // "March 20" (no year — assume current year)
  const myNoYear = s.match(/([a-z]+)\s+(\d{1,2})$/);
  if (myNoYear) {
    const month = MONTH_ABBR[myNoYear[1]!];
    if (month) {
      return { year: new Date().getFullYear(), month, day: parseInt(myNoYear[2]!, 10) };
    }
  }

  return null;
}

/**
 * Extract all recognizable date expressions from a text block.
 * Returns an array of canonical "YYYY-MM-DD" strings.
 */
export function extractDatesFromText(text: string): string[] {
  const clean = stripOrdinal(text).replace(/,/g, ' ').replace(/[—–\-]+/g, ' ');
  const results: string[] = [];
  const seen = new Set<string>();

  // ISO dates
  for (const m of clean.matchAll(/\b(\d{4})\s*-?\s*(\d{2})\s*-?\s*(\d{2})\b/g)) {
    const month = parseInt(m[2]!, 10);
    if (month >= 1 && month <= 12) {
      const c = `${m[1]}-${pad2(month)}-${pad2(parseInt(m[3]!, 10))}`;
      if (!seen.has(c)) {
        seen.add(c);
        results.push(c);
      }
    }
  }

  // "Month Day Year"
  for (const m of clean.matchAll(/\b([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\b/gi)) {
    const month = MONTH_ABBR[m[1]!.toLowerCase()];
    if (month) {
      const c = `${m[3]}-${pad2(month)}-${pad2(parseInt(m[2]!, 10))}`;
      if (!seen.has(c)) {
        seen.add(c);
        results.push(c);
      }
    }
  }

  // "Day Month Year"
  for (const m of clean.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/gi)) {
    const month = MONTH_ABBR[m[2]!.toLowerCase()];
    if (month) {
      const c = `${m[3]}-${pad2(month)}-${pad2(parseInt(m[1]!, 10))}`;
      if (!seen.has(c)) {
        seen.add(c);
        results.push(c);
      }
    }
  }

  return results;
}

export interface RecallDebug {
  expectedNormalized: string;
  detectedDates: string[];
  match: boolean;
}

export function containsDateEquivalent(
  response: string,
  expectedDate: string,
): { match: boolean; debug: RecallDebug } {
  if (!expectedDate) {
    return { match: true, debug: { expectedNormalized: '', detectedDates: [], match: true } };
  }

  const parsedExpected = parseOneDateString(expectedDate);
  const expectedNormalized = parsedExpected ? dateToCanonical(parsedExpected) : normalizeText(expectedDate);
  const detectedDates = extractDatesFromText(response);

  // Primary: canonical date comparison
  if (parsedExpected) {
    const target = dateToCanonical(parsedExpected);
    if (detectedDates.includes(target)) {
      return { match: true, debug: { expectedNormalized, detectedDates, match: true } };
    }
  }

  // Fallback: normalized text inclusion (handles non-date expected values)
  const normResponse = normalizeText(response);
  const normExpected = normalizeText(expectedDate);
  if (normResponse.includes(normExpected)) {
    return { match: true, debug: { expectedNormalized, detectedDates, match: true } };
  }

  return { match: false, debug: { expectedNormalized, detectedDates, match: false } };
}
