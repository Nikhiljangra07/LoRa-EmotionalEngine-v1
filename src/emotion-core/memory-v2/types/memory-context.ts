import type { SessionFingerprint } from './session-fingerprint';
import type { FactAnchor } from './fact-anchor';

// ──────────────────────────────────────────────────────
// MemoryContext — the result of emotion-anchored retrieval
// This is what LoRa receives to inform her next response.
// ──────────────────────────────────────────────────────

/**
 * Response mode determines how LoRa uses the recalled memory.
 *
 * - silent:  Adjust tone based on recalled emotional history.
 *            User feels understood without knowing why. (default)
 * - subtle:  "This feels familiar, doesn't it?" (similarity > 0.80)
 * - direct:  "You had this same energy when..." (similarity > 0.90 + same context)
 */
export type ResponseMode = 'silent' | 'subtle' | 'direct';

/** A matched past session with its similarity score */
export interface MatchedSession {
  fingerprint: SessionFingerprint;
  similarity: number;
}

export interface MemoryContext {
  /** Past sessions that matched emotionally, with scores */
  matchedSessions: MatchedSession[];
  /** Facts from the matched sessions' graph data */
  relatedFacts: FactAnchor[];
  /** How LoRa should use this memory */
  responseMode: ResponseMode;
  /** The highest similarity score among matches */
  topSimilarity: number;
}
