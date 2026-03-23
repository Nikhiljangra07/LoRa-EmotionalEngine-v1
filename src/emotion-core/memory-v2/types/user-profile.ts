import type {
  EkmanEmotion,
  ResistancePattern,
  LoRaStrategy,
} from './vocabularies';
import type { SessionFingerprint } from './session-fingerprint';

// ──────────────────────────────────────────────────────
// UserProfile — one per user, evolves across sessions
// The trajectory: how does this user think and change?
// ──────────────────────────────────────────────────────

export interface CommunicationStyle {
  /** How much the user talks (0–1) */
  verbosity: number;
  /** How emotionally dense messages are (0–1) */
  emotionalDensity: number;
  /** How direct the user is (0–1) */
  directness: number;
  /** Dominant behavior under pressure */
  resistancePattern: ResistancePattern;
}

export interface EmotionalBaseline {
  /** Rolling average EIV across sessions */
  avgEIV: number;
  /** Rolling average valence across sessions */
  avgValence: number;
  /** Most frequent primary emotion */
  typicalPrimary: EkmanEmotion;
  /** Session-to-session EIV variance */
  volatility: number;
}

export interface ResponseProfile {
  /** Strategy that works best for this user */
  bestStrategy: LoRaStrategy;
  /** Strategy that works worst for this user */
  worstStrategy: LoRaStrategy;
  /** How much pushing before disengage (0–1) */
  pushTolerance: number;
}

export interface UserProfile {
  userId: string;
  sessionsCompleted: number;
  /** ISO date */
  firstSeen: string;
  /** ISO date */
  lastSeen: string;

  communicationStyle: CommunicationStyle;
  emotionalBaseline: EmotionalBaseline;

  /** Top emotional fingerprints — most recent + highest intensity (max 5) */
  fingerprintLibrary: SessionFingerprint[];

  /** Aggregated from InterventionRecords */
  responseProfile: ResponseProfile;
}
