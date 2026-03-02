import type { RelationalTier } from './RelationalTier';
import type { TierStateStored } from './TierState';

/**
 * Phase 1 placeholder: compute next tier based on session count and ETV mean.
 * No demotion logic yet — remains at current tier if no promotion threshold is met.
 */
export function computeTierTransition(
  state: TierStateStored,
  etvMean: number,
): RelationalTier {
  if (state.sessionCount >= 4 && etvMean >= 0.5) {
    return 'TIER_3';
  }
  if (state.sessionCount >= 2 && etvMean >= 0.35) {
    return 'TIER_2';
  }
  if (state.sessionCount < 2) {
    return 'TIER_1';
  }
  return state.currentTier;
}
