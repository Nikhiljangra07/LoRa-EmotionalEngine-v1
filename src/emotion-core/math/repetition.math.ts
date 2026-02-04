// src/emotion-core/math/repetition.math.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
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

const MAX_EIV =
  MASTER_CONSTANTS.repetitionMath.maxEiv;

/**
 * Maximum boost repetition can contribute.
 * Chosen conservatively to avoid overpowering lexical emotion.
 */
const MAX_REPETITION_BOOST =
  MASTER_CONSTANTS.repetitionMath.maxRepetitionBoost;

/**
 * Controls how quickly repetition saturates.
 * log(1 + count) ensures:
 * - Strong early gain (2–3 repetitions)
 * - Rapid perceptual plateau
 */
const REPETITION_SCALE =
  MASTER_CONSTANTS.repetitionMath.repetitionScale;

/**
 * Beyond this count, additional repetitions carry
 * stylistic meaning only, not emotional intensity.
 */
const MAX_EFFECTIVE_REPETITION =
  MASTER_CONSTANTS.repetitionMath.maxEffectiveRepetition;

interface RepetitionMathResult {
  intensity: number;
  confidence: number;
}

export function computeRepetitionEIV(
  signals: AnalyzerSignal[],
  metadata?: { maxRepetitionCount?: number }
): RepetitionMathResult {
  if (!signals || signals.length === 0) {
    return {
      intensity: MASTER_CONSTANTS.repetitionMath.clamp.min,
      confidence: MASTER_CONSTANTS.repetitionMath.confidence.single,
    };
  }

  const count = Math.max(
    MASTER_CONSTANTS.bounds.one,
    metadata?.maxRepetitionCount ?? MASTER_CONSTANTS.bounds.one
  );
  const boost = repetitionIntensityBoost(count);

  let intensitySum = 0;
  for (const s of signals) {
    intensitySum += s.value * (1 + boost);
  }

  return {
    intensity: clamp(
      intensitySum,
      MASTER_CONSTANTS.repetitionMath.clamp.min,
      MAX_EIV
    ),
    confidence: repetitionConfidence(count),
  };
}

/* ============================================================================
 * Repetition Boost
 * ========================================================================== */

export function repetitionIntensityBoost(count: number): number {
  if (count < MASTER_CONSTANTS.repetitionMath.minBoostCount) {
    return MASTER_CONSTANTS.repetitionMath.clamp.min;
  }

  const effectiveCount = Math.min(count, MAX_EFFECTIVE_REPETITION);

  const boost =
    Math.log(1 + effectiveCount) * REPETITION_SCALE;

  return clamp(
    boost,
    MASTER_CONSTANTS.repetitionMath.clamp.min,
    MAX_REPETITION_BOOST
  );
}

/* ============================================================================
 * Confidence (heuristic, explicitly non-learned)
 * ========================================================================== */

function repetitionConfidence(count: number): number {
  if (
    count <= MASTER_CONSTANTS.repetitionMath.confidence.singleMaxInclusive
  ) {
    return MASTER_CONSTANTS.repetitionMath.confidence.single;
  }
  if (count === MASTER_CONSTANTS.repetitionMath.confidence.doubleCount) {
    return MASTER_CONSTANTS.repetitionMath.confidence.double;
  }
  if (
    count <=
    MASTER_CONSTANTS.repetitionMath.confidence.controlledMaxInclusive
  ) {
    return MASTER_CONSTANTS.repetitionMath.confidence.controlled;
  }
  return MASTER_CONSTANTS.repetitionMath.confidence.overuse;
}

/* ============================================================================
 * Utilities
 * ========================================================================== */

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
