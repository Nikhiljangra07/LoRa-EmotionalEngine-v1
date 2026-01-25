// src/emotion-core/config/capitalization.config.ts

/**
 * Layer 2: POLICY & RESEARCH
 *
 * Capitalization encodes vocal loudness / shouting in text.
 * It is a HIGH-SIGNAL, NON-SEMANTIC intensity amplifier.
 *
 * ❌ No logic here
 * ❌ No detection
 * ✅ Policy-only constants
 */

/* ============================================================================
 * RESEARCH FOUNDATION
 * ============================================================================
 *
 * Core Sources:
 *
 * 1. Hutto & Gilbert (2014) — VADER
 *    - ALL-CAPS was the SINGLE strongest intensity modifier
 *    - Empirical boost ≈ +0.733 (compound sentiment scale)
 *
 * 2. Prosody & stress literature
 *    - Capitalization maps to loudness / vocal effort
 *    - Loudness correlates strongly with arousal (not valence)
 *
 * 3. Circumplex Model of Affect (Russell)
 *    - Capitalization affects arousal axis only
 *
 * 4. Measurement theory (Bose et al., 2021)
 *    - Effects must be bounded and saturating
 *
 * Interpretation:
 * - ALL-CAPS ≈ shouting
 * - Partial caps ≈ emphasis
 * - Mixed case ≈ baseline
 */

/* ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

export const CAPITALIZATION_CONFIG = {
  /**
   * Base weight for ALL-CAPS tokens
   *
   * Scale: [0, 1]
   *
   * Chosen Value: 0.75
   * Defensible Range: [0.70, 0.80]
   *
   * Rationale:
   * - VADER empirical ≈ 0.733 (normalized)
   * - Slightly above exclamation (0.7) to reflect loudness dominance
   * - Still leaves headroom for mixed punctuation + repetition
   */
  // Derived from VADER: 0.733 / 4 ≈ 0.18 (normalized EIV scale)
    BASE_WEIGHT: 0.18,


  /**
   * Maximum total contribution from capitalization
   *
   * Chosen Value: 0.30
   *
   * Rationale:
   * - Prevents domination of EIV by casing alone
   * - Allows emphasis without overwhelming semantic content
   * - Comparable to 2–3 exclamation marks
   *
   * Interpretation:
   * - "STOP" can be intense
   * - But not equal to extreme emotional overflow
   */
  MAX_CONTRIBUTION: 0.30,

  /**
   * Partial capitalization scaling
   *
   * Example:
   * - "This is BAD" → partial
   * - "THIS IS BAD" → full
   *
   * Chosen Value: 0.5
   *
   * Rationale:
   * - Partial caps signal emphasis, not shouting
   * - Half-strength matches perceptual intuition
   */
  PARTIAL_MULTIPLIER: 0.5,

  /**
   * Minimum token length for capitalization to count
   *
   * Rationale:
   * - Ignore noise like "OK", "ID", "US"
   * - Avoid false positives on acronyms
   */
  MIN_TOKEN_LENGTH: 3,

  /**
   * Confidence boost from capitalization
   *
   * Research:
   * - ALL-CAPS indicates deliberate emphasis
   * - Less ambiguity than punctuation alone
   *
   * Heuristic but defensible
   */
  CONFIDENCE_BOOST: 0.1,
} as const;
