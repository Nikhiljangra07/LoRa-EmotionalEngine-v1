import type {
  EkmanEmotion,
  Undertone,
  ContextCategory,
  RelationalTone,
  AvoidanceSignal,
  Tension,
} from './vocabularies';

// ──────────────────────────────────────────────────────
// SessionFingerprint — one per session, the primary unit of memory
// Extracted at session end from the structured summary + EIV curve
// ──────────────────────────────────────────────────────

export interface EmotionalFingerprint {
  /** Primary emotion from Ekman-6 */
  primary: EkmanEmotion;
  /** Secondary emotional colors — max 3 */
  undertones: [Undertone] | [Undertone, Undertone] | [Undertone, Undertone, Undertone];
  /** Average EIV intensity (0–1) */
  intensity: number;
  /** Broad topic category */
  contextCategory: ContextCategory;
  /** How the user related to LoRa this session */
  relationalTone: RelationalTone;
}

export interface DecisionPattern {
  /** How many times user circled back to the same topic */
  topicRevisits: number;
  /** Did the user commit to a path? */
  decisionReached: boolean;
  /** What the user is avoiding — from AVOIDANCE_VOCABULARY */
  avoidanceSignals: AvoidanceSignal[];
  /** The core conflict LoRa identified */
  primaryTension: Tension;
}

export interface StyleSnapshot {
  /** Average words per user message */
  avgWordsPerMessage: number;
  /** Ratio of questions to total messages (0–1) */
  questionRatio: number;
  /** Communication directness score (0–1) */
  directness: number;
}

export interface SessionFingerprint {
  sessionId: string;
  userId: string;
  /** ISO date string */
  timestamp: string;

  // ── EIV curve (computed during session, already exists in backend) ──
  /** EIV value per turn, e.g. [0.3, 0.5, 0.7, 0.4] */
  eivCurve: number[];
  /** Maximum EIV in session */
  peakIntensity: number;
  /** Which turn peaked */
  peakTurn: number;
  /** Did intensity come down before session end? */
  resolution: boolean;

  // ── Emotional fingerprint (NEW — core of emotion-anchored memory) ──
  emotionalFingerprint: EmotionalFingerprint;

  // ── Decision pattern (NEW — tracks how user processes decisions) ──
  decisionPattern: DecisionPattern;

  // ── Communication style snapshot ──
  styleSnapshot: StyleSnapshot;

  // ── Decay metadata ──
  /** Importance score for decay (1–10) */
  importanceScore: number;
  /** ISO date, updated on retrieval */
  lastAccessed: string;
  /** Number of times this fingerprint has been accessed */
  accessCount: number;
}
