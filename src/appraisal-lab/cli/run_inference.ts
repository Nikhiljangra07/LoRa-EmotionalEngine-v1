/**
 * CLI: Run Naive Bayes inference on a single row by ID.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/run_inference.ts <row-id>
 *
 * Example:
 *   npx ts-node src/appraisal-lab/cli/run_inference.ts APR-0001
 *
 * Prerequisites:
 *   Run generate_dataset.ts and build_likelihood.ts first.
 *
 * Behavior:
 *   - Loads the generated dataset and likelihood table.
 *   - Finds the specified row by ID.
 *   - Runs inference and prints the full posterior distribution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AppraisalRow, LikelihoodTable, Emotion } from '../types';
import { EMOTIONS } from '../schema';
import { infer } from '../model/nb_inference';
import { applyReliabilityGate } from '../model/reliability_gate';
import { inferWithCalibration, CalibrationOptions } from '../model/calibrated_inference';

// ---- Parse arguments ----
const rowId = process.argv[2];
if (!rowId) {
  process.stderr.write("Usage: run_inference.ts <row-id>\n");
  process.stderr.write("Example: run_inference.ts APR-0001\n");
  process.exit(1);
}

// ---- Resolve paths ----
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

// ---- Load data ----
const dataset: AppraisalRow[] = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
const table: LikelihoodTable = JSON.parse(fs.readFileSync(likelihoodPath, 'utf-8'));

// ---- Find the row ----
const row = dataset.find(r => r.id === rowId);
if (!row) {
  process.stderr.write(`Row not found: ${rowId}\n`);
  process.stderr.write(`Valid IDs range from APR-0001 to APR-${String(dataset.length).padStart(4, '0')}\n`);
  process.exit(1);
}

// ---- Parse calibration flags ----
const calOpts: CalibrationOptions = {};
const argv = process.argv.slice(3);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--temperature' && argv[i + 1]) {
    calOpts.temperature = parseFloat(argv[++i]);
  } else if (argv[i].startsWith('--weight-') && argv[i + 1]) {
    const dim = argv[i].slice('--weight-'.length);
    const dimLower = dim.charAt(0).toLowerCase() + dim.slice(1);
    calOpts.dimensionWeights = calOpts.dimensionWeights ?? {};
    calOpts.dimensionWeights[dimLower] = parseFloat(argv[++i]);
  }
}
const hasCalibration = calOpts.temperature !== undefined || calOpts.dimensionWeights !== undefined;

// ---- Run inference ----
const result = infer(row.appraisals, table);

// ---- Print results ----
const lines: string[] = [];
lines.push(`=== Inference for ${row.id} ===`);
lines.push("");
lines.push(`Text:    "${row.text}"`);
lines.push(`Gold:    ${row.emotion}`);
lines.push("");
lines.push("Appraisals:");
lines.push(`  Valence:        ${row.appraisals.valence}`);
lines.push(`  Arousal:        ${row.appraisals.arousal}`);
lines.push(`  Agency:         ${row.appraisals.agency}`);
lines.push(`  Control:        ${row.appraisals.control}`);
lines.push(`  Certainty:      ${row.appraisals.certainty}`);
lines.push(`  Goal Relevance: ${row.appraisals.goalRelevance}`);
lines.push("");
lines.push("Posterior Distribution:");

// Sort by probability descending for readability
const sorted = EMOTIONS
  .map((e: Emotion) => ({ emotion: e, prob: result.distribution[e] }))
  .sort((a, b) => b.prob - a.prob);

for (const entry of sorted) {
  const bar = "#".repeat(Math.round(entry.prob * 40));
  const marker = entry.emotion === result.predicted ? " ←" : "";
  lines.push(`  ${entry.emotion.padEnd(10)} ${(entry.prob * 100).toFixed(2).padStart(6)}%  ${bar}${marker}`);
}

lines.push("");
lines.push(`Predicted: ${result.predicted} (confidence: ${(result.confidence * 100).toFixed(2)}%)`);
lines.push(`Match:     ${result.predicted === row.emotion ? "CORRECT" : "INCORRECT"}`);
// ---- Calibrated posterior (if flags provided) ----
if (hasCalibration) {
  const calDist = inferWithCalibration(row.appraisals, table, calOpts);
  lines.push("");
  lines.push(`Calibrated Posterior (T=${calOpts.temperature ?? 1}${calOpts.dimensionWeights ? ', custom weights' : ''}):`);
  const calSorted = EMOTIONS
    .map((e: Emotion) => ({ emotion: e, prob: calDist[e] }))
    .sort((a, b) => b.prob - a.prob);
  for (const entry of calSorted) {
    const bar = "#".repeat(Math.round(entry.prob * 40));
    lines.push(`  ${entry.emotion.padEnd(10)} ${(entry.prob * 100).toFixed(2).padStart(6)}%  ${bar}`);
  }
}

const gate = applyReliabilityGate(result.distribution);
lines.push("");
lines.push("Reliability Gate:");
lines.push(`  pmax:         ${gate.pmax.toFixed(4)}`);
lines.push(`  margin:       ${gate.margin.toFixed(4)}`);
lines.push(`  entropyNorm:  ${gate.entropyNorm.toFixed(4)}`);
lines.push(`  decision:     ${gate.decision}`);

lines.push("");
lines.push("=== End ===");

process.stdout.write(lines.join("\n") + "\n");
