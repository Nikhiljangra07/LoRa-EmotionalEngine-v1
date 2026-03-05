/**
 * Normalize extracted values for anchors: dates to ISO date, money to number.
 * No raw transcripts; only structured values.
 */

export function normalizeDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function normalizeMoney(value: string): number | null {
  const cleaned = value.replace(/,/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? null : n;
}
