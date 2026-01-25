// src/emotion-core/scorers/EIVScorer.ts

import { EIVComponents, EIVResult } from '../types/eiv.types';
import { getEIVTier } from './eivTiers';

/* ============================================================================
 * Weighting Policy (Frozen for Beta)
 * ========================================================================== */

const EIV_WEIGHTS = {
  linguistic: 0.50,
  emoji: 0.325,
  capitalization: 0.15,
  punctuation: 0.10,
} as const;

/* ============================================================================
 * Utilities
 * ========================================================================== */

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function safe(value?: number): number {
  return Number.isFinite(value) ? value! : 0;
}

/* ============================================================================
 * EIV Scorer
 * ========================================================================== */

export class EIVScorer {
  static calculate(components: EIVComponents): EIVResult {
    /* -----------------------------
     * Normalize inputs (ANTI-NaN)
     * --------------------------- */
    const normalized = {
      linguistic: clamp(safe(components.linguistic)),
      emoji: clamp(safe(components.emoji)),
      capitalization: clamp(safe(components.capitalization)),
      punctuation: clamp(safe(components.punctuation)),
    };

    /* -----------------------------
     * Weighted aggregation
     * --------------------------- */
    const weighted = {
      linguistic: normalized.linguistic * EIV_WEIGHTS.linguistic,
      emoji: normalized.emoji * EIV_WEIGHTS.emoji,
      capitalization:
        normalized.capitalization * EIV_WEIGHTS.capitalization,
      punctuation: normalized.punctuation * EIV_WEIGHTS.punctuation,
    };

    const rawValue =
      weighted.linguistic +
      weighted.emoji +
      weighted.capitalization +
      weighted.punctuation;

    const finalValue = clamp(rawValue);

    /* -----------------------------
     * Dominant signal detection
     * --------------------------- */
    const dominantSignals = (Object.entries(weighted) as Array<
      [keyof typeof weighted, number]
    >)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v >= 0.05)
      .map(([k]) => k);

    /* -----------------------------
     * Tier classification
     * --------------------------- */
    const tier = getEIVTier(finalValue);

    /* -----------------------------
     * Structured breakdown
     * --------------------------- */
    const breakdown = {
      rawComponents: { ...normalized },
      weightedComponents: {
        linguistic: Number(weighted.linguistic.toFixed(4)),
        emoji: Number(weighted.emoji.toFixed(4)),
        capitalization: Number(weighted.capitalization.toFixed(4)),
        punctuation: Number(weighted.punctuation.toFixed(4)),
      },
      dominantSignals,
      tier,
      rawValue: Number(rawValue.toFixed(4)),
      finalValue: Number(finalValue.toFixed(4)),
    };

    return {
      value: finalValue,
      components: normalized,
      breakdown,
      timestamp: Date.now(),
    };
  }
}
