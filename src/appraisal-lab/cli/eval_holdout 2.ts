/**
 * CLI: Evaluate Naive Bayes on the holdout test set.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/eval_holdout.ts
 *
 * Prerequisites:
 *   Run generate_dataset.ts and build_likelihood.ts first.
 *
 * Behavior:
 *   - Loads the generated dataset and likelihood table.
 *   - Splits 80/20 (evaluates on test portion only).
 *   - Prints accuracy, confusion matrix, and average max probability.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AppraisalRow, LikelihoodTable } from '../types';
import { splitDataset, evaluate, formatEvaluationResult } from '../model/metrics';

// Resolve paths
const datasetPath = path.resolve(__dirname, '..', 'dataset', 'dataset.generated.json');
const likelihoodPath = path.resolve(__dirname, '..', 'model', 'likelihood.generated.json');

if (!fs.existsSync(datasetPath)) {
  process.stderr.write(`Dataset not found: ${datasetPath}\n`);
  process.stderr.write("Run generate_dataset.ts first.\n");
  process.exit(1);
}

if (!fs.existsSync(likelihoodPath)) {
  process.stderr.write(`Likelihood table not found: ${likelihoodPath}\n`);
  process.stderr.write("Run build_likelihood.ts first.\n");
  process.exit(1);
}

const dataset: AppraisalRow[] = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
const table: LikelihoodTable = JSON.parse(fs.readFileSync(likelihoodPath, 'utf-8'));

// Use test split (last 20%)
const { test } = splitDataset(dataset, 0.8);

const result = evaluate(test, table);
process.stdout.write(formatEvaluationResult(result) + "\n");
