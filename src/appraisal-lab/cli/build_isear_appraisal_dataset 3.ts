/**
 * CLI: Build the ISEAR appraisal dataset.
 *
 * Pipeline:
 *   1. Load raw CSV (eng_dataset.csv)
 *   2. Filter to 5 target emotions
 *   3. Map each row to appraisal vectors
 *   4. Save as JSON
 *   5. Print summary
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/build_isear_appraisal_dataset.ts [csv-path]
 *
 * Arguments:
 *   csv-path  - Path to the CSV file (default: ../dataset/eng_dataset.csv)
 *
 * Output:
 *   Writes isear_appraisal_dataset.json to the dataset/ directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadISEAR, formatDistribution, ISEAR_EMOTIONS } from '../dataset/isear_loader';
import { mapAllToAppraisalRows } from '../dataset/appraisal_mapper';
import { DIMENSION_NAMES } from '../schema';

// ---- Resolve paths ----
const defaultCsvPath = path.resolve(__dirname, '..', 'dataset', 'eng_dataset.csv');
const csvPath = process.argv[2] || defaultCsvPath;
const outPath = path.resolve(__dirname, '..', 'dataset', 'isear_appraisal_dataset.json');

// ---- Step 1 & 2: Load and filter ----
process.stdout.write('=== ISEAR Appraisal Dataset Builder ===\n\n');
process.stdout.write(`Loading CSV: ${csvPath}\n`);

let isearRows;
try {
  isearRows = loadISEAR(csvPath);
} catch (err) {
  process.stderr.write(`\nERROR: ${(err as Error).message}\n`);
  process.exit(1);
}

process.stdout.write(`\nLoaded ${isearRows.length} rows after filtering.\n\n`);
process.stdout.write('Class distribution (filtered):\n');
process.stdout.write(formatDistribution(isearRows) + '\n');

// ---- Step 3: Map to appraisal vectors ----
process.stdout.write('\nMapping to appraisal vectors...\n');

const appraisalRows = mapAllToAppraisalRows(isearRows);

// ---- Step 4: Save JSON ----
fs.writeFileSync(outPath, JSON.stringify(appraisalRows, null, 2), 'utf-8');
process.stdout.write(`\nSaved ${appraisalRows.length} rows → ${outPath}\n`);

// ---- Step 5: Summary ----
process.stdout.write('\n--- Validation Summary ---\n');
process.stdout.write(`Total rows:        ${appraisalRows.length}\n`);

// Emotion distribution
const emotionCounts: Record<string, number> = {};
for (const e of ISEAR_EMOTIONS) emotionCounts[e] = 0;
for (const row of appraisalRows) emotionCounts[row.emotion]++;
process.stdout.write('\nDistribution:\n');
for (const e of ISEAR_EMOTIONS) {
  process.stdout.write(`  ${e.padEnd(10)} ${emotionCounts[e]}\n`);
}

// Confirm all appraisal dimensions present
const presentDimensions = new Set<string>();
for (const row of appraisalRows) {
  for (const dim of DIMENSION_NAMES) {
    if (row.appraisals[dim] !== undefined && row.appraisals[dim] !== null) {
      presentDimensions.add(dim);
    }
  }
}
process.stdout.write(`\nAppraisal dimensions present: ${presentDimensions.size}/6`);
for (const dim of DIMENSION_NAMES) {
  const status = presentDimensions.has(dim) ? 'OK' : 'MISSING';
  process.stdout.write(`\n  ${dim.padEnd(15)} ${status}`);
}

// Emotions present
const presentEmotions = new Set(appraisalRows.map(r => r.emotion));
const missingEmotions = ISEAR_EMOTIONS.filter(e => !presentEmotions.has(e));
process.stdout.write(`\n\nEmotions present:  ${presentEmotions.size}/5`);
if (missingEmotions.length > 0) {
  process.stdout.write(` (missing: ${missingEmotions.join(', ')})`);
}

process.stdout.write('\n\n=== Done ===\n');
