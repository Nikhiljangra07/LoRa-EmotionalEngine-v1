export type RelationalTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface TierPolicy {
  tier: RelationalTier;
  description: string;
}

const TIER_POLICIES: Readonly<Record<RelationalTier, TierPolicy>> = {
  TIER_1: { tier: 'TIER_1', description: 'Conservative' },
  TIER_2: { tier: 'TIER_2', description: 'Balanced' },
  TIER_3: { tier: 'TIER_3', description: 'Direct' },
};

export function getTierPolicy(tier: RelationalTier): TierPolicy {
  return TIER_POLICIES[tier];
}
