// src/emotion-core/scorers/EIVScorer.ts

import { ES_EIV_SCALAR_ALPHA } from '../config/eiv.config';
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

const EIV_MIN = 0;
const EIV_MAX = 1;

const logger = console;

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
  static calculate(
    components: EIVComponents,
    es: number = 0
  ): EIVResult {
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

    const esScalar = 1 + ES_EIV_SCALAR_ALPHA * clamp(safe(es), EIV_MIN, EIV_MAX);
    const eivModulated = clamp(
      rawValue * esScalar,
      EIV_MIN,
      EIV_MAX
    );

    logger.debug("EIV modulation", {
      eiv_raw: rawValue,
      es,
      es_scalar: esScalar,
      eiv_final: eivModulated,
    });

    const finalValue = eivModulated;

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
