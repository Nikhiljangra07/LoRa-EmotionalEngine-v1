/**
 * CLI: Merge ISEAR + synthetic datasets into a single extended dataset
 * with provenance metadata on every row.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/merge_datasets.ts [options]
 *
 * Options:
 *   --isear <path>                ISEAR JSON path (default: dataset/isear_appraisal_dataset.json)
 *   --synthetic <path>            Synthetic JSON path (default: dataset/synthetic_disgust_neutral.json)
 *   --out <path>                  Output path (default: dataset/isear_appraisal_dataset_extended.json)
 *   --synthetic-generator <name>  Generator tag for synthetic rows (default: OPUS_v1)
 *   --dry-run                     Print report only, do not write file
 *   --no-fail-on-collision        Allow ID collisions (default: fail on collision)
 *
 * Exit codes:
 *   0  success
 *   1  validation error or collision detected
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { mergeDatasets, formatReport } from '../dataset/merge_datasets';

// ============================================================
// Argument parsing (lightweight, no external deps)
// ============================================================

interface CliArgs {
  isearPath:          string;
  syntheticPath:      string;
  outPath:            string;
  syntheticGenerator: string;
  dryRun:             boolean;
  failOnCollision:    boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const baseDir = path.resolve(__dirname, '..');

  const defaults: CliArgs = {
    isearPath:          path.join(baseDir, 'dataset', 'isear_appraisal_dataset.json'),
    syntheticPath:      path.join(baseDir, 'dataset', 'synthetic_disgust_neutral.json'),
    outPath:            path.join(baseDir, 'dataset', 'isear_appraisal_dataset_extended.json'),
    syntheticGenerator: 'OPUS_v1',
    dryRun:             false,
    failOnCollision:    true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--isear':
        defaults.isearPath = path.resolve(argv[++i]);
        break;
      case '--synthetic':
        defaults.syntheticPath = path.resolve(argv[++i]);
        break;
      case '--out':
        defaults.outPath = path.resolve(argv[++i]);
        break;
      case '--synthetic-generator':
        defaults.syntheticGenerator = argv[++i];
        break;
      case '--dry-run':
        defaults.dryRun = true;
        break;
      case '--no-fail-on-collision':
        defaults.failOnCollision = false;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  return defaults;
}

// ============================================================
// Main
// ============================================================

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  console.log('Merge datasets');
  console.log(`  ISEAR:      ${args.isearPath}`);
  console.log(`  Synthetic:  ${args.syntheticPath}`);
  console.log(`  Output:     ${args.outPath}`);
  console.log(`  Generator:  ${args.syntheticGenerator}`);
  console.log(`  Dry run:    ${args.dryRun}`);
  console.log(`  Fail on collision: ${args.failOnCollision}`);
  console.log('');

  const isearData = JSON.parse(fs.readFileSync(args.isearPath, 'utf-8'));
  const syntheticData = JSON.parse(fs.readFileSync(args.syntheticPath, 'utf-8'));

  const result = mergeDatasets({
    isearData,
    syntheticData,
    isearPath:          args.isearPath,
    syntheticPath:      args.syntheticPath,
    syntheticGenerator: args.syntheticGenerator,
    failOnCollision:    args.failOnCollision,
  });

  console.log(formatReport(result.report));
  console.log('');

  if (args.dryRun) {
    console.log('Dry run — no file written.');
  } else {
    const json = JSON.stringify(result.rows, null, 2);
    fs.writeFileSync(args.outPath, json + '\n', 'utf-8');
    console.log(`Wrote ${result.rows.length} rows to ${args.outPath}`);
  }
}

main();
