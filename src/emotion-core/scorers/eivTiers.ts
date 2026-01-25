// src/emotion-core/scorers/eivTiers.ts

import { EIVTier } from '../types/eiv.types';

/**
 * Tier boundaries are psychologically calibrated:
 * - < 0.15  : negligible emotional activation
 * - < 0.30  : weak signal
 * - < 0.55  : conversationally noticeable
 * - < 0.80  : emotionally strong
 * - >= 0.80 : intense / dominant
 */
export function getEIVTier(value: number): EIVTier {
  if (value < 0.15) return 'minimal';
  if (value < 0.30) return 'low';
  if (value < 0.55) return 'moderate';
  if (value < 0.80) return 'high';
  return 'extreme';
}
