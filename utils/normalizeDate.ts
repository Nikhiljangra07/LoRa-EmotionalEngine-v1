/**
 * Robust date normalizer using chrono-node.
 *
 * Handles natural-language date mentions with punctuation noise
 * (semicolons, em-dashes, surrounding prose) and returns ISO YYYY-MM-DD.
 *
 * For the primary extraction utility used by the evaluator, see utils/extractDates.ts.
 * This module provides convenience wrappers for simpler use-cases.
 */
import { extractNormalizedDates } from './extractDates';

/**
 * Parse the first recognizable date in `input` and return ISO YYYY-MM-DD.
 * Returns null when no date can be detected.
 *
 * @param referenceYear  Year to infer for month-day-only mentions. Defaults to current year.
 */
export function normalizeDate(input: string, referenceYear?: number): string | null {
  const dates = extractNormalizedDates(input, referenceYear);
  return dates.length > 0 ? dates[0]! : null;
}

/**
 * Extract ALL recognizable dates from `input` as ISO YYYY-MM-DD strings.
 * Deduplicates and preserves order of appearance.
 *
 * @param referenceYear  Year to infer for month-day-only mentions. Defaults to current year.
 */
export function normalizeDatesAll(input: string, referenceYear?: number): string[] {
  return extractNormalizedDates(input, referenceYear);
}
