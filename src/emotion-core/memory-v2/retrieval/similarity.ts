import type { EmotionalFingerprint } from '../types';

// ──────────────────────────────────────────────────────
// Emotion-Anchored Similarity Scoring
//
// This is the core innovation: retrieval by emotional shape,
// not by topic. Career anxiety and relationship anxiety match
// because the emotional fingerprint is similar.
//
// Weighted formula (from CLAUDE.md):
//   0.35 * emotion_match
//   0.25 * undertone_overlap
//   0.20 * intensity_distance
//   0.10 * context_similarity
//   0.10 * recency_boost
//
// recency_boost requires a timestamp, so computeSimilarity()
// handles the first four factors (0–0.90 range).
// The caller (retriever) adds recency_boost separately.
// ──────────────────────────────────────────────────────

/** Weights from CLAUDE.md retrieval spec */
const W_EMOTION = 0.35;
const W_UNDERTONE = 0.25;
const W_INTENSITY = 0.20;
const W_CONTEXT = 0.10;

/**
 * Emotion match: 1.0 if same primary emotion, 0.0 if different.
 * Binary — the primary emotion IS the anchor.
 */
function emotionMatch(current: EmotionalFingerprint, past: EmotionalFingerprint): number {
  return current.primary === past.primary ? 1.0 : 0.0;
}

/**
 * Undertone overlap: Jaccard similarity over the undertone sets.
 * |intersection| / |union|
 */
function undertoneOverlap(current: EmotionalFingerprint, past: EmotionalFingerprint): number {
  const currentSet = new Set(current.undertones);
  const pastSet = new Set(past.undertones);

  let intersection = 0;
  for (const u of currentSet) {
    if (pastSet.has(u)) intersection++;
  }

  const union = new Set([...currentSet, ...pastSet]).size;
  if (union === 0) return 0;

  return intersection / union;
}

/**
 * Intensity distance: 1.0 when intensities are identical, 0.0 when maximally different.
 * Linear inverse of absolute difference.
 */
function intensityDistance(current: EmotionalFingerprint, past: EmotionalFingerprint): number {
  return 1.0 - Math.abs(current.intensity - past.intensity);
}

/**
 * Context similarity: 1.0 if same context category, 0.0 if different.
 * Binary — context is a secondary signal, not the primary anchor.
 */
function contextSimilarity(current: EmotionalFingerprint, past: EmotionalFingerprint): number {
  return current.contextCategory === past.contextCategory ? 1.0 : 0.0;
}

/**
 * Compute the similarity score between two emotional fingerprints.
 *
 * Returns 0–0.90 (without recency boost).
 * The retriever adds the 0.10 recency boost based on timestamp.
 *
 * This function is the heart of emotion-anchored retrieval:
 * - Same emotion + same undertones + similar intensity = very high match
 * - Same emotion + different context = still a strong match
 * - Different emotion + same context = weak match
 */
export function computeSimilarity(
  current: EmotionalFingerprint,
  past: EmotionalFingerprint,
): number {
  const score =
    W_EMOTION * emotionMatch(current, past) +
    W_UNDERTONE * undertoneOverlap(current, past) +
    W_INTENSITY * intensityDistance(current, past) +
    W_CONTEXT * contextSimilarity(current, past);

  // Clamp to [0, 1] — should already be in range but be safe
  return Math.max(0, Math.min(1, score));
}

// Export sub-functions for testing
export { emotionMatch, undertoneOverlap, intensityDistance, contextSimilarity };
export { W_EMOTION, W_UNDERTONE, W_INTENSITY, W_CONTEXT };
