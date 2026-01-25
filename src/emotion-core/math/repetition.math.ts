// src/emotion-core/math/repetition.math.ts

import { AnalyzerSignal } from '../types/analysis.types';

/**
 * Repetition is treated as a bounded arousal amplifier.
 * It does NOT create emotion, it only nudges intensity.
 *
 * Design goals:
 * - Monotonic
 * - Early saturation (semantic satiation)
 * - Hard bounds (no runaway)
 * - Deterministic
 */

const MAX_EIV = 1.0;

/**
 * Maximum boost repetition can contribute.
 * Chosen conservatively to avoid overpowering lexical emotion.
 */
const MAX_REPETITION_BOOST = 0.4;

/**
 * Controls how quickly repetition saturates.
 * log(1 + count) ensures:
 * - Strong early gain (2–3 repetitions)
 * - Rapid perceptual plateau
 */
const REPETITION_SCALE = 0.15;

/**
 * Beyond this count, additional repetitions carry
 * stylistic meaning only, not emotional intensity.
 */
const MAX_EFFECTIVE_REPETITION = 5;

interface RepetitionMathResult {
  intensity: number;
  confidence: number;
}

export function computeRepetitionEIV(
  signals: AnalyzerSignal[],
  metadata?: { maxRepetitionCount?: number }
): RepetitionMathResult {
  if (!signals || signals.length === 0) {
    return { intensity: 0, confidence: 1.0 };
  }

  const count = Math.max(1, metadata?.maxRepetitionCount ?? 1);
  const boost = repetitionIntensityBoost(count);

  let intensitySum = 0;
  for (const s of signals) {
    intensitySum += s.value * (1 + boost);
  }

  return {
    intensity: clamp(intensitySum, 0, MAX_EIV),
    confidence: repetitionConfidence(count),
  };
}

/* ============================================================================
 * Repetition Boost
 * ========================================================================== */

export function repetitionIntensityBoost(count: number): number {
  if (count < 2) return 0;

  const effectiveCount = Math.min(count, MAX_EFFECTIVE_REPETITION);

  const boost =
    Math.log(1 + effectiveCount) * REPETITION_SCALE;

  return clamp(boost, 0, MAX_REPETITION_BOOST);
}

/* ============================================================================
 * Confidence (heuristic, explicitly non-learned)
 * ========================================================================== */

function repetitionConfidence(count: number): number {
  if (count <= 1) return 0.5;
  if (count === 2) return 0.75;
  if (count <= MAX_EFFECTIVE_REPETITION) return 0.85;
  return 0.7; // excessive repetition reduces interpretive certainty
}

/* ============================================================================
 * Utilities
 * ========================================================================== */

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
