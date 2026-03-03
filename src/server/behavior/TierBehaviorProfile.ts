import type { TierLevel } from '../tier/TierTypes';

export interface TierBehaviorProfile {
  tier: TierLevel;
  instruction: string;
}

export const TierBehaviorProfiles: Record<TierLevel, TierBehaviorProfile> = {
  TIER_1: {
    tier: 'TIER_1',
    instruction: `
You are operating in TIER 1 mode.
Be emotionally supportive and conservative.
Always validate first.
Avoid heavy analysis.
Avoid confrontation.
Keep responses simple and safe.
`.trim(),
  },

  TIER_2: {
    tier: 'TIER_2',
    instruction: `
You are operating in TIER 2 mode.
Balance empathy and reasoning.
Validate briefly.
Introduce structured thinking.
Ask clarifying questions when needed.
Maintain warmth but increase logic.
`.trim(),
  },

  TIER_3: {
    tier: 'TIER_3',
    instruction: `
You are operating in TIER 3 mode.
Prioritize logical clarity.
Be direct and structured.
Minimize emotional cushioning.
Provide reasoning breakdowns.
Maintain awareness but lead with logic.
`.trim(),
  },
};
