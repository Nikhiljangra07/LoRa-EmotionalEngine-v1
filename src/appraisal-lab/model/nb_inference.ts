/**
 * Naive Bayes inference engine for emotion classification.
 * All computation is performed in log-space for numerical stability.
 * Normalization uses the log-sum-exp trick.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import { AppraisalVector, Emotion, LikelihoodTable, PosteriorDistribution } from '../types';
import { EMOTIONS, DIMENSION_NAMES, DimensionName } from '../schema';

// ============================================================
// Internal helpers
// ============================================================

/**
 * Log-sum-exp for numerical stability.
 * Given an array of log-values, computes log(sum(exp(values))).
 */
function logSumExp(logValues: number[]): number {
  const maxVal = Math.max(...logValues);
  if (!isFinite(maxVal)) {
    return -Infinity;
  }
  let sum = 0;
  for (const v of logValues) {
    sum += Math.exp(v - maxVal);
  }
  return maxVal + Math.log(sum);
}

/**
 * Retrieve P(bin | emotion) from the likelihood table for a given dimension.
 * Uses a type-erased accessor since the dimension is determined at runtime.
 */
function getConditionalProb(
  table: LikelihoodTable,
  dim: DimensionName,
  emotion: Emotion,
  bin: string,
): number {
  const dimTable = (
    table.conditionals as Record<string, Record<string, Record<string, number>>>
  )[dim];
  return dimTable[emotion][bin];
}

// ============================================================
// Public API
// ============================================================

/**
 * Compute the full posterior distribution P(emotion | appraisals).
 *
 * Uses the Naive Bayes assumption:
 *   posterior ∝ prior × product_of_conditionals
 *
 * All arithmetic is performed in log-space. The posterior is normalized
 * via log-sum-exp and verified to sum to 1 within 1e-9 tolerance.
 *
 * @param appraisals - The observed appraisal vector.
 * @param table      - The likelihood table (from buildLikelihoodTable).
 * @returns A PosteriorDistribution with full distribution, predicted class,
 *          and confidence (max probability).
 * @throws If the posterior does not sum to 1 or contains non-finite values.
 */
export function infer(
  appraisals: AppraisalVector,
  table: LikelihoodTable,
): PosteriorDistribution {

  // ----------------------------------------------------------
  // 1. Compute unnormalized log-posteriors for each emotion
  // ----------------------------------------------------------
  const logPosteriors: Record<string, number> = {};

  for (const emotion of EMOTIONS) {
    let logP = Math.log(table.priors[emotion]);

    for (const dim of DIMENSION_NAMES) {
      const binValue = appraisals[dim] as string;
      const p = getConditionalProb(table, dim, emotion, binValue);
      // Guard against zero (should not happen with Laplace smoothing)
      logP += Math.log(Math.max(p, 1e-15));
    }

    logPosteriors[emotion] = logP;
  }

  // ----------------------------------------------------------
  // 2. Normalize using log-sum-exp
  // ----------------------------------------------------------
  const logValues = EMOTIONS.map(e => logPosteriors[e]);
  const logNorm = logSumExp(logValues);

  // ----------------------------------------------------------
  // 3. Exponentiate to get probabilities and find the argmax
  // ----------------------------------------------------------
  const distribution = {} as Record<Emotion, number>;
  let maxProb = -1;
  let predicted: Emotion = EMOTIONS[0];

  for (const emotion of EMOTIONS) {
    const prob = Math.exp(logPosteriors[emotion] - logNorm);
    distribution[emotion] = prob;
    if (prob > maxProb) {
      maxProb = prob;
      predicted = emotion;
    }
  }

  // ----------------------------------------------------------
  // 4. Verify invariants
  // ----------------------------------------------------------
  const sum = EMOTIONS.reduce((s, e) => s + distribution[e], 0);
  if (Math.abs(sum - 1.0) > 1e-9) {
    throw new Error(`Posterior does not sum to 1: got ${sum}`);
  }

  for (const emotion of EMOTIONS) {
    if (!isFinite(distribution[emotion])) {
      throw new Error(
        `Non-finite probability for ${emotion}: ${distribution[emotion]}`,
      );
    }
  }

  return { distribution, predicted, confidence: maxProb };
}
