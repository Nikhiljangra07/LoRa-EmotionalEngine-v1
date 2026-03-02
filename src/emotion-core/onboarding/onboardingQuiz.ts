/**
 * Onboarding quiz — minimal categorical prefs without ML.
 * Pure mapping; returns small stable anchors for prompt/behavior calibration.
 */

export type PreferredTone = 'direct' | 'gentle' | 'logical';
export type GoalOrientation = 'support' | 'clarity' | 'growth';

export interface OnboardingInput {
  name?: string;
  preferredTone?: string;
  goalOrientation?: string;
}

export interface OnboardingPreferences {
  name?: string;
  preferredTone: PreferredTone;
  goalOrientation: GoalOrientation;
}

const TONE_MAP: Record<string, PreferredTone> = {
  direct: 'direct',
  gentle: 'gentle',
  logical: 'logical',
  supportive: 'gentle',
  warm: 'gentle',
  structured: 'logical',
  clear: 'logical',
};

const GOAL_MAP: Record<string, GoalOrientation> = {
  support: 'support',
  clarity: 'clarity',
  growth: 'growth',
  help: 'support',
  understand: 'clarity',
  progress: 'growth',
  advance: 'growth',
};

/**
 * Parse raw onboarding input into categorical preferences.
 * Pure function; no side effects.
 */
export function parseOnboardingInput(input: OnboardingInput): OnboardingPreferences {
  const name = typeof input.name === 'string' && input.name.trim().length > 0
    ? input.name.trim().slice(0, 64)
    : undefined;

  const toneRaw = (input.preferredTone ?? '').toLowerCase().trim();
  const preferredTone: PreferredTone = TONE_MAP[toneRaw] ?? 'gentle';

  const goalRaw = (input.goalOrientation ?? '').toLowerCase().trim();
  const goalOrientation: GoalOrientation = GOAL_MAP[goalRaw] ?? 'support';

  return { name, preferredTone, goalOrientation };
}
