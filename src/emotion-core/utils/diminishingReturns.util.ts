/* ============================================================================
 * Diminishing Returns Utility
 *
 * Purpose:
 * - Model repetition saturation in human perception
 * - Used by punctuation, repetition, emoji, capitalization (optional)
 *
 * Design Principles:
 * - Monotonic (never decreases total signal)
 * - Bounded
 * - Explainable
 * - Config-driven (NO magic numbers)
 *
 * Backing:
 * - Hutto & Gilbert (VADER): logarithmic saturation
 * - Psycholinguistics: repetition attenuation
 * - Yerkes–Dodson law (arousal saturation)
 * ========================================================================== */

import { MASTER_CONSTANTS } from "../config/master.constants";

export type DiminishingMode =
  | 'linear'
  | 'capped-linear'
  | 'logarithmic'
  | 'power';

/**
 * Configuration contract
 * Every analyzer MUST justify these numbers.
 */
export interface DiminishingConfig {
  /** Base contribution of the first occurrence */
  baseIncrement: number;

  /** Maximum total contribution allowed */
  maxContribution: number;

  /** Shape of decay */
  mode: DiminishingMode;

  /**
   * Controls curvature (meaning depends on mode)
   * - logarithmic: natural log multiplier
   * - power: exponent (greater than 0; below 1 = diminishing)
   */
  decayFactor?: number;

  /**
   * Optional hard cap on contributing repetitions
   * (e.g., emojis saturate after 5–6)
   */
  maxEffectiveCount?: number;
}

/**
 * Compute total contribution under diminishing returns
 *
 * @param count - number of repetitions (at least 1)
 * @param config - decay configuration
 */
export function computeDiminishingReturns(
  count: number,
  config: DiminishingConfig
): number {
  if (count <= MASTER_CONSTANTS.bounds.zero) {
    return MASTER_CONSTANTS.bounds.zero;
  }

  const effectiveCount =
    config.maxEffectiveCount !== undefined
      ? Math.min(count, config.maxEffectiveCount)
      : count;

  let total = 0;

  switch (config.mode) {
    case 'linear': {
      total = config.baseIncrement * effectiveCount;
      break;
    }

    case 'capped-linear': {
      total = config.baseIncrement * effectiveCount;
      break;
    }

    case 'logarithmic': {
      /**
       * Inspired by VADER:
       * intensity ≈ a * ln(n + 1)
       */
      const k = config.decayFactor ?? 1;
      total = config.baseIncrement * Math.log(effectiveCount + 1) * k;
      break;
    }

    case 'power': {
      /**
       * Psycholinguistic repetition attenuation:
       * contribution ≈ a * n^b , where b is between 0 and 1
       */
      const b = config.decayFactor ?? 0.7;
      total = config.baseIncrement * Math.pow(effectiveCount, b);
      break;
    }

    default:
      throw new Error(
        `Unsupported diminishing mode: ${config.mode}`
      );
  }

  return clamp(total, 0, config.maxContribution);
}

/* ============================================================================
 * Utilities
 * ========================================================================== */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
