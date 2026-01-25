/**
 * Layer 2: POLICY & RESEARCH — Punctuation
 *
 * This file defines BELIEFS, not math.
 * All numeric values must be defensible or explicitly heuristic.
 * No calculations. No decay logic. No iteration.
 */

/* ============================================================================
 * BASE EMOTIONAL WEIGHTS (unchanged)
 * ========================================================================== */

export const BASE_WEIGHTS = {
  EXCLAMATION: 0.7,
  QUESTION: 0.5,
  ELLIPSIS: 0.2,
  MIXED: 0.8,
  TRAILING_ELLIPSIS: 0.3,
  PERIOD: 0.05,
} as const;

/**
 * 🔁 COMPATIBILITY ALIAS (REQUIRED)
 */
export const PUNCTUATION_BASE_WEIGHTS = BASE_WEIGHTS;

/* ============================================================================
 * DIMINISHING RETURNS POLICY (LOGARITHMIC — DECLARATIVE ONLY)
 * ========================================================================== */

/**
 * Repetition scaling philosophy for punctuation
 *
 * Research Backbone:
 * - VADER (Hutto & Gilbert, 2014): diminishing amplification
 * - Psycholinguistics: perceptual saturation after 3–5 repetitions
 * - Measurement theory: bounded arousal scale
 *
 * Key Decision:
 * ❌ Linear growth is NOT a belief
 * ✅ Logarithmic decay IS the declared policy
 */
export const PUNCTUATION_DIMINISHING_POLICY = {
  /**
   * Base increment contributed by the FIRST repetition beyond baseline
   *
   * Origin:
   * - VADER normalized effect ≈ 0.03–0.036
   * - 0.0262 chosen (~25–30% conservative)
   *
   * Role:
   * - Anchor magnitude (NOT a linear step)
   * - Downstream math applies decay
   */
  baseIncrement: 0.0262,

  /**
   * Maximum cumulative contribution from repetition alone
   *
   * Rationale:
   * - Prevents punctuation from overpowering lexical emotion
   * - Ensures punctuation remains an amplifier, not a driver
   *
   * Test Requirement:
   * - Extreme repetition must plateau > 0.85 but ≤ 1.0
   */
  maxContribution: 0.85,

  /**
   * Declared decay model
   *
   * Interpretation:
   * - Shape-only declaration
   * - No computation performed here
   */
  mode: 'logarithmic' as const,

  /**
   * Decay curvature factor
   *
   * Interpretation:
   * - Multiplies ln(n + 1) downstream
   * - Controls early saturation steepness
   *
   * Empirical Range:
   * - [0.9, 1.2]
   * - 1.1 chosen to plateau ~4–5 marks
   *
   * Status: HEURISTIC (explicit)
   */
  decayFactor: 1.1,

  /**
   * Maximum repetitions that meaningfully contribute
   *
   * Research:
   * - VADER qualitative notes: diminishing returns beyond 4–5
   * - Repetition credibility decay after saturation
   *
   * Policy:
   * - Hard perceptual cap
   * - Excess marks express style, not added emotion
   */
  maxEffectiveCount: 5,
} as const;

/* ============================================================================
 * GLOBAL BOUNDS & FILTERS
 * ========================================================================== */

export const MAX_INTENSITY = 1.0;

export const MIN_INTENSITY_THRESHOLD = 0.01;

/* ============================================================================
 * AGGREGATION & PRECEDENCE (unchanged)
 * ========================================================================== */

export const AGGREGATION_STRATEGY = 'MAX' as const;

export const PRECEDENCE_ORDER = [
  'MIXED',
  'EXCLAMATION',
  'QUESTION',
  'TRAILING_ELLIPSIS',
  'ELLIPSIS',
] as const;

/* ============================================================================
 * CONFIDENCE POLICY (unchanged, heuristic)
 * ========================================================================== */

export const CONFIDENCE_BY_REPETITION = {
  SINGLE: 0.7,
  DOUBLE: 0.8,
  TRIPLE: 0.85,
  EXCESSIVE: 0.9,
} as const;

export const POSITION_MODIFIERS = {
  start: 1.0,
  mid: 0.95,
  end: 1.05,
} as const;
