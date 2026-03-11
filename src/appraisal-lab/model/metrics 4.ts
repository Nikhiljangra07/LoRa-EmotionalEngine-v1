/**
 * Evaluation metrics for Naive Bayes emotion classification.
 * Computes accuracy, confusion matrix, and average max probability
 * on a holdout test set.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import {
  AppraisalRow, Emotion, ConfusionMatrix, EvaluationResult, LikelihoodTable,
} from '../types';
import { EMOTIONS } from '../schema';
import { infer } from './nb_inference';

// ============================================================
// Dataset splitting
// ============================================================

/**
 * Split a dataset into train and test partitions.
 * Deterministic: always takes the first `floor(n * ratio)` rows as train.
 *
 * @param data       - Full dataset (order must be deterministic).
 * @param trainRatio - Fraction for training (default 0.8).
 */
export function splitDataset(
  data: AppraisalRow[],
  trainRatio: number = 0.8,
): { train: AppraisalRow[]; test: AppraisalRow[] } {
  const splitIndex = Math.floor(data.length * trainRatio);
  return {
    train: data.slice(0, splitIndex),
    test: data.slice(splitIndex),
  };
}

// ============================================================
// Confusion matrix
// ============================================================

/**
 * Build a 6×6 confusion matrix from parallel actual/predicted arrays.
 */
function buildConfusionMatrix(
  actual: Emotion[],
  predicted: Emotion[],
): ConfusionMatrix {
  const matrix = {} as Record<Emotion, Record<Emotion, number>>;
  for (const a of EMOTIONS) {
    matrix[a] = {} as Record<Emotion, number>;
    for (const p of EMOTIONS) {
      matrix[a][p] = 0;
    }
  }

  for (let i = 0; i < actual.length; i++) {
    matrix[actual[i]][predicted[i]]++;
  }

  return { matrix, labels: [...EMOTIONS] };
}

// ============================================================
// Evaluation
// ============================================================

/**
 * Evaluate the Naive Bayes model on a holdout test set.
 *
 * @param testData - Array of labeled test rows.
 * @param table    - The likelihood table (trained on separate training data).
 * @returns An EvaluationResult with accuracy, confusion matrix, and
 *          average max probability.
 */
export function evaluate(
  testData: AppraisalRow[],
  table: LikelihoodTable,
): EvaluationResult {
  if (testData.length === 0) {
    throw new Error("Cannot evaluate on an empty test set.");
  }

  const actuals: Emotion[] = [];
  const predictions: Emotion[] = [];
  let sumMaxProb = 0;

  for (const row of testData) {
    const result = infer(row.appraisals, table);
    actuals.push(row.emotion);
    predictions.push(result.predicted);
    sumMaxProb += result.confidence;
  }

  // Accuracy
  let correct = 0;
  for (let i = 0; i < actuals.length; i++) {
    if (actuals[i] === predictions[i]) {
      correct++;
    }
  }
  const accuracy = correct / actuals.length;

  // Confusion matrix
  const confusionMatrix = buildConfusionMatrix(actuals, predictions);

  // Average max probability
  const averageMaxProbability = sumMaxProb / testData.length;

  return { accuracy, confusionMatrix, averageMaxProbability, totalSamples: testData.length };
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format an EvaluationResult as a clean human-readable string.
 */
export function formatEvaluationResult(result: EvaluationResult): string {
  const lines: string[] = [];

  lines.push("=== Appraisal Lab: Holdout Evaluation ===");
  lines.push("");
  lines.push(`Total test samples: ${result.totalSamples}`);
  lines.push(`Accuracy:           ${(result.accuracy * 100).toFixed(2)}%`);
  lines.push(`Avg max probability: ${result.averageMaxProbability.toFixed(4)}`);
  lines.push("");
  lines.push("Confusion Matrix (rows = actual, cols = predicted):");
  lines.push("");

  // Header row
  const labelWidth = 10;
  const colWidth = 9;
  let header = "".padEnd(labelWidth);
  for (const label of result.confusionMatrix.labels) {
    header += label.padStart(colWidth);
  }
  lines.push(header);
  lines.push("-".repeat(header.length));

  // Data rows
  for (const actual of result.confusionMatrix.labels) {
    let row = actual.padEnd(labelWidth);
    for (const predicted of result.confusionMatrix.labels) {
      row += String(result.confusionMatrix.matrix[actual][predicted]).padStart(colWidth);
    }
    lines.push(row);
  }

  lines.push("");
  lines.push("=== End ===");

  return lines.join("\n");
}
