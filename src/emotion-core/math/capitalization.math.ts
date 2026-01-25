// src/emotion-core/math/capitalization.math.ts

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

const MAX_EIV = 1.0;

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
const SOFT_CAP_LIMIT = 4;
const HARD_CAP_LIMIT = 6;

/**
 * Density penalty
 * - High caps density reduces confidence (spam / acronym flood)
 */
const DENSITY_THRESHOLD = 0.4;
const DENSITY_PENALTY_FACTOR = 0.85;

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
    return { intensity: 0, confidence: 1.0 };
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
      intensity += signal.value * 0.5;
    }
    // Beyond HARD_CAP_LIMIT → ignored
  }

  intensity = clamp(intensity, 0, MAX_EIV);

  /* ============================================================================
   * CONFIDENCE — Graded & Density-Aware
   * ========================================================================== */

  let confidence: number;

  if (capsSignals.length === 1) {
    // Single ALL-CAPS → possible typo / ambiguity
    confidence = 0.55;
  } else if (capsSignals.length <= SOFT_CAP_LIMIT) {
    // Repeated, controlled emphasis
    confidence = 0.75;
  } else {
    // Overuse reduces clarity
    confidence = 0.65;
  }

  // Density penalty (gradual, not binary)
  if (
    metadata?.density !== undefined &&
    metadata.density > DENSITY_THRESHOLD
  ) {
    confidence *= DENSITY_PENALTY_FACTOR;
  }

  confidence = clamp(confidence, 0, 1);

  return { intensity, confidence };
}

/* ============================================================================
 * Utilities
 * ========================================================================== */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
