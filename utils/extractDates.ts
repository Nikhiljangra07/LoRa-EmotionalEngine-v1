/**
 * Robust date extraction utility using chrono-node.
 *
 * Parses ALL date mentions in free-form text and returns ISO YYYY-MM-DD strings.
 * Handles punctuation noise (semicolons, em-dashes, colons), multiple dates,
 * and month-day expressions without an explicit year.
 *
 * @example
 *   extractNormalizedDates("March 20 — but maybe March 8", 2026)
 *   // => ["2026-03-20", "2026-03-08"]
 */
import * as chrono from 'chrono-node';

// Punctuation that separates day from year in noisy model output
const SEPARATOR_PUNCT = /[;:]/g;
const DASH_CHARS = /[—–]+/g;

/**
 * Pre-clean text so chrono-node can parse dates that are separated by
 * unconventional punctuation (e.g. "March 20; 2026").
 */
function cleanForParsing(input: string): string {
  return input
    .replace(SEPARATOR_PUNCT, ',')
    .replace(DASH_CHARS, ' ');
}

function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build a stable reference Date for chrono-node from a year.
 * Uses June 15 to avoid edge-case month/year boundary issues.
 */
function referenceDate(year?: number): Date {
  const y = year ?? new Date().getFullYear();
  return new Date(y, 5, 15); // month is 0-indexed → June 15
}

/**
 * Extract all recognizable dates from `text` as ISO YYYY-MM-DD strings.
 *
 * @param text         Free-form text (model response, user message, etc.)
 * @param referenceYear  Year to assume for month-day-only mentions (e.g. "March 20").
 *                       Defaults to the current calendar year.
 * @returns Deduplicated array of ISO date strings in order of appearance.
 */
export function extractNormalizedDates(text: string, referenceYear?: number): string[] {
  const cleaned = cleanForParsing(text);
  const ref = referenceDate(referenceYear);

  const results = chrono.parse(cleaned, ref);
  const seen = new Set<string>();
  const dates: string[] = [];

  for (const r of results) {
    const iso = toISO(r.start.date());
    if (!seen.has(iso)) {
      seen.add(iso);
      dates.push(iso);
    }
  }

  return dates;
}
