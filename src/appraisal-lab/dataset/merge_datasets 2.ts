/**
 * Merge module for combining ISEAR and synthetic datasets into a single
 * extended dataset with provenance metadata on every row.
 *
 * Responsibilities:
 *   1. Load and validate both source JSON files
 *   2. Normalize IDs with collision-free prefixes
 *   3. Inject provenance fields (source, generator, created_at)
 *   4. Map synthetic rows (sentiment/content) to the merged schema
 *   5. Concatenate ISEAR-first, synthetic-second (stable order)
 *   6. Write pretty-printed JSON output
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import * as crypto from 'crypto';
import {
  AppraisalRow,
  AppraisalVector,
  MergedAppraisalRow,
  DataSource,
} from '../types';
import { validateRow, validateMergedRow, MERGED_EMOTIONS } from '../schema';

// ============================================================
// Synthetic raw row shape (as stored in synthetic JSON)
// ============================================================

export interface SyntheticRawRow {
  id: string;
  sentiment: string;
  content: string;
}

// ============================================================
// Locked appraisal vectors for synthetic emotions (from DESIGN.md §3)
// ============================================================

const SYNTHETIC_APPRAISAL_MAP: Record<string, AppraisalVector> = {
  DISGUST: {
    valence:       "NEG",
    arousal:       "MED",
    agency:        "SITUATION",
    control:       "LOW",
    certainty:     "HIGH",
    goalRelevance: "HIGH",
  },
  NEUTRAL: {
    valence:       "NEU",
    arousal:       "LOW",
    agency:        "SITUATION",
    control:       "MED",
    certainty:     "HIGH",
    goalRelevance: "LOW",
  },
};

// ============================================================
// ID helpers
// ============================================================

/** Lowercase, collapse whitespace, trim — used for deterministic hash IDs. */
export function normalizeTextForId(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Generate a deterministic ID from text + emotion + index.
 * Uses SHA-256 truncated to 12 hex chars for compactness.
 */
export function generateDeterministicId(
  text: string,
  emotion: string,
  index: number,
): string {
  const input = `${normalizeTextForId(text)}|${emotion}|${index}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return hash.slice(0, 12);
}

/**
 * Apply the required source prefix to an ID.
 * - ISEAR rows: keep as-is if already starts with "ISEAR", else prepend "ISEAR_"
 * - SYNTHETIC rows: keep as-is if already starts with "SYN_", else prepend "SYN_"
 */
export function prefixId(id: string, source: DataSource): string {
  if (source === "ISEAR") {
    return id.startsWith("ISEAR") ? id : `ISEAR_${id}`;
  }
  return id.startsWith("SYN_") ? id : `SYN_${id}`;
}

// ============================================================
// Row conversion
// ============================================================

/** Add provenance to an existing ISEAR AppraisalRow. */
export function injectISEARProvenance(
  row: AppraisalRow,
  index: number,
): MergedAppraisalRow {
  const id = row.id
    ? prefixId(row.id, "ISEAR")
    : prefixId(generateDeterministicId(row.text, row.emotion, index), "ISEAR");

  return {
    id,
    text:       row.text,
    emotion:    row.emotion,
    appraisals: { ...row.appraisals },
    source:     "ISEAR",
    generator:  null,
    created_at: null,
  };
}

/**
 * Convert a synthetic raw row to MergedAppraisalRow.
 * Maps sentiment→emotion, content→text, applies locked appraisal vector.
 */
export function convertSyntheticRow(
  raw: SyntheticRawRow,
  index: number,
  generator: string,
): MergedAppraisalRow {
  const emotionKey = raw.sentiment.toUpperCase();
  const appraisals = SYNTHETIC_APPRAISAL_MAP[emotionKey];
  if (!appraisals) {
    throw new Error(
      `[synthetic row ${index}] Unknown sentiment "${raw.sentiment}" — ` +
      `expected one of: ${Object.keys(SYNTHETIC_APPRAISAL_MAP).join(', ')}`,
    );
  }

  const id = raw.id
    ? prefixId(raw.id, "SYNTHETIC")
    : prefixId(
        generateDeterministicId(raw.content, emotionKey, index),
        "SYNTHETIC",
      );

  return {
    id,
    text:       raw.content,
    emotion:    emotionKey as MergedAppraisalRow['emotion'],
    appraisals: { ...appraisals },
    source:     "SYNTHETIC",
    generator,
    created_at: null,
  };
}

// ============================================================
// Input validation
// ============================================================

function assertIsArray(data: unknown, label: string): void {
  if (!Array.isArray(data)) {
    throw new Error(`${label}: expected JSON array, got ${typeof data}`);
  }
}

function validateISEARInput(rows: unknown[], filePath: string): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as AppraisalRow;
    if (!row.text || typeof row.text !== 'string') {
      throw new Error(`[${filePath} row ${i}] missing or invalid "text" field`);
    }
    if (!row.emotion || typeof row.emotion !== 'string') {
      throw new Error(`[${filePath} row ${i}] missing or invalid "emotion" field`);
    }
    if (!row.appraisals || typeof row.appraisals !== 'object') {
      throw new Error(`[${filePath} row ${i}] missing or invalid "appraisals" field`);
    }
    // Validate schema fields except id (id may be empty/missing and will be
    // generated deterministically during merge).
    const withTempId = { ...row, id: row.id || '__temp__' };
    if (!validateRow(withTempId as AppraisalRow)) {
      throw new Error(`[${filePath} row ${i}] fails schema validation (id="${row.id}", emotion="${row.emotion}")`);
    }
  }
}

function validateSyntheticInput(rows: unknown[], filePath: string): void {
  const allowedSentiments = new Set(Object.keys(SYNTHETIC_APPRAISAL_MAP));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as SyntheticRawRow;
    if (!row.content || typeof row.content !== 'string') {
      throw new Error(`[${filePath} row ${i}] missing or invalid "content" field`);
    }
    if (!row.sentiment || typeof row.sentiment !== 'string') {
      throw new Error(`[${filePath} row ${i}] missing or invalid "sentiment" field`);
    }
    if (!allowedSentiments.has(row.sentiment.toUpperCase())) {
      throw new Error(
        `[${filePath} row ${i}] unknown sentiment "${row.sentiment}" — ` +
        `expected: ${[...allowedSentiments].join(', ')}`,
      );
    }
  }
}

// ============================================================
// Merge report
// ============================================================

export interface MergeReport {
  isear_count:      number;
  synthetic_count:  number;
  merged_total:     number;
  unique_id_count:  number;
  collision_count:  number;
  provenance_completeness: {
    source_present:     number;
    generator_present:  number;
    created_at_present: number;
  };
  emotion_distribution: Record<string, number>;
}

function buildReport(merged: MergedAppraisalRow[]): MergeReport {
  const idSet = new Set<string>();
  let sourcePresent = 0;
  let generatorPresent = 0;
  let createdAtPresent = 0;
  const emotionDist: Record<string, number> = {};
  let isearCount = 0;
  let syntheticCount = 0;

  for (const row of merged) {
    idSet.add(row.id);
    if (row.source) sourcePresent++;
    if (row.generator !== null && row.generator !== undefined) generatorPresent++;
    if (row.created_at !== null && row.created_at !== undefined) createdAtPresent++;
    emotionDist[row.emotion] = (emotionDist[row.emotion] || 0) + 1;
    if (row.source === "ISEAR") isearCount++;
    else syntheticCount++;
  }

  return {
    isear_count:      isearCount,
    synthetic_count:  syntheticCount,
    merged_total:     merged.length,
    unique_id_count:  idSet.size,
    collision_count:  merged.length - idSet.size,
    provenance_completeness: {
      source_present:     sourcePresent,
      generator_present:  generatorPresent,
      created_at_present: createdAtPresent,
    },
    emotion_distribution: emotionDist,
  };
}

export function formatReport(report: MergeReport): string {
  const pct = (n: number, total: number) =>
    total === 0 ? '0.0' : ((n / total) * 100).toFixed(1);

  const lines: string[] = [
    '=== Merge Report ===',
    `  ISEAR rows:      ${report.isear_count}`,
    `  Synthetic rows:  ${report.synthetic_count}`,
    `  Merged total:    ${report.merged_total}`,
    '',
    `  Unique IDs:      ${report.unique_id_count}`,
    `  Collisions:      ${report.collision_count}`,
    '',
    '  Provenance completeness:',
    `    source:     ${pct(report.provenance_completeness.source_present, report.merged_total)}%`,
    `    generator:  ${pct(report.provenance_completeness.generator_present, report.merged_total)}%`,
    `    created_at: ${pct(report.provenance_completeness.created_at_present, report.merged_total)}%`,
    '',
    '  Emotion distribution:',
  ];

  const sorted = Object.entries(report.emotion_distribution)
    .sort(([, a], [, b]) => b - a);
  for (const [emotion, count] of sorted) {
    lines.push(`    ${emotion.padEnd(10)} ${count}`);
  }

  return lines.join('\n');
}

// ============================================================
// Main merge function
// ============================================================

export interface MergeConfig {
  isearData:   unknown;
  syntheticData: unknown;
  isearPath:   string;
  syntheticPath: string;
  syntheticGenerator: string;
  failOnCollision: boolean;
}

export interface MergeResult {
  rows:   MergedAppraisalRow[];
  report: MergeReport;
}

export function mergeDatasets(config: MergeConfig): MergeResult {
  const {
    isearData,
    syntheticData,
    isearPath,
    syntheticPath,
    syntheticGenerator,
    failOnCollision,
  } = config;

  assertIsArray(isearData, isearPath);
  assertIsArray(syntheticData, syntheticPath);

  const isearArr = isearData as AppraisalRow[];
  const syntheticArr = syntheticData as SyntheticRawRow[];

  validateISEARInput(isearArr, isearPath);
  validateSyntheticInput(syntheticArr, syntheticPath);

  const merged: MergedAppraisalRow[] = [];

  for (let i = 0; i < isearArr.length; i++) {
    merged.push(injectISEARProvenance(isearArr[i], i));
  }

  for (let i = 0; i < syntheticArr.length; i++) {
    merged.push(convertSyntheticRow(syntheticArr[i], i, syntheticGenerator));
  }

  const report = buildReport(merged);

  if (failOnCollision && report.collision_count > 0) {
    throw new Error(
      `ID collision detected: ${report.collision_count} collisions in ${report.merged_total} rows. ` +
      `Unique IDs: ${report.unique_id_count}`,
    );
  }

  for (let i = 0; i < merged.length; i++) {
    if (!validateMergedRow(merged[i])) {
      throw new Error(
        `Merged row ${i} (id="${merged[i].id}") fails schema validation`,
      );
    }
  }

  return { rows: merged, report };
}
