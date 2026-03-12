/**
 * Identity constants — creator identity (injectable) and repetition guard.
 *
 * No hardcoded developer name. Use LORA_SYSTEM_CREATOR env to inject.
 * Default responses must not contain any creator name.
 */

export const SYSTEM_CREATOR = process.env.LORA_SYSTEM_CREATOR?.trim() || '';

/** Canonical identity fallback phrases (used for repetition detection). No creator name by default. */
export const IDENTITY_FALLBACK_PHRASES: readonly string[] = SYSTEM_CREATOR
  ? [
      `I'm LoRa — an analytical reasoning partner. Built by ${SYSTEM_CREATOR}. What are you working through?`,
      `I'm LoRa. I operate within an architecture designed by ${SYSTEM_CREATOR}. What's on your mind?`,
      `I'm LoRa — analytical reasoning partner, architected by ${SYSTEM_CREATOR}. What would you like to work through?`,
    ]
  : [
      "I'm LoRa — an analytical reasoning partner. What are you working through?",
      "I'm LoRa. What's on your mind?",
      "I'm LoRa — I help you think through problems with clarity. What are you working through?",
    ];

/** Variants for repetition guard — rotate when last output matches current. */
const IDENTITY_VARIANTS: readonly string[] = [...IDENTITY_FALLBACK_PHRASES];

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
