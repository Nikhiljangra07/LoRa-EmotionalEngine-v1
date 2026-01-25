// src/emotion-core/config/repetition.config.ts

/**
 * Layer 2: POLICY & RESEARCH
 *
 * Repetition encodes insistence, urgency, fixation, or emotional escalation.
 * It is a NON-SEMANTIC, TEMPORAL intensity amplifier.
 *
 * ❌ No detection logic
 * ❌ No mathematical decay functions
 * ❌ No diminishing-return computation
 * ✅ Policy-only constants with justification
 *
 * This file defines WHAT we believe about repetition —
 * not HOW repetition is calculated.
 */

/* ============================================================================
 * RESEARCH FOUNDATION
 * ============================================================================
 *
 * Core Sources:
 *
 * 1. Yus (2005) — Relevance Theory
 *    - Repetition increases cognitive salience
 *    - Signals insistence and relevance boosting
 *
 * 2. Sampietro (2016) — Expressive reduplication
 *    - Repetition encodes emotional escalation, not redundancy
 *
 * 3. Thompson et al. (2016)
 *    - Repetition correlates with urgency and emotional commitment
 *
 * 4. Psycholinguistics of emphasis
 *    - Marginal perceptual gain diminishes with repetition
 *
 * 5. Measurement Theory (Bose et al., 2021)
 *    - Bounded, saturating scales required for interpretability
 *
 * Interpretation:
 * - First repetition is highly informative
 * - Subsequent repetitions add less information
 * - Excessive repetition may reduce clarity
 */

/* ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

export const REPETITION_CONFIG = {
  /**
   * Base contribution of the FIRST repetition event
   *
   * Scale: [0, 1]
   *
   * Chosen Value: 0.08
   * Defensible Range: [0.06, 0.10]
   *
   * Rationale:
   * - Repetition is weaker than punctuation or capitalization
   * - Functions as insistence, not raw arousal
   * - Comparable to a subtle emphasis cue
   *
   * Interpretation:
   * - "no no" adds emotional pressure
   * - But does not dominate intensity alone
   */
  BASE_INCREMENT: 0.08,

  /**
   * Maximum total contribution from repetition
   *
   * Chosen Value: 0.25
   *
   * Rationale:
   * - Prevents fixation loops from overpowering EIV
   * - Comparable to ~3–4 exclamation marks
   * - Preserves dominance of semantic content
   *
   * Measurement logic:
   * - Repetition amplifies emotion
   * - But cannot create unlimited intensity
   */
  MAX_CONTRIBUTION: 0.25,

  /**
   * Diminishing returns mode
   *
   * Allowed Modes:
   * - 'linear'
   * - 'capped-linear'
   * - 'logarithmic'
   * - 'power'
   *
   * Chosen Mode: 'logarithmic'
   *
   * Rationale:
   * - Early repetitions are salient
   * - Later repetitions add rapidly diminishing value
   * - Matches VADER-style saturation behavior
   *
   * Research Alignment:
   * - Psycholinguistic attenuation
   * - Human sensitivity follows log-like curves
   */
  DIMINISHING_MODE: 'logarithmic',

  /**
   * Decay factor for diminishing curve
   *
   * Meaning (logarithmic mode):
   * - Multiplier on ln(n + 1)
   *
   * Chosen Value: 1.0
   * Defensible Range: [0.8, 1.2]
   *
   * Rationale:
   * - Neutral curvature
   * - Keeps BASE_INCREMENT interpretable
   * - Avoids aggressive early saturation
   */
  DECAY_FACTOR: 1.0,

  /**
   * Maximum effective repetition count
   *
   * Chosen Value: 6
   *
   * Rationale:
   * - Beyond ~5–6 repetitions, humans perceive noise
   * - Additional repetitions add no emotional information
   * - Prevents spam amplification ("no no no no no no no")
   *
   * Research:
   * - Attention saturation thresholds
   * - Expressive reduplication limits
   */
  MAX_EFFECTIVE_COUNT: 6,

  /**
   * Confidence adjustment from repetition
   *
   * Interpretation:
   * - Repetition signals deliberateness
   * - But excessive repetition reduces clarity
   *
   * Values:
   * - 1 repetition → low confidence
   * - 2–4 repetitions → high confidence
   * - 5+ repetitions → confidence decay
   *
   * ⚠️ Heuristic (qualitative effect is real; thresholds require calibration)
   */
  CONFIDENCE_PROFILE: {
    SINGLE: 0.6,
    FEW: 0.8,        // 2–4
    EXCESSIVE: 0.65, // 5+
  },
} as const;

/* ============================================================================
 * DECLARED HEURISTICS & GAPS
 * ============================================================================
 *
 * Research-backed:
 * ✅ Repetition as emotional intensifier
 * ✅ Diminishing perceptual returns
 * ✅ Saturation and boundedness
 *
 * Heuristic (explicit):
 * ⚠️ Exact base increment magnitude
 * ⚠️ Confidence thresholds
 * ⚠️ Exact saturation point (MAX_EFFECTIVE_COUNT)
 *
 * Action Items:
 * - Correlate repetition EIV with user correction rates
 * - Validate saturation threshold via A/B testing
 * - Tune decay factor against real conversational data
 *
 * ============================================================================
 */
