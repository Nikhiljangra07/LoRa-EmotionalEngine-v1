/**
 * Valence Analyzer Configuration (V1)
 *
 * Grounded in dimensional affect theory (valence axis).
 * No emotion categories, no expressivity coupling.
 */
export const VALENCE_CONFIG = {
  thresholds: {
    minMagnitude: 0.15,
  },
  confidence: {
    minAffectiveTokens: 2,
    lowEvidenceMultiplier: 0.5,
  },
  negation: {
    attenuation: 0.5,
  },
  normalization: {
    epsilon: 1e-6,
    minScore: -1,
    maxScore: 1,
  },
} as const;
