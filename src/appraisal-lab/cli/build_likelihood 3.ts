/**
 * CLI: Build likelihood table from the generated dataset.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/build_likelihood.ts
 *
 * Prerequisites:
 *   Run generate_dataset.ts first to create dataset.generated.json.
 *
 * Behavior:
 *   - Loads the generated dataset.
 *   - Splits 80/20 (uses training portion only).
 *   - Builds the likelihood table with Laplace smoothing.
 *   - Writes likelihood.generated.json to the model/ directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AppraisalRow } from '../types';
import { buildLikelihoodTable } from '../model/likelihood_builder';
import { splitDataset } from '../model/metrics';

// Resolve paths relative to this script
const datasetPath = path.resolve(__dirname, '..', 'dataset', 'dataset.generated.json');
const outPath = path.resolve(__dirname, '..', 'model', 'likelihood.generated.json');

if (!fs.existsSync(datasetPath)) {
  process.stderr.write(`Dataset not found: ${datasetPath}\n`);
  process.stderr.write("Run generate_dataset.ts first.\n");
  process.exit(1);
}

const raw = fs.readFileSync(datasetPath, 'utf-8');
const dataset: AppraisalRow[] = JSON.parse(raw);

// Use only training data (first 80%) to build the model
const { train } = splitDataset(dataset, 0.8);
const table = buildLikelihoodTable(train);

fs.writeFileSync(outPath, JSON.stringify(table, null, 2), 'utf-8');

process.stdout.write(`Built likelihood table from ${train.length} training rows → ${outPath}\n`);
