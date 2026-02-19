/**
 * Calibrated inference wrapper.
 *
 * Provides two optional hooks over the base NB posterior:
 *   1. Temperature scaling (T) — flattens or sharpens the distribution
 *   2. Per-dimension weights (w_i) — re-weights each appraisal dimension's
 *      contribution to the log-posterior
 *
 * Both default to identity behavior: T=1 and all w_i=1 reproduce the
 * exact output of infer().
 *
 * Fully isolated — removable without affecting base inference.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import { AppraisalVector, Emotion, LikelihoodTable } from '../types';
import { EMOTIONS, DIMENSION_NAMES, DimensionName } from '../schema';
import { infer } from './nb_inference';

// ============================================================
// Types
// ============================================================

export interface CalibrationOptions {
  temperature?: number;
  dimensionWeights?: Record<string, number>;
}

// ============================================================
// Helpers
// ============================================================

const LOG_FLOOR = 1e-15;

function logSumExp(values: number[]): number {
  const max = Math.max(...values);
  if (!isFinite(max)) return -Infinity;
  let sum = 0;
  for (const v of values) sum += Math.exp(v - max);
  return max + Math.log(sum);
}

function getConditional(
  table: LikelihoodTable,
  dim: DimensionName,
  emotion: Emotion,
  bin: string,
): number {
  const t = table.conditionals as Record<string, Record<string, Record<string, number>>>;
  return t[dim][emotion][bin];
}

function normalize(logits: Record<Emotion, number>): Record<Emotion, number> {
  const vals = EMOTIONS.map(e => logits[e]);
  const lse = logSumExp(vals);
  const out = {} as Record<Emotion, number>;
  for (const e of EMOTIONS) out[e] = Math.exp(logits[e] - lse);
  return out;
}

// ============================================================
// Weighted log-posterior (from-scratch NB with dimension weights)
// ============================================================

function weightedLogPosterior(
  appraisals: AppraisalVector,
  table: LikelihoodTable,
  weights: Record<string, number>,
): Record<Emotion, number> {
  const logP = {} as Record<Emotion, number>;

  for (const emotion of EMOTIONS) {
    let lp = Math.log(Math.max(table.priors[emotion], LOG_FLOOR));

    for (const dim of DIMENSION_NAMES) {
      const bin = appraisals[dim] as string;
      const p = getConditional(table, dim, emotion, bin);
      const w = weights[dim] ?? 1;
      lp += w * Math.log(Math.max(p, LOG_FLOOR));
    }

    logP[emotion] = lp;
  }

  return normalize(logP);
}

// ============================================================
// Temperature scaling on an existing posterior
// ============================================================

function applyTemperature(
  posterior: Record<Emotion, number>,
  T: number,
): Record<Emotion, number> {
  const logits = {} as Record<Emotion, number>;
  for (const e of EMOTIONS) {
    logits[e] = Math.log(Math.max(posterior[e], LOG_FLOOR)) / T;
  }
  return normalize(logits);
}

// ============================================================
// Public API
// ============================================================

/**
 * Run NB inference with optional calibration hooks.
 *
 * - No options or all defaults → delegates to infer() (identity).
 * - dimensionWeights provided → recomputes weighted log-posterior.
 * - temperature != 1 → rescales logits before normalization.
 */
export function inferWithCalibration(
  input: AppraisalVector,
  likelihood: LikelihoodTable,
  options?: CalibrationOptions,
): Record<Emotion, number> {
  const T = options?.temperature ?? 1.0;
  const weights = options?.dimensionWeights;

  const needsWeights = weights !== undefined &&
    DIMENSION_NAMES.some(d => (weights[d] ?? 1) !== 1);

  const needsTemp = T !== 1.0;

  // Fast path: no hooks → delegate to existing infer()
  if (!needsWeights && !needsTemp) {
    return { ...infer(input, likelihood).distribution };
  }

  // Weighted path: recompute from likelihood table with weights
  let posterior: Record<Emotion, number>;
  if (needsWeights) {
    posterior = weightedLogPosterior(input, likelihood, weights);
  } else {
    posterior = { ...infer(input, likelihood).distribution };
  }

  // Temperature scaling
  if (needsTemp) {
    posterior = applyTemperature(posterior, T);
  }

  return posterior;
}
