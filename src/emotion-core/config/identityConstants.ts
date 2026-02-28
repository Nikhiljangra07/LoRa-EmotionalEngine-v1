/**
 * Identity constants — stable creator identity and repetition guard.
 */

export const SYSTEM_CREATOR = 'Nikhil';

/** Canonical identity fallback phrases (used for repetition detection). */
export const IDENTITY_FALLBACK_PHRASES: readonly string[] = [
  "I'm LoRa. I operate within an architecture designed by Nikhil. What would you like to explore?",
  "I'm LoRa. My framework was built by Nikhil. What's on your mind?",
  "I'm LoRa. I run on a system architected by Nikhil. What would you like to explore?",
];

/** Variants for repetition guard — rotate when last output matches current. */
const IDENTITY_VARIANTS: readonly string[] = [
  "I'm LoRa. I operate within an architecture designed by Nikhil. What would you like to explore?",
  "I'm LoRa. My framework was built by Nikhil. What's on your mind?",
  "I'm LoRa. I run on a system architected by Nikhil. What would you like to explore?",
];

/**
 * If override equals last assistant output (identity repetition), return next variant.
 * Otherwise return override unchanged.
 */
export function applyIdentityRepetitionGuard(
  override: string,
  lastAssistantOutput?: string
): string {
  if (!lastAssistantOutput?.trim()) return override;
  const last = lastAssistantOutput.trim();
  const overrideTrimmed = override.trim();
  if (last !== overrideTrimmed) return override;

  const idx = IDENTITY_VARIANTS.indexOf(overrideTrimmed);
  const nextIdx = idx >= 0 ? (idx + 1) % IDENTITY_VARIANTS.length : 0;
  return IDENTITY_VARIANTS[nextIdx];
}
