import { AnalyzerSignal } from '../types/analysis.types';
import { EMOJI_CONFIG } from '../config/emoji.config';
import { computeDiminishingReturns } from '../utils/diminishingReturns.util';

/**
 * Emoji EIV & Confidence Computation
 *
 * Responsibilities:
 * - Aggregate raw emoji counts
 * - Apply perceptual saturation
 * - Compute confidence independently
 *
 * Guarantees:
 * - Monotonic
 * - Bounded
 * - Config-driven
 * - Research-aligned
 */
export function computeEmojiEIV(
  signals: AnalyzerSignal[]
): { intensity: number; confidence: number } {
  if (!signals || signals.length === 0) {
    return { intensity: 0, confidence: 1 };
  }

  /**
   * Total emoji count across types
   *
   * Important:
   * - Identical emoji repetition does NOT amplify linearly
   * - We intentionally collapse to total count here
   * - DiminishingReturns handles perceptual attenuation
   */
  const totalCount = signals.reduce(
    (sum, s) => sum + s.value,
    0
  );

  /**
   * Intensity computation
   *
   * Uses shared diminishing returns utility
   * Configured via emoji policy only
   */
  const intensity = computeDiminishingReturns(totalCount, {
    baseIncrement: EMOJI_CONFIG.BASE_INCREMENT,
    maxContribution: EMOJI_CONFIG.MAX_CONTRIBUTION,
    ...EMOJI_CONFIG.DIMINISHING,
  });

  /**
   * Confidence computation
   *
   * Research-backed rule:
   * - Normal use → stable confidence
   * - Overuse (7+) → sincerity collapse
   */
  const confidence =
    totalCount > EMOJI_CONFIG.DIMINISHING.maxEffectiveCount
      ? EMOJI_CONFIG.CONFIDENCE.OVERUSE_PENALTY
      : EMOJI_CONFIG.CONFIDENCE.BASE;

  return { intensity, confidence };
}
