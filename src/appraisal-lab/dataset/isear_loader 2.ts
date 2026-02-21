/**
 * ISEAR dataset loader for the Appraisal Lab.
 *
 * Reads a CSV file (e.g. eng_dataset.csv), auto-detects columns,
 * normalizes emotion labels, filters to the 5 target emotions,
 * validates the result, and returns structured ISEARRow[].
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import * as fs from 'fs';
import { Emotion } from '../types';

// ============================================================
// Types
// ============================================================

/** A single row loaded from the ISEAR CSV (before appraisal mapping). */
export interface ISEARRow {
  id: string;
  text: string;
  emotion: Emotion;
}

// ============================================================
// Constants
// ============================================================

/** The 5 ISEAR-relevant emotions (subset of the 6 locked emotions). */
export const ISEAR_EMOTIONS: readonly Emotion[] = [
  "ANGER", "FEAR", "DISGUST", "JOY", "SADNESS",
] as const;

/** Emotions to explicitly drop from ISEAR. */
const DROP_LABELS = new Set(["SHAME", "GUILT"]);

/** Minimum total rows required after filtering. */
const MIN_ROWS = 3000;

// ============================================================
// CSV Parser (handles quoted fields with commas)
// ============================================================

/**
 * Parse a CSV string into a 2D array of fields.
 * Handles double-quoted fields containing commas and escaped quotes ("").
 * Conforms to RFC 4180 basics.
 */
export function parseCSV(content: string): string[][] {
  // Strip UTF-8 BOM if present
  const src = content.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const row: string[] = [];

    // Parse one row
    while (i < len) {
      if (src[i] === '"') {
        // --- Quoted field ---
        i++; // skip opening quote
        let field = '';
        while (i < len) {
          if (src[i] === '"') {
            if (i + 1 < len && src[i + 1] === '"') {
              // Escaped quote
              field += '"';
              i += 2;
            } else {
              // Closing quote
              i++;
              break;
            }
          } else {
            field += src[i];
            i++;
          }
        }
        row.push(field);
      } else {
        // --- Unquoted field ---
        let field = '';
        while (i < len && src[i] !== ',' && src[i] !== '\n' && src[i] !== '\r') {
          field += src[i];
          i++;
        }
        row.push(field);
      }

      // After a field: comma → next field; otherwise → end of row
      if (i < len && src[i] === ',') {
        i++;
      } else {
        break;
      }
    }

    // Skip line ending
    if (i < len && src[i] === '\r') i++;
    if (i < len && src[i] === '\n') i++;

    // Only add non-empty rows
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

// ============================================================
// Column auto-detection
// ============================================================

/** Patterns for the emotion/sentiment column (case-insensitive exact match). */
const EMOTION_COLUMN_NAMES = ["emotion", "sentiment", "feeling", "label"];

/** Patterns for the text/content column (case-insensitive exact match). */
const TEXT_COLUMN_NAMES = ["text", "content", "situation", "sentence", "utterance"];

/**
 * Find the index of a column whose header matches one of the given patterns.
 * Returns -1 if no match is found.
 */
function findColumnIndex(headers: string[], patterns: string[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex(
      h => h.trim().toLowerCase() === pattern.toLowerCase(),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

// ============================================================
// Validation
// ============================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateLoadedRows(rows: ISEARRow[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check minimum row count
  if (rows.length < MIN_ROWS) {
    errors.push(
      `Insufficient rows: got ${rows.length}, minimum required is ${MIN_ROWS}.`,
    );
  }

  // Check for empty text
  const emptyTextCount = rows.filter(r => r.text.trim().length === 0).length;
  if (emptyTextCount > 0) {
    errors.push(`Found ${emptyTextCount} rows with empty text.`);
  }

  // Check that all emotion labels are in the allowed set
  const emotionSet = new Set(ISEAR_EMOTIONS as readonly string[]);
  const unknownLabels = new Set<string>();
  for (const row of rows) {
    if (!emotionSet.has(row.emotion)) {
      unknownLabels.add(row.emotion);
    }
  }
  if (unknownLabels.size > 0) {
    errors.push(
      `Unknown emotion labels found: ${[...unknownLabels].join(', ')}.`,
    );
  }

  // Check which of the 5 target emotions are present
  const presentEmotions = new Set(rows.map(r => r.emotion));
  const missingEmotions = ISEAR_EMOTIONS.filter(e => !presentEmotions.has(e));
  if (missingEmotions.length > 0) {
    warnings.push(
      `Missing ${missingEmotions.length} of 5 target emotions in source data: ${missingEmotions.join(', ')}. ` +
      `This is expected if the CSV does not contain all ISEAR emotion categories.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================
// Distribution summary
// ============================================================

/** Build and return a human-readable distribution summary string. */
export function formatDistribution(rows: ISEARRow[]): string {
  const counts: Record<string, number> = {};
  for (const e of ISEAR_EMOTIONS) counts[e] = 0;
  for (const row of rows) counts[row.emotion]++;

  const lines: string[] = [];
  lines.push(`TOTAL: ${rows.length}`);
  for (const e of ISEAR_EMOTIONS) {
    lines.push(`${e}: ${counts[e]}`);
  }
  return lines.join('\n');
}

// ============================================================
// Main loader
// ============================================================

/**
 * Load and validate an ISEAR-style CSV dataset.
 *
 * @param csvPath - Absolute or relative path to the CSV file.
 * @returns Array of validated ISEARRow objects.
 * @throws If the file cannot be read or validation fails.
 */
export function loadISEAR(csvPath: string): ISEARRow[] {
  // 1. Read file
  if (!fs.existsSync(csvPath)) {
    throw new Error(`ISEAR CSV not found: ${csvPath}`);
  }
  const raw = fs.readFileSync(csvPath, 'utf-8');

  // 2. Parse CSV
  const allRows = parseCSV(raw);
  if (allRows.length < 2) {
    throw new Error('CSV file has no data rows.');
  }

  // 3. Auto-detect columns
  const headers = allRows[0].map(h => h.trim());
  const emotionIdx = findColumnIndex(headers, EMOTION_COLUMN_NAMES);
  const textIdx = findColumnIndex(headers, TEXT_COLUMN_NAMES);

  if (emotionIdx === -1) {
    throw new Error(
      `Could not detect emotion column. Headers found: [${headers.join(', ')}]. ` +
      `Expected one of: ${EMOTION_COLUMN_NAMES.join(', ')}.`,
    );
  }
  if (textIdx === -1) {
    throw new Error(
      `Could not detect text column. Headers found: [${headers.join(', ')}]. ` +
      `Expected one of: ${TEXT_COLUMN_NAMES.join(', ')}.`,
    );
  }

  // Detect ID column (optional — first column named "id", or fallback to index 0)
  let idIdx = headers.findIndex(h => h.toLowerCase() === 'id');
  if (idIdx === -1) idIdx = 0; // fallback: treat first column as ID

  // 4. Parse data rows, normalize labels, filter
  const allowedSet = new Set(ISEAR_EMOTIONS as readonly string[]);
  const result: ISEARRow[] = [];
  let droppedCount = 0;
  let emptySkipped = 0;

  for (let r = 1; r < allRows.length; r++) {
    const fields = allRows[r];
    if (fields.length <= Math.max(emotionIdx, textIdx)) {
      continue; // malformed row
    }

    const rawEmotion = fields[emotionIdx].trim().toUpperCase();
    const text = fields[textIdx].trim();
    const id = fields[idIdx]?.trim() || String(r);

    // Skip empty text
    if (text.length === 0) {
      emptySkipped++;
      continue;
    }

    // Drop SHAME, GUILT, and any non-target label
    if (DROP_LABELS.has(rawEmotion) || !allowedSet.has(rawEmotion)) {
      droppedCount++;
      continue;
    }

    result.push({
      id: `ISEAR-${id}`,
      text,
      emotion: rawEmotion as Emotion,
    });
  }

  // 5. Validate
  const validation = validateLoadedRows(result);
  if (!validation.valid) {
    throw new Error(
      `ISEAR validation failed:\n  ${validation.errors.join('\n  ')}`,
    );
  }

  // 6. Emit warnings to stderr (non-blocking)
  for (const w of validation.warnings) {
    process.stderr.write(`[ISEAR WARN] ${w}\n`);
  }

  return result;
}
