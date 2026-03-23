// ──────────────────────────────────────────────────────
// Fixed vocabularies for LoRa Memory V2
// All categorical fields MUST use these types.
// No free-text strings. Ever.
// ──────────────────────────────────────────────────────

/** Ekman-6 primary emotions (shared with waveform engine + backend) */
export const EKMAN_EMOTIONS = [
  'joy', 'anger', 'fear', 'sadness', 'disgust', 'surprise',
] as const;
export type EkmanEmotion = (typeof EKMAN_EMOTIONS)[number];

/** Context categories — broad labels for what the conversation is about */
export const CONTEXT_CATEGORIES = [
  'career', 'relationship', 'family', 'health', 'finance',
  'identity', 'social', 'education', 'creative', 'existential',
] as const;
export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

/** Relational tone — how the user relates to LoRa in this session */
export const RELATIONAL_TONES = [
  'defensive', 'open', 'confrontational', 'avoidant',
  'collaborative', 'dependent', 'testing',
] as const;
export type RelationalTone = (typeof RELATIONAL_TONES)[number];

/** Emotional undertones — secondary emotional colors (max 3 per fingerprint) */
export const UNDERTONE_VOCABULARY = [
  'nostalgia', 'urgency', 'warmth', 'tension', 'playfulness',
  'resignation', 'determination', 'confusion', 'relief', 'guilt',
  'loneliness', 'pride', 'shame', 'hope', 'dread',
] as const;
export type Undertone = (typeof UNDERTONE_VOCABULARY)[number];

/** LoRa's strategies — what approach she used in a given turn */
export const LORA_STRATEGIES = [
  'clarify', 'push_for_decision', 'reframe', 'project_consequence',
  'name_contradiction', 'name_loop', 'hold_space', 'redirect',
  'challenge', 'summarize', 'ask_diagnostic',
] as const;
export type LoRaStrategy = (typeof LORA_STRATEGIES)[number];

/** User responses — how the user reacted to LoRa's intervention */
export const USER_RESPONSES = [
  'engaged', 'deflected', 'escalated', 'shifted_position',
  'disengaged', 'asked_followup', 'agreed', 'resisted',
  'went_silent', 'changed_topic',
] as const;
export type UserResponse = (typeof USER_RESPONSES)[number];

/** Resistance patterns — dominant user behavior under pressure */
export const RESISTANCE_PATTERNS = [
  'deflect', 'confront', 'comply', 'withdraw',
  'intellectualize', 'loop', 'externalize',
] as const;
export type ResistancePattern = (typeof RESISTANCE_PATTERNS)[number];

/** Avoidance signals — what the user is avoiding */
export const AVOIDANCE_VOCABULARY = [
  'financial_risk', 'partner_reaction', 'social_judgment', 'failure',
  'commitment', 'conflict', 'change', 'responsibility', 'vulnerability',
  'loss_of_control', 'uncertainty', 'rejection',
] as const;
export type AvoidanceSignal = (typeof AVOIDANCE_VOCABULARY)[number];

/** Tension vocabulary — core conflicts identified by LoRa */
export const TENSION_VOCABULARY = [
  'security_vs_growth', 'loyalty_vs_self', 'speed_vs_quality',
  'independence_vs_support', 'honesty_vs_harmony', 'ambition_vs_stability',
  'present_vs_future', 'control_vs_trust', 'duty_vs_desire',
] as const;
export type Tension = (typeof TENSION_VOCABULARY)[number];

/** User tier levels */
export const TIERS = ['TIER_1', 'TIER_2', 'TIER_3'] as const;
export type Tier = (typeof TIERS)[number];
