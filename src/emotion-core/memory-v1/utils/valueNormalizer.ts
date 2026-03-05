/**
 * Normalize extracted values for anchors: dates to ISO date, money to number.
 * No raw transcripts; only structured values.
 */

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/** Parse "23rd March 2026", "23 March 2026", "March 23 2026" etc. to YYYY-MM-DD. */
function parseDateDeterministic(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  // Strip ordinals: 23rd -> 23, 1st -> 1, 2nd -> 2
  const noOrdinal = trimmed.replace(/(\d+)(st|nd|rd|th)\b/g, '$1');
  const parts = noOrdinal.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  for (const p of parts) {
    const num = parseInt(p, 10);
    if (!Number.isNaN(num)) {
      if (num >= 1 && num <= 31 && day === null) day = num;
      else if (num >= 1000 && num <= 9999 && year === null) year = num;
    } else if (MONTH_NAMES[p]) {
      if (month === null) month = MONTH_NAMES[p];
    }
  }

  if (day === null || month === null || year === null) return null;
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function normalizeDate(value: string): string | null {
  let date = new Date(value);
  if (!Number.isNaN(date.getTime()))
    return date.toISOString().slice(0, 10);
  return parseDateDeterministic(value);
}

export function normalizeMoney(value: string): number | null {
  const cleaned = value.replace(/,/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? null : n;
}
