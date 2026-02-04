// src/emotion-core/math/capitalization.math.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
import { AnalyzerSignal } from '../types/analysis.types';

/**
 * Capitalization Math Engine (EIV Layer)
 *
 * Models capitalization as a loudness / arousal signal with
 * soft saturation and diminishing returns.
 *
 * ✔ Bounded [0, 1]
 * ✔ Monotonic until plateau
 * ✔ Explainable
 * ✔ Psychologically grounded (VADER + prosody literature)
 */

const MAX_EIV =
  MASTER_CONSTANTS.capitalization.eivMath.maxEiv;

/**
 * Saturation thresholds
 *
 * SOFT_CAP_LIMIT:
 * - Full contribution until attentional saturation
 *
 * HARD_CAP_LIMIT:
 * - Reduced contribution (diminishing returns)
 * - Beyond this: ignored
 */
const SOFT_CAP_LIMIT =
  MASTER_CONSTANTS.capitalization.eivMath.softCapLimit;
const HARD_CAP_LIMIT =
  MASTER_CONSTANTS.capitalization.eivMath.hardCapLimit;

/**
 * Density penalty
 * - High caps density reduces confidence (spam / acronym flood)
 */
const DENSITY_THRESHOLD =
  MASTER_CONSTANTS.capitalization.eivMath.densityThreshold;
const DENSITY_PENALTY_FACTOR =
  MASTER_CONSTANTS.capitalization.eivMath.densityPenaltyFactor;

interface CapitalizationMathResult {
  intensity: number;
  confidence: number;
}

export function computeCapitalizationEIV(
  signals: AnalyzerSignal[],
  metadata?: {
    tokenCount?: number;
    capsCount?: number;
    density?: number;
  }
): CapitalizationMathResult {
  if (!signals || signals.length === 0) {
    return {
      intensity: MASTER_CONSTANTS.capitalization.eivMath.clamp.min,
      confidence:
        MASTER_CONSTANTS.capitalization.eivMath.confidenceDefaults
          .emptySignals,
    };
  }

  const capsSignals = signals.filter(
    s => s.weightSource === 'ALL_CAPS'
  );

  /* ============================================================================
   * INTENSITY — Soft Saturation + Diminishing Returns
   * ========================================================================== */

  let intensity = 0;

  for (let i = 0; i < capsSignals.length; i++) {
    const signal = capsSignals[i];

    if (i < SOFT_CAP_LIMIT) {
      // Full contribution
      intensity += signal.value;
    } else if (i < HARD_CAP_LIMIT) {
      // Diminishing returns
      intensity +=
        signal.value *
        MASTER_CONSTANTS.capitalization.eivMath
          .diminishingMultiplier;
    }
    // Beyond HARD_CAP_LIMIT → ignored
  }

  intensity = clamp(
    intensity,
    MASTER_CONSTANTS.capitalization.eivMath.clamp.min,
    MAX_EIV
  );

  /* ============================================================================
   * CONFIDENCE — Graded & Density-Aware
   * ========================================================================== */

  let confidence: number;

  if (
    capsSignals.length ===
    MASTER_CONSTANTS.capitalization.eivMath.signalCounts
      .single
  ) {
    // Single ALL-CAPS → possible typo / ambiguity
    confidence =
      MASTER_CONSTANTS.capitalization.eivMath.confidenceDefaults
        .singleSignal;
  } else if (capsSignals.length <= SOFT_CAP_LIMIT) {
    // Repeated, controlled emphasis
    confidence =
      MASTER_CONSTANTS.capitalization.eivMath.confidenceDefaults
        .controlledSignals;
  } else {
    // Overuse reduces clarity
    confidence =
      MASTER_CONSTANTS.capitalization.eivMath.confidenceDefaults
        .overuseSignals;
  }

  // Density penalty (gradual, not binary)
  if (
    metadata?.density !== undefined &&
    metadata.density > DENSITY_THRESHOLD
  ) {
    confidence *= DENSITY_PENALTY_FACTOR;
  }

  confidence = clamp(
    confidence,
    MASTER_CONSTANTS.capitalization.eivMath.clamp.min,
    MASTER_CONSTANTS.capitalization.eivMath.clamp.max
  );

  return { intensity, confidence };
}

/* ============================================================================
 * Utilities
 * ========================================================================== */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
