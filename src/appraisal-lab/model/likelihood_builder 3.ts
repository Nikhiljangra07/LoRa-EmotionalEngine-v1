/**
 * Likelihood table builder for Naive Bayes classification.
 * Computes priors P(emotion) and conditionals P(dimension_bin | emotion)
 * with Laplace (add-one) smoothing to prevent zero probabilities.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import { AppraisalRow, Emotion, LikelihoodTable } from '../types';
import { EMOTIONS, DIMENSION_BINS, DIMENSION_NAMES, DimensionName } from '../schema';

// ============================================================
// Internal helpers
// ============================================================

/**
 * Read the appraisal value for a given dimension from a row.
 * Returns the value as a string key for counting.
 */
function getAppraisalValue(row: AppraisalRow, dim: DimensionName): string {
  return row.appraisals[dim] as string;
}

/**
 * Get the bin array for a dimension as a readonly string array.
 */
function getBinsForDimension(dim: DimensionName): readonly string[] {
  return DIMENSION_BINS[dim] as readonly string[];
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a complete likelihood table from labeled training data.
 *
 * Uses Laplace smoothing (add-one) for both priors and conditionals,
 * guaranteeing no zero probabilities in the resulting table.
 *
 * @param data - Array of labeled AppraisalRow training examples.
 * @returns A LikelihoodTable ready for Naive Bayes inference.
 */
export function buildLikelihoodTable(data: AppraisalRow[]): LikelihoodTable {
  if (data.length === 0) {
    throw new Error("Cannot build likelihood table from empty dataset.");
  }

  // ----------------------------------------------------------
  // 1. Count emotion occurrences
  // ----------------------------------------------------------
  const emotionCounts: Record<string, number> = {};
  for (const e of EMOTIONS) {
    emotionCounts[e] = 0;
  }
  for (const row of data) {
    emotionCounts[row.emotion]++;
  }

  // ----------------------------------------------------------
  // 2. Compute priors with Laplace smoothing
  //    P(emotion) = (count(emotion) + 1) / (N + K)
  //    where K = number of emotion classes
  // ----------------------------------------------------------
  const N = data.length;
  const K = EMOTIONS.length;
  const priors: Record<string, number> = {};
  for (const e of EMOTIONS) {
    priors[e] = (emotionCounts[e] + 1) / (N + K);
  }

  // ----------------------------------------------------------
  // 3. Build conditional tables for each dimension
  //    P(bin | emotion) = (count(bin, emotion) + 1) / (count(emotion) + B)
  //    where B = number of bins for that dimension
  // ----------------------------------------------------------
  const conditionals: Record<string, Record<string, Record<string, number>>> = {};

  for (const dim of DIMENSION_NAMES) {
    const bins = getBinsForDimension(dim);
    const B = bins.length;
    const dimTable: Record<string, Record<string, number>> = {};

    for (const emotion of EMOTIONS) {
      // Initialize bin counts to zero
      const binCounts: Record<string, number> = {};
      for (const b of bins) {
        binCounts[b] = 0;
      }

      // Count occurrences
      for (const row of data) {
        if (row.emotion === emotion) {
          const val = getAppraisalValue(row, dim);
          binCounts[val]++;
        }
      }

      // Apply Laplace smoothing
      const emotionTotal = emotionCounts[emotion];
      const smoothed: Record<string, number> = {};
      for (const b of bins) {
        smoothed[b] = (binCounts[b] + 1) / (emotionTotal + B);
      }

      dimTable[emotion] = smoothed;
    }

    conditionals[dim] = dimTable;
  }

  return {
    priors: priors as Record<Emotion, number>,
    conditionals: conditionals as unknown as LikelihoodTable['conditionals'],
  };
}
