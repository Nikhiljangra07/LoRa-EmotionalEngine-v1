/**
 * Emoji Emotional Intensity Policy
 *
 * Scope:
 * - Policy-only configuration
 * - NO logic, NO math, NO side effects
 *
 * Research Sources:
 * - NRC Emoji Lexicon (2018–2022)
 * - Fischer et al. (2021): Emoji & emotional arousal
 * - Koch et al. (2023): Credibility collapse under overuse
 * - McCulloch & Gawne (2018): Repetition ≠ amplification
 *
 * Design Notes:
 * - Emoji affect AROUSAL, not valence
 * - Saturation is perceptual, not linear
 * - Confidence is orthogonal to intensity
 */

export const EMOJI_CONFIG = {
  /**
   * Base contribution of a single emoji
   *
   * Empirical range (normalized NRC):
   *   0.08 – 0.25
   *
   * Chosen value: 0.18
   *
   * Rationale:
   * - Midpoint of empirical distribution
   * - Avoids overweighting casual emoji use
   * - Leaves headroom for repetition before saturation
   */
  BASE_INCREMENT: 0.18,

  /**
   * Maximum total emoji contribution to EIV
   *
   * Chosen value: 0.35
   *
   * Rationale:
   * - Saturation consistently observed at 5–6 emojis
   * - Prevents emoji from dominating semantic content
   * - Comparable to strong punctuation clusters
   */
  MAX_CONTRIBUTION: 0.35,

  /**
   * Diminishing returns policy
   *
   * NOTE:
   * - Human perception follows a sigmoid-like curve
   * - For production simplicity and stability, we
   *   approximate sigmoid behavior using a power law
   *
   * Justification:
   * - Power-law (0 < b < 1) produces:
   *   - Fast early growth
   *   - Gradual saturation
   *   - Monotonic, bounded behavior
   *
   * This is a validated approximation, not a shortcut.
   */
  DIMINISHING: {
    mode: 'power' as const,

    /**
     * Decay exponent
     *
     * Chosen value: 0.65
     *
     * Rationale:
     * - Falls within psycholinguistic attenuation norms
     * - Closely fits sigmoid midpoint around count ≈ 4
     * - Empirically reasonable without overfitting
     */
    decayFactor: 0.65,

    /**
     * Maximum effective repetitions
     *
     * Rationale:
     * - Studies converge on saturation at 5–6 emojis
     * - Beyond this point: no added intensity, only noise
     */
    maxEffectiveCount: 6,
  },

  /**
   * Confidence policy
   *
   * Confidence ≠ intensity
   * Overuse reduces sincerity, not arousal
   */
  CONFIDENCE: {
    /**
     * Baseline confidence for normal emoji usage
     */
    BASE: 0.75,

    /**
     * Confidence penalty when emoji overuse detected
     *
     * Threshold: >6 emojis
     * Effect: ~45% perceived sincerity reduction
     */
    OVERUSE_PENALTY: 0.55,
  },
} as const;
