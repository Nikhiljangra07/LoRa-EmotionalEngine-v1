import type { PromptProfile, QuestionBudgetHint, ValidationIntensity, ToneHint } from '../types/logging.types';

export type RelationalTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface TierPolicy {
  tier: RelationalTier;
  description: string;
  allowedGuidanceModes: ReadonlySet<PromptProfile['guidanceMode']>;
  maxQuestionBudget: QuestionBudgetHint;
  validationIntensityCap: ValidationIntensity;
  defaultToneHint?: ToneHint;
  actionHintsAllowed: boolean;
}

const SAFETY_MODES: ReadonlySet<PromptProfile['guidanceMode']> = new Set([
  'CONTAINMENT',
  'DE_ESCALATE',
  'STABILIZE',
]);

export { SAFETY_MODES };

const ALL_GUIDANCE_MODES: ReadonlySet<PromptProfile['guidanceMode']> = new Set([
  'CALM_NEUTRAL',
  'ENERGY_MATCH',
  'VALIDATING',
  'DE_ESCALATE',
  'SUPPORTIVE',
  'STABILIZE',
  'SUPPORTIVE_REFLECTION',
  'STABILIZING',
  'CONTAINMENT',
  'FALLBACK',
]);

const TIER_POLICIES: Readonly<Record<RelationalTier, TierPolicy>> = {
  TIER_1: {
    tier: 'TIER_1',
    description: 'Conservative',
    allowedGuidanceModes: new Set<PromptProfile['guidanceMode']>([
      'CALM_NEUTRAL',
      'SUPPORTIVE_REFLECTION',
      // Safety modes always allowed (enforced separately)
      'CONTAINMENT',
      'DE_ESCALATE',
      'STABILIZE',
      'FALLBACK',
    ]),
    maxQuestionBudget: 'ONE',
    validationIntensityCap: 'LOW',
    defaultToneHint: 'GENTLE',
    actionHintsAllowed: false,
  },
  TIER_2: {
    tier: 'TIER_2',
    description: 'Balanced',
    allowedGuidanceModes: new Set<PromptProfile['guidanceMode']>([
      'CALM_NEUTRAL',
      'SUPPORTIVE_REFLECTION',
      'STABILIZING',
      'ENERGY_MATCH',
      // Safety modes always allowed
      'CONTAINMENT',
      'DE_ESCALATE',
      'STABILIZE',
      'FALLBACK',
      'SUPPORTIVE',
      'VALIDATING',
    ]),
    maxQuestionBudget: 'ONE',
    validationIntensityCap: 'MEDIUM',
    actionHintsAllowed: true,
  },
  TIER_3: {
    tier: 'TIER_3',
    description: 'Direct',
    allowedGuidanceModes: ALL_GUIDANCE_MODES,
    maxQuestionBudget: 'ONE',
    validationIntensityCap: 'HIGH',
    actionHintsAllowed: true,
  },
};

export function getTierPolicy(tier: RelationalTier): TierPolicy {
  return TIER_POLICIES[tier];
}
