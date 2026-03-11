/**
 * CLI: Synthetic label-leakage scan.
 *
 * Scans a synthetic (or merged) dataset for emotion-label words that would
 * let a model shortcut through lexical cues.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/leakage_scan.ts [options]
 *
 * Options:
 *   --synthetic <path>   Path to synthetic or merged JSON (default: dataset/synthetic_disgust_neutral.json)
 *
 * Exit codes:
 *   0  clean — no leakage
 *   1  violations found — build should fail
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { scanDataset, formatScanResult } from '../quality/leakage_scan';

// ============================================================
// Argument parsing
// ============================================================

function parseSyntheticPath(argv: string[]): string {
  const baseDir = path.resolve(__dirname, '..');
  const defaultPath = path.join(baseDir, 'dataset', 'synthetic_disgust_neutral.json');

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--synthetic' && argv[i + 1]) {
      return path.resolve(argv[++i]);
    }
  }

  return defaultPath;
}

// ============================================================
// Main
// ============================================================

function main(): void {
  const syntheticPath = parseSyntheticPath(process.argv.slice(2));

  console.log(`Leakage scan: ${syntheticPath}`);
  console.log('');

  const data = JSON.parse(fs.readFileSync(syntheticPath, 'utf-8'));
  if (!Array.isArray(data)) {
    console.error('Error: input file is not a JSON array.');
    process.exit(1);
  }

  const result = scanDataset(data);
  console.log(formatScanResult(result));

  process.exit(result.violations > 0 ? 1 : 0);
}

main();
