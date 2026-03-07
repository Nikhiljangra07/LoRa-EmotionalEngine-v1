/**
 * Robust date normalizer using chrono-node.
 *
 * Handles natural-language date mentions with punctuation noise
 * (semicolons, em-dashes, surrounding prose) and returns ISO YYYY-MM-DD.
 */
import * as chrono from 'chrono-node';

const PUNCT_RE = /[;]/g;
const DASH_RE = /[—–]+/g;

function cleanForParsing(input: string): string {
  return input.replace(PUNCT_RE, ',').replace(DASH_RE, ' ');
}

function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse the first recognizable date in `input` and return ISO YYYY-MM-DD.
 * Returns null when no date can be detected.
 */
export function normalizeDate(input: string): string | null {
  const cleaned = cleanForParsing(input);
  const results = chrono.parse(cleaned, { instant: new Date('2026-03-02T00:00:00') });
  if (results.length === 0) return null;
  return toISO(results[0]!.start.date());
}

/**
 * Extract ALL recognizable dates from `input` as ISO YYYY-MM-DD strings.
 * Deduplicates and preserves order of appearance.
 */
export function normalizeDatesAll(input: string): string[] {
  const cleaned = cleanForParsing(input);
  const results = chrono.parse(cleaned, { instant: new Date('2026-03-02T00:00:00') });
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
