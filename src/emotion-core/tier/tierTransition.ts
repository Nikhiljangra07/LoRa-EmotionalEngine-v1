import type { RelationalTier } from './RelationalTier';
import type { TierStateStored } from './TierState';

/**
 * Tier progression is currently deterministic (session-based)
 * to guarantee visible relational differentiation during validation.
 *
 * Emotional or trust-based gating (ETV/EIV thresholds) may be
 * reintroduced later once signal calibration stabilizes.
 */
export function computeTierTransition(
  state: TierStateStored,
): RelationalTier {
  const { sessionCount } = state;

  if (sessionCount >= 5) {
    return 'TIER_3';
  }

  if (sessionCount >= 2) {
    return 'TIER_2';
  }

  return 'TIER_1';
}
