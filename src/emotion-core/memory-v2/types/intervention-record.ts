import type {
  LoRaStrategy,
  UserResponse,
  Tier,
  ContextCategory,
} from './vocabularies';

// ──────────────────────────────────────────────────────
// InterventionRecord — one per LoRa response turn
// The ML training gold: what LoRa did → what happened next
// ──────────────────────────────────────────────────────

export interface InterventionRecord {
  sessionId: string;
  turn: number;

  // ── What LoRa did ──
  /** Strategy LoRa used this turn */
  loraStrategy: LoRaStrategy;
  /** How hard LoRa pushed (0–1) */
  loraIntensity: number;

  // ── What happened next ──
  /** How the user responded */
  userResponse: UserResponse;
  /** Change in EIV from this turn to next */
  eivDelta: number;

  // ── Context ──
  tier: Tier;
  /** ETV band label */
  etvBand: string;
  /** Position in session */
  turnInSession: number;
  /** Topic category */
  contextCategory: ContextCategory;
}
