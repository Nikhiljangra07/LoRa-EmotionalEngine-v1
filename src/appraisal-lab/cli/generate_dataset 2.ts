/**
 * CLI: Generate a synthetic appraisal dataset.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/generate_dataset.ts [seed] [n]
 *
 * Arguments:
 *   seed  - Integer PRNG seed (default: 42)
 *   n     - Number of rows to generate (default: 900)
 *
 * Output:
 *   Writes dataset.generated.json to the dataset/ directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateDataset } from '../dataset/generator';

const DEFAULT_SEED = 42;
const DEFAULT_N = 900;

const seed = parseInt(process.argv[2] || String(DEFAULT_SEED), 10);
const n = parseInt(process.argv[3] || String(DEFAULT_N), 10);

if (isNaN(seed) || isNaN(n) || n <= 0) {
  process.stderr.write("Usage: generate_dataset.ts [seed] [n]\n");
  process.stderr.write("  seed: integer PRNG seed (default 42)\n");
  process.stderr.write("  n:    number of rows (default 900, must be > 0)\n");
  process.exit(1);
}

const dataset = generateDataset(seed, n);
const outPath = path.resolve(__dirname, '..', 'dataset', 'dataset.generated.json');

fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf-8');

process.stdout.write(`Generated ${dataset.length} rows (seed=${seed}) → ${outPath}\n`);
