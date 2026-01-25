// src/emotion-core/math/punctuation.math.ts

import {
  BASE_WEIGHTS,
  MAX_INTENSITY,
  PUNCTUATION_DIMINISHING_POLICY,
} from '../config/punctuation.config';

/* ============================================================================
 * Public Constants
 * ========================================================================== */

/**
 * Symbol → base emotional salience
 * These are NOT intensities, only baseline amplifiers.
 */
export const PUNCTUATION_BASE_WEIGHTS: Record<string, number> = {
  '!': BASE_WEIGHTS.EXCLAMATION,
  '?': BASE_WEIGHTS.QUESTION,
  '...': BASE_WEIGHTS.ELLIPSIS,
  '!?': BASE_WEIGHTS.MIXED,
};

/* ============================================================================
 * Utilities
 * ========================================================================== */

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

/* ============================================================================
 * Intensity Calculation — Research-Aligned
 * ========================================================================== */

/**
 * Calculates punctuation-based emotional intensity.
 *
 * Psychological grounding:
 * - Early repetitions strongly increase perceived arousal
 * - Perceptual saturation after ~4–5 marks
 * - Excess punctuation signals style, not stronger emotion
 *
 * Mathematical properties:
 * - Monotonic
 * - Logarithmic diminishing returns
 * - Hard bounded
 * - Numerically stable
 */
export function calculateIncrementalIntensity(
  baseWeight: number,
  count: number
): number {
  if (count <= 0) return 0;

  // Single punctuation = baseline only
  if (count === 1) {
    return clamp(baseWeight, 0, MAX_INTENSITY);
  }

  const {
    baseIncrement,
    decayFactor,
    maxContribution,
    maxEffectiveCount,
  } = PUNCTUATION_DIMINISHING_POLICY;

  /**
   * Effective repetitions that meaningfully contribute
   * (semantic saturation cap)
   */
  const effectiveRepetitions = Math.min(
    count - 1,
    maxEffectiveCount
  );

  /**
   * Logarithmic arousal amplification
   *
   * Shape:
   * - Strong early gain
   * - Rapid plateau
   * - Matches VADER empirical behavior
   */
  const repetitionContribution =
    baseIncrement *
    Math.log(effectiveRepetitions + 1) *
    decayFactor;

  /**
   * Prevent repetition from overpowering lexical emotion
   */
  const boundedContribution = Math.min(
    repetitionContribution,
    maxContribution
  );

  return clamp(
    baseWeight + boundedContribution,
    0,
    MAX_INTENSITY
  );
}

/**
 * Convenience wrapper: symbol → intensity
 */
export function calculatePunctuationIntensity(
  symbol: string,
  count: number
): number {
  const base = PUNCTUATION_BASE_WEIGHTS[symbol] ?? 0;
  return calculateIncrementalIntensity(base, count);
}

/* ============================================================================
 * Confidence Estimation (Heuristic, Interpretable)
 * ========================================================================== */

/**
 * Confidence reflects signal clarity, not intensity.
 *
 * Repetition increases confidence up to a point,
 * then credibility plateaus.
 */
const POSITION_CONFIDENCE_MULTIPLIER = {
  start: 0.9,
  mid: 1.0,
  end: 1.1,
} as const;

export function calculateConfidence(
  count: number,
  position: 'start' | 'mid' | 'end' = 'mid',
  baseConfidence = 0.7
): number {
  if (count <= 0) return 0;

  // Confidence saturates faster than intensity
  const repetitionConfidenceBoost = Math.min(
    Math.log(count + 1) * 0.15,
    0.3
  );

  return clamp(
    (baseConfidence + repetitionConfidenceBoost) *
      POSITION_CONFIDENCE_MULTIPLIER[position],
    0,
    1
  );
}

/* ============================================================================
 * Aggregation Strategy
 * ========================================================================== */

/**
 * Punctuation signals compete by salience.
 * Highest arousal dominates perception.
 */
export interface CategorizedSignal {
  category: string;
  eiv: number;
  confidence: number;
}

export function aggregateSignals(signals: CategorizedSignal[]) {
  if (signals.length === 0) {
    return {
      aggregateEIV: 0,
      aggregateConfidence: 0,
      strategy: 'MAX',
    };
  }

  let dominantEIV = 0;
  let dominantConfidence = 0;

  for (const signal of signals) {
    if (signal.eiv > dominantEIV) {
      dominantEIV = signal.eiv;
      dominantConfidence = signal.confidence;
    }
  }

  return {
    aggregateEIV: clamp(dominantEIV, 0, MAX_INTENSITY),
    aggregateConfidence: clamp(dominantConfidence, 0, 1),
    strategy: 'MAX',
  };
}
