import type { EmotionalFingerprint, StructuralDynamic } from '../types';

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

/** Weights — rebalanced to include structural similarity */
const W_EMOTION = 0.30;
const W_UNDERTONE = 0.20;
const W_INTENSITY = 0.15;
const W_CONTEXT = 0.10;
const W_STRUCTURE = 0.15;

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
 * Word-level Jaccard similarity between two short labels.
 * Used for structural label comparison.
 */
function wordJaccard(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Structural similarity: compares framework match + label overlap.
 * Returns 0 if either fingerprint lacks structural data (no penalty, no boost).
 */
function structuralSimilarity(
  currentSD?: StructuralDynamic,
  pastSD?: StructuralDynamic,
): number {
  if (!currentSD || !pastSD) return 0;
  let score = 0;
  // Framework match: 60% of structural weight
  if (currentSD.dominantFramework === pastSD.dominantFramework) {
    score += 0.6;
  }
  // Label word overlap: 40% of structural weight
  score += 0.4 * wordJaccard(currentSD.label, pastSD.label);
  return score;
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
 * - Same structural framework + similar label = strong structural match
 */
export function computeSimilarity(
  current: EmotionalFingerprint,
  past: EmotionalFingerprint,
  currentSD?: StructuralDynamic,
  pastSD?: StructuralDynamic,
): number {
  const emo = emotionMatch(current, past);
  const und = undertoneOverlap(current, past);
  const int = intensityDistance(current, past);
  const ctx = contextSimilarity(current, past);
  const str = structuralSimilarity(currentSD, pastSD);

  // If neither fingerprint has structural data, redistribute the structural
  // weight proportionally to preserve exact old-vs-old ranking
  const hasStructure = currentSD && pastSD;
  if (!hasStructure) {
    // Old weights summed to 0.90 (without recency). Redistribute W_STRUCTURE
    // proportionally so old comparisons produce identical rankings.
    const oldTotal = W_EMOTION + W_UNDERTONE + W_INTENSITY + W_CONTEXT; // 0.75
    const score =
      (W_EMOTION / oldTotal) * 0.90 * emo +
      (W_UNDERTONE / oldTotal) * 0.90 * und +
      (W_INTENSITY / oldTotal) * 0.90 * int +
      (W_CONTEXT / oldTotal) * 0.90 * ctx;
    const clamped = Math.max(0, Math.min(1, score));
    return Number.isFinite(clamped) ? clamped : 0;
  }

  const score =
    W_EMOTION * emo +
    W_UNDERTONE * und +
    W_INTENSITY * int +
    W_CONTEXT * ctx +
    W_STRUCTURE * str;

  // Clamp to [0, 1] — NaN from corrupted intensity falls to 0
  const clamped = Math.max(0, Math.min(1, score));
  return Number.isFinite(clamped) ? clamped : 0;
}

// Export sub-functions for testing
export { emotionMatch, undertoneOverlap, intensityDistance, contextSimilarity, structuralSimilarity, wordJaccard };
export { W_EMOTION, W_UNDERTONE, W_INTENSITY, W_CONTEXT, W_STRUCTURE };
