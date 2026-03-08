/**
 * Synthetic label-leakage scanner.
 *
 * Scans synthetic dataset rows for emotion-label words that would let a model
 * shortcut through lexical cues instead of learning appraisal structure.
 *
 * Pure dataset quality gate — zero dependency on inference or model logic.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

// ============================================================
// Result types
// ============================================================

export interface LeakageViolation {
  id: string;
  emotion: string;
  matchedTerms: string[];
}

export interface LeakageScanResult {
  totalRows: number;
  violations: number;
  rowsWithViolations: LeakageViolation[];
}

// ============================================================
// Banlists — word-boundary regex, case-insensitive
// ============================================================

const DISGUST_PATTERNS: RegExp[] = [
  /\bdisgust(ed|ing)?\b/i,
  /\bgross\b/i,
  /\bnasty\b/i,
  /\brepuls(e|ed|ive|ing)?\b/i,
  /\bsickening\b/i,
  /\brevolting\b/i,
  /\bfilthy\b/i,
];

const NEUTRAL_PATTERNS: RegExp[] = [
  /\bneutral\b/i,
  /\bno emotion\b/i,
  /\bemotionless\b/i,
  /\bblank\b/i,
  /\bindifferent\b/i,
];

function patternsForEmotion(emotion: string): RegExp[] {
  switch (emotion.toUpperCase()) {
    case 'DISGUST':  return DISGUST_PATTERNS;
    case 'NEUTRAL':  return NEUTRAL_PATTERNS;
    default:         return [];
  }
}

/** Extract the human-readable token that matched a pattern. */
function extractMatch(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m ? m[0] : null;
}

// ============================================================
// Row abstraction (handles both raw synthetic and merged formats)
// ============================================================

interface ScannableRow {
  id: string;
  emotion: string;
  text: string;
}

/**
 * Normalise any input row into a ScannableRow.
 * Accepts:
 *   - Raw synthetic format: { id, sentiment, content }
 *   - Merged format:        { id, emotion, text, source }
 */
function toScannableRow(raw: Record<string, unknown>): ScannableRow | null {
  const id = String(raw.id ?? '');
  const emotion = String(raw.emotion ?? raw.sentiment ?? '').toUpperCase();
  const text = String(raw.text ?? raw.content ?? '');

  if (!emotion || !text) return null;

  // If this is a merged row, only scan SYNTHETIC sources
  if ('source' in raw && raw.source !== 'SYNTHETIC') return null;

  return { id, emotion, text };
}

// ============================================================
// Core scan
// ============================================================

/** Scan a single row. Returns matched terms (empty array if clean). */
export function scanRow(id: string, emotion: string, text: string): string[] {
  const patterns = patternsForEmotion(emotion);
  const normalised = text.toLowerCase();
  const matched: string[] = [];

  for (const pat of patterns) {
    const token = extractMatch(normalised, pat);
    if (token) matched.push(token);
  }

  return matched;
}

/**
 * Scan an array of dataset rows for label leakage.
 *
 * @param rows - Raw JSON-parsed array (raw synthetic or merged format).
 * @returns Scan result with violation details.
 */
export function scanDataset(rows: unknown[]): LeakageScanResult {
  const violations: LeakageViolation[] = [];
  let scanned = 0;

  for (const raw of rows) {
    const row = toScannableRow(raw as Record<string, unknown>);
    if (!row) continue;

    scanned++;
    const matched = scanRow(row.id, row.emotion, row.text);
    if (matched.length > 0) {
      violations.push({
        id: row.id,
        emotion: row.emotion,
        matchedTerms: matched,
      });
    }
  }

  return {
    totalRows: scanned,
    violations: violations.length,
    rowsWithViolations: violations,
  };
}

// ============================================================
// Report formatting
// ============================================================

export function formatScanResult(result: LeakageScanResult, maxDisplay = 10): string {
  const lines: string[] = [];

  if (result.violations > 0) {
    lines.push('❌ Leakage detected.');
  } else {
    lines.push('✔ Synthetic dataset passed leakage scan.');
  }

  lines.push(`Rows scanned: ${result.totalRows}`);
  lines.push(`Violations: ${result.violations}`);

  if (result.violations > 0) {
    lines.push('');
    const show = result.rowsWithViolations.slice(0, maxDisplay);
    for (const v of show) {
      lines.push(`Row ID: ${v.id}`);
      lines.push(`Emotion: ${v.emotion}`);
      lines.push(`Matched: ${v.matchedTerms.join(', ')}`);
      lines.push('');
    }
    if (result.violations > maxDisplay) {
      lines.push(`... and ${result.violations - maxDisplay} more.`);
      lines.push('');
    }
    lines.push('Build failed.');
  }

  return lines.join('\n');
}
