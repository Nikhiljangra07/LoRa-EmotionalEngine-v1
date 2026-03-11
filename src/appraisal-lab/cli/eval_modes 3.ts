/**
 * CLI: Multi-mode evaluation harness for Naive Bayes emotion classification.
 *
 * Runs the existing NB pipeline in 3 modes:
 *   real      — ISEAR 4-emotion baseline
 *   synthetic — DISGUST + NEUTRAL structural compatibility check
 *   merged    — Supported-label evaluation on extended dataset
 *
 * Does NOT modify inference, likelihood estimation, or schema.
 * Evaluation-only module.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/eval_modes.ts --mode real
 *   npx ts-node src/appraisal-lab/cli/eval_modes.ts --mode synthetic
 *   npx ts-node src/appraisal-lab/cli/eval_modes.ts --mode merged
 *   npx ts-node src/appraisal-lab/cli/eval_modes.ts               (all 3)
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AppraisalRow } from '../types';
import { EMOTIONS } from '../schema';
import { buildLikelihoodTable } from '../model/likelihood_builder';
import { infer } from '../model/nb_inference';
import { splitDataset } from '../model/metrics';

// ============================================================
// Supported-label set (read-only snapshot from schema)
// ============================================================

const SUPPORTED_LABELS: ReadonlySet<string> = new Set(EMOTIONS as readonly string[]);

// ============================================================
// Deterministic seeded shuffle (LCG + Fisher-Yates)
// ============================================================

/**
 * Deterministic shuffle using an LCG PRNG (same parameters as the
 * project's SeededRNG in dataset/generator.ts) with Fisher-Yates.
 * Returns a new array; does not mutate the input.
 */
export function seededShuffle<T>(array: T[], seed: number): T[] {
  const out = array.slice();
  let state = (seed >>> 0) || 1;

  function nextFloat(): number {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  }

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }

  return out;
}

// ============================================================
// Result types (local to eval harness)
// ============================================================

export interface ClassMetrics {
  precision: number;
  recall: number;
  support: number;
}

export interface EvalModeResult {
  mode: string;
  totalRows: number;
  supportedRows: number;
  unsupportedRows: number;
  unsupportedLabels: string[];
  trainRows: number;
  testRows: number;
  accuracy: number;
  avgMaxProbability: number;
  labels: string[];
  confusionMatrix: Record<string, Record<string, number>>;
  perClass: Record<string, ClassMetrics>;
  structuralOnly: boolean;
  warnings: string[];
}

// ============================================================
// Label partitioning
// ============================================================

export function partitionBySupport(data: AppraisalRow[]): {
  supported: AppraisalRow[];
  unsupported: AppraisalRow[];
  unsupportedLabels: string[];
} {
  const supported: AppraisalRow[] = [];
  const unsupported: AppraisalRow[] = [];
  const unsupportedLabelSet = new Set<string>();

  for (const row of data) {
    if (SUPPORTED_LABELS.has(row.emotion)) {
      supported.push(row);
    } else {
      unsupported.push(row);
      unsupportedLabelSet.add(row.emotion);
    }
  }

  return {
    supported,
    unsupported,
    unsupportedLabels: [...unsupportedLabelSet].sort(),
  };
}

// ============================================================
// Local confusion matrix (supports any label set)
// ============================================================

export function buildLocalConfusionMatrix(
  actuals: string[],
  predictions: string[],
  labels: string[],
): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const a of labels) {
    matrix[a] = {};
    for (const p of labels) {
      matrix[a][p] = 0;
    }
  }
  for (let i = 0; i < actuals.length; i++) {
    const a = actuals[i];
    const p = predictions[i];
    if (matrix[a]) {
      matrix[a][p] = (matrix[a][p] ?? 0) + 1;
    }
  }
  return matrix;
}

// ============================================================
// Per-class precision / recall from confusion matrix
// ============================================================

export function computePerClassMetrics(
  matrix: Record<string, Record<string, number>>,
  labels: string[],
): Record<string, ClassMetrics> {
  const result: Record<string, ClassMetrics> = {};

  for (const c of labels) {
    const tp = matrix[c]?.[c] ?? 0;
    let fp = 0;
    let fn = 0;
    let support = 0;

    for (const label of labels) {
      support += matrix[c]?.[label] ?? 0;
      if (label !== c) {
        fp += matrix[label]?.[c] ?? 0;
        fn += matrix[c]?.[label] ?? 0;
      }
    }

    result[c] = {
      precision: (tp + fp) > 0 ? tp / (tp + fp) : 0,
      recall: support > 0 ? tp / support : 0,
      support,
    };
  }

  return result;
}

// ============================================================
// Core evaluation (reuses existing model functions)
// ============================================================

const DEFAULT_SEED = 2024;

export function runEvaluation(
  data: AppraisalRow[],
  mode: string,
  seed: number = DEFAULT_SEED,
): EvalModeResult {
  const { supported, unsupported, unsupportedLabels } = partitionBySupport(data);
  const warnings: string[] = [];

  // -- Synthetic-only: all rows may be unsupported -------------------
  if (mode === 'synthetic' && supported.length === 0) {
    warnings.push(
      'Synthetic-only mode contains labels not supported by current model. ' +
      'This is a compatibility check, not performance evaluation.',
    );
    if (unsupportedLabels.length > 0) {
      warnings.push(
        'WARNING: Some labels are not part of current EMOTIONS enum. ' +
        'Results reflect Layer-1 structural limitations.',
      );
    }

    const shuffled = seededShuffle(data, seed);
    const { train, test } = splitDataset(shuffled as AppraisalRow[], 0.8);

    if (test.length === 0) {
      throw new Error(`Empty test split in mode "${mode}" (${data.length} total rows).`);
    }

    const table = buildLikelihoodTable(train);
    const actuals: string[] = [];
    const predictions: string[] = [];
    let sumMaxProb = 0;

    for (const row of test) {
      const result = infer(row.appraisals, table);
      actuals.push(row.emotion);
      predictions.push(result.predicted);
      sumMaxProb += result.confidence;
    }

    const labelSet = new Set([...actuals, ...predictions]);
    const labels = [...labelSet].sort();
    const cm = buildLocalConfusionMatrix(actuals, predictions, labels);
    const perClass = computePerClassMetrics(cm, labels);

    let correct = 0;
    for (let i = 0; i < actuals.length; i++) {
      if (actuals[i] === predictions[i]) correct++;
    }

    return {
      mode,
      totalRows: data.length,
      supportedRows: supported.length,
      unsupportedRows: unsupported.length,
      unsupportedLabels,
      trainRows: train.length,
      testRows: test.length,
      accuracy: correct / test.length,
      avgMaxProbability: sumMaxProb / test.length,
      labels,
      confusionMatrix: cm,
      perClass,
      structuralOnly: true,
      warnings,
    };
  }

  // -- Real / Merged: evaluate ONLY on supported rows ---------------
  if (unsupportedLabels.length > 0) {
    warnings.push(
      'WARNING: Some labels are not part of current EMOTIONS enum. ' +
      'Results reflect Layer-1 structural limitations.',
    );
    warnings.push(
      `Unsupported labels excluded from evaluation: ${unsupportedLabels.join(', ')}`,
    );
  }

  const evalData = supported;

  if (evalData.length < 5) {
    throw new Error(
      `Too few supported rows (${evalData.length}) for 80/20 split in mode "${mode}".`,
    );
  }

  const shuffled = seededShuffle(evalData, seed);
  const { train, test } = splitDataset(shuffled as AppraisalRow[], 0.8);

  if (test.length === 0) {
    throw new Error(`Empty test split in mode "${mode}" (${evalData.length} supported rows).`);
  }

  const table = buildLikelihoodTable(train);

  const actuals: string[] = [];
  const predictions: string[] = [];
  let sumMaxProb = 0;

  for (const row of test) {
    const result = infer(row.appraisals, table);
    actuals.push(row.emotion);
    predictions.push(result.predicted);
    sumMaxProb += result.confidence;
  }

  const labelSet = new Set([...actuals, ...predictions]);
  const labels = [...labelSet].sort();

  const cm = buildLocalConfusionMatrix(actuals, predictions, labels);
  const perClass = computePerClassMetrics(cm, labels);

  let correct = 0;
  for (let i = 0; i < actuals.length; i++) {
    if (actuals[i] === predictions[i]) correct++;
  }

  return {
    mode,
    totalRows: data.length,
    supportedRows: supported.length,
    unsupportedRows: unsupported.length,
    unsupportedLabels,
    trainRows: train.length,
    testRows: test.length,
    accuracy: correct / test.length,
    avgMaxProbability: sumMaxProb / test.length,
    labels,
    confusionMatrix: cm,
    perClass,
    structuralOnly: false,
    warnings,
  };
}

// ============================================================
// Formatting
// ============================================================

export function formatModeResult(result: EvalModeResult): string {
  const lines: string[] = [];

  lines.push(`=== MODE: ${result.mode.toUpperCase()} ===`);

  if (result.structuralOnly) {
    lines.push('*** STRUCTURAL LIMITATION — this is a compatibility check, not performance evaluation ***');
  }

  for (const w of result.warnings) {
    lines.push(w);
  }

  lines.push(`Total rows: ${result.totalRows}`);
  lines.push(`Supported rows: ${result.supportedRows}`);
  if (result.unsupportedRows > 0) {
    const labelNote = result.unsupportedLabels.join(', ');
    lines.push(
      `Unsupported rows: ${result.unsupportedRows} (${labelNote} not supported in Layer-1)`,
    );
  }
  lines.push(`Train: ${result.trainRows}  Test: ${result.testRows}`);
  lines.push(`Accuracy: ${result.accuracy.toFixed(4)}`);
  lines.push(`Avg max probability: ${result.avgMaxProbability.toFixed(4)}`);
  lines.push('');

  const labelWidth = 10;
  const colWidth = 9;

  lines.push('Confusion Matrix (rows = actual, cols = predicted):');
  lines.push('');
  let header = ''.padEnd(labelWidth);
  for (const l of result.labels) {
    header += l.padStart(colWidth);
  }
  lines.push(header);
  lines.push('-'.repeat(header.length));

  for (const actual of result.labels) {
    let row = actual.padEnd(labelWidth);
    for (const predicted of result.labels) {
      row += String(result.confusionMatrix[actual][predicted]).padStart(colWidth);
    }
    lines.push(row);
  }

  lines.push('');
  lines.push('Per-Class Metrics:');
  for (const label of result.labels) {
    const m = result.perClass[label];
    lines.push(
      `  ${label.padEnd(10)} P: ${m.precision.toFixed(4)}  R: ${m.recall.toFixed(4)}  Support: ${m.support}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

// ============================================================
// Data loading (CLI-only, not exported)
// ============================================================

function resolveDataPath(filename: string): string {
  return path.resolve(__dirname, '..', 'dataset', filename);
}

function loadJsonFile(filepath: string): unknown[] {
  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function loadRealData(): AppraisalRow[] {
  return loadJsonFile(resolveDataPath('isear_appraisal_dataset.json')) as AppraisalRow[];
}

function loadSyntheticData(): AppraisalRow[] {
  const raw = loadJsonFile(resolveDataPath('isear_appraisal_dataset_extended.json')) as Record<string, unknown>[];
  return raw.filter(r => r.source === 'SYNTHETIC') as unknown as AppraisalRow[];
}

function loadMergedData(): AppraisalRow[] {
  return loadJsonFile(resolveDataPath('isear_appraisal_dataset_extended.json')) as AppraisalRow[];
}

// ============================================================
// CLI
// ============================================================

type Mode = 'real' | 'synthetic' | 'merged';

function parseMode(argv: string[]): Mode[] {
  const modes: Mode[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode' && argv[i + 1]) {
      const m = argv[++i].toLowerCase();
      if (m === 'real' || m === 'synthetic' || m === 'merged') {
        modes.push(m);
      } else {
        console.error(`Unknown mode: ${m}. Use: real, synthetic, merged`);
        process.exit(1);
      }
    }
  }
  return modes.length > 0 ? modes : ['real', 'synthetic', 'merged'];
}

function main(): void {
  const modes = parseMode(process.argv.slice(2));

  for (const mode of modes) {
    let data: AppraisalRow[];
    switch (mode) {
      case 'real':      data = loadRealData(); break;
      case 'synthetic': data = loadSyntheticData(); break;
      case 'merged':    data = loadMergedData(); break;
    }

    const result = runEvaluation(data, mode);
    console.log(formatModeResult(result));
  }
}

if (require.main === module) {
  main();
}
