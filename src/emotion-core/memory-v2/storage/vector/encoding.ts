import type { EmotionalFingerprint, StructuralDynamic } from '../../types';
import {
  EKMAN_EMOTIONS,
  UNDERTONE_VOCABULARY,
  CONTEXT_CATEGORIES,
  RELATIONAL_TONES,
  STRUCTURAL_FRAMEWORKS,
} from '../../types';

// ──────────────────────────────────────────────────────
// Fingerprint → Vector encoding
// Converts an EmotionalFingerprint into a 256-dim float vector
// for cosine similarity search in the vector DB.
//
// Layout (256 dimensions total):
//   [0-5]     Ekman-6 primary emotion (one-hot, scaled by intensity)
//   [6-20]    Undertone presence (multi-hot, 15 slots)
//   [21]      Intensity (raw float 0-1)
//   [22-31]   Context category (one-hot)
//   [32-38]   Relational tone (one-hot)
//   [39-43]   Structural framework (one-hot, 5 dims — regression/bayesian/game_theory/constraint/causal_loop)
//   [44-255]  Reserved / zero-padded
//
// Total meaningful dims: 44. The remaining 212 are padding
// to meet the 256-dim minimum (CLAUDE.md requirement).
// When we add more features later, they fill the reserved space.
// ──────────────────────────────────────────────────────

export const VECTOR_DIMS = 256;

/**
 * Encode an EmotionalFingerprint into a 256-dim vector.
 * Optionally includes structural framework encoding in dims [39-43].
 */
export function encodeFingerprint(fp: EmotionalFingerprint, structuralDynamic?: StructuralDynamic): number[] {
  const vec = new Array<number>(VECTOR_DIMS).fill(0);

  // [0-5] Primary emotion — one-hot scaled by intensity
  // Scaling by intensity makes high-intensity fear different from low-intensity fear
  const primaryIdx = EKMAN_EMOTIONS.indexOf(fp.primary);
  if (primaryIdx >= 0) {
    vec[primaryIdx] = fp.intensity > 0 ? fp.intensity : 0.5;
  }

  // [6-20] Undertone presence — multi-hot (1.0 if present, 0 if not)
  for (const undertone of fp.undertones) {
    const utIdx = UNDERTONE_VOCABULARY.indexOf(undertone);
    if (utIdx >= 0) {
      vec[6 + utIdx] = 1.0;
    }
  }

  // [21] Raw intensity
  vec[21] = fp.intensity;

  // [22-31] Context category — one-hot
  const ctxIdx = CONTEXT_CATEGORIES.indexOf(fp.contextCategory);
  if (ctxIdx >= 0) {
    vec[22 + ctxIdx] = 1.0;
  }

  // [32-38] Relational tone — one-hot
  const toneIdx = RELATIONAL_TONES.indexOf(fp.relationalTone);
  if (toneIdx >= 0) {
    vec[32 + toneIdx] = 1.0;
  }

  // [39-43] Structural framework — one-hot (only if structural data exists)
  // Old fingerprints have zeros here — cosine similarity treats as "no opinion"
  if (structuralDynamic) {
    const fwIdx = STRUCTURAL_FRAMEWORKS.indexOf(structuralDynamic.dominantFramework);
    if (fwIdx >= 0) {
      vec[39 + fwIdx] = 1.0;
    }
  }

  return vec;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0-1 (vectors should never be anti-correlated given our encoding).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
