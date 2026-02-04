// src/emotion-core/scorers/eivTiers.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
import { EIVTier } from '../types/eiv.types';

export type { EIVTier };

/**
 * Tier boundaries are psychologically calibrated:
 * - < minimalMaxExclusive  : negligible emotional activation
 * - < lowMaxExclusive      : weak signal
 * - < moderateMaxExclusive : conversationally noticeable
 * - < highMaxExclusive     : emotionally strong
 * - >= highMaxExclusive    : intense / dominant
 */
export function getEIVTier(value: number): EIVTier {
  if (
    value <
    MASTER_CONSTANTS.eiv.tiers.minimalMaxExclusive
  ) {
    return 'minimal';
  }
  if (
    value <
    MASTER_CONSTANTS.eiv.tiers.lowMaxExclusive
  ) {
    return 'low';
  }
  if (
    value <
    MASTER_CONSTANTS.eiv.tiers.moderateMaxExclusive
  ) {
    return 'moderate';
  }
  if (
    value <
    MASTER_CONSTANTS.eiv.tiers.highMaxExclusive
  ) {
    return 'high';
  }
  return 'extreme';
}
