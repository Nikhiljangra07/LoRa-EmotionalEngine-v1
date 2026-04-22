/**
 * EIV (Emotional Intensity Value) surface scorer for the adaptive router.
 *
 * Deterministic 0-100 score computed from surface-level features of the
 * user's message. Orthogonal to the regex vocabulary patterns: EIV looks
 * at HOW the message is written (punctuation density, caps, elongation,
 * intensifier density, self-reference ratio, repetition) rather than WHAT
 * words are in it.
 *
 * NOTE: this is a router-local scorer. The production EIV in the main
 * pipeline (src/emotion-core/etv) is a richer, more elaborate score used
 * for containment / policy decisions. This one only needs to catch
 * high-surface-intensity messages that don't fire any vocabulary pattern
 * (e.g. "WHY DOES HE KEEP DOING THIS!!!") and promote them to substantive.
 *
 * Known limitations:
 *   1. Polarity not detected. Joyful "THIS IS AMAZING!!!" scores the same
 *      as distressed "WHY DOES THIS KEEP HAPPENING!!!". Overshoots on
 *      positive intensity are accepted per bias-deep (recoverable cost).
 *   2. Flat-prose distress ("i just cant do this anymore" said flatly)
 *      scores low. Those are caught by the regex life-stakes patterns.
 *   3. Short whole-message trivials ("YES!!!") are caught by the trivial
 *      gate BEFORE EIV is consulted.
 */

/** Threshold at which EIV is considered "high" for routing purposes. */
export const EIV_HIGH_THRESHOLD = 30;

export function computeEIV(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  const normalized = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return 0;

  let score = 0;

  // 1. Exclamation density — shouting, urgency
  const exclamations = (text.match(/!/g) || []).length;
  score += Math.min(30, exclamations * 10);

  // 2. Multiple question marks — frustration, rhetorical distress
  const questions = (text.match(/\?/g) || []).length;
  if (questions >= 2) score += Math.min(18, (questions - 1) * 8);

  // 3. ALL CAPS words (≥3 letters) — shouting
  const capsWords = (text.match(/\b[A-Z]{3,}\b/g) || []).length;
  score += Math.min(32, capsWords * 8);

  // 4. Intensifier density (English + Hinglish)
  const intensifiers = (
    normalized.match(
      /\b(very|so|really|totally|absolutely|completely|super|extremely|utterly|insanely|unbelievably|incredibly|deeply|genuinely|bahut|bohot|bilkul|itna|zyada)\b/g,
    ) || []
  ).length;
  score += Math.min(18, intensifiers * 6);

  // 5. Character elongation — "sooooo", "yesssss"
  const elongations = (normalized.match(/([a-z])\1{2,}/g) || []).length;
  score += Math.min(15, elongations * 8);

  // 6. Ellipses — trailing off, weariness
  const ellipses = (text.match(/\.{2,}/g) || []).length;
  score += Math.min(12, ellipses * 6);

  // 7. Negation density (English + Hinglish)
  const negations = (
    normalized.match(
      /\b(can'?t|cant|cannot|couldn'?t|couldnt|don'?t|dont|doesn'?t|doesnt|won'?t|wont|wouldn'?t|wouldnt|never|nothing|nobody|nowhere|nahi|nahin|nhi|kabhi\s+nah[iy]?n?|kuch\s+nah[iy]?n?)\b/g,
    ) || []
  ).length;
  if (wordCount >= 3) {
    const negRatio = negations / wordCount;
    if (negRatio > 0.1) score += Math.min(15, (negRatio - 0.1) * 75);
  }

  // 8. Self-reference density (English + Hinglish)
  const selfRefs = (
    normalized.match(/\b(i|i'?m|me|my|myself|main|mein|mujhe|mera|meri|mere)\b/g) || []
  ).length;
  if (wordCount > 0) {
    const ratio = selfRefs / wordCount;
    if (ratio > 0.15) score += Math.min(12, (ratio - 0.15) * 40);
  }

  // 9. Meta-emotional markers — explicit "I feel", "feel like"
  const metaEmotional = (
    normalized.match(/\b(i\s+feel|feel\s+like|i\s+felt|i'?m\s+feeling)\b/g) || []
  ).length;
  score += Math.min(15, metaEmotional * 10);

  // 10. Absolutes — "always", "never", "everything"
  const absolutes = (
    normalized.match(
      /\b(always|never|everything|nothing|everyone|all\s+the\s+time|constantly)\b/g,
    ) || []
  ).length;
  score += Math.min(12, absolutes * 6);

  // 11. Word repetition — "please please please"
  const wordCounts: Record<string, number> = {};
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[^a-z']/g, '');
    if (lw.length >= 3) {
      wordCounts[lw] = (wordCounts[lw] || 0) + 1;
    }
  }
  const repetitions = Object.values(wordCounts).filter((c) => c >= 3).length;
  if (repetitions > 0) score += Math.min(12, repetitions * 6);

  // 12. Short fragment with self-reference — "I can't", "I don't know"
  if (wordCount < 6 && selfRefs >= 1) {
    score += 10;
  }

  return Math.min(100, Math.round(score));
}
