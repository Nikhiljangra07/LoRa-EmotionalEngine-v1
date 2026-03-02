export type TierLevel = 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface TierRecord {
  userId: string;
  sessionCount: number;
  tier: TierLevel;
}
