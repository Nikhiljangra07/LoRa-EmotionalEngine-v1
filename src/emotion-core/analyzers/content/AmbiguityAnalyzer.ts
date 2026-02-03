import { MASTER_CONSTANTS } from "../../config/master.constants";

export interface AmbiguitySignal {
  ambiguityScore: number;
  ambiguitySources: string[];
  contradictionDetected: boolean;
  tonalInversionPatternDetected: boolean;
  confidencePenaltyHint: number;
}

const HEDGING_PHRASES = [
  /\bkind\s+of\b/g,
  /\bsort\s+of\b/g,
  /\bi\s+guess\b/g,
  /\bi\s+think\b/g,
];

const RHETORICAL_PATTERNS = [
  /\bwho\s+knows\b/g,
  /\bas\s+if\b/g,
  /\bwhy\s+would\b/g,
  /\bwhy\s+on\s+earth\b/g,
  /\byou\s+really\s+think\b/g,
  /\bwhat\s+even\b/g,
  /\bisn['"]t\s+it\b/g,
  /\bdon['"]t\s+you\b/g,
  /\bright\b/g,
  /\bseriously\b/g,
];

const PASSIVE_VOICE_PATTERN =
  /\b(am|is|are|was|were|be|been|being)\b(?:\s+\w+){0,3}\s+\b(\w+(?:ed|en)|made|done|seen|known|given|taken|gone|left|set|hurt)\b/g;

const WORD_PATTERN = /[a-z']+/g;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const countMatches = (text: string, pattern: RegExp): number => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

const hasNearbyPolarity = (
  positiveIndices: number[],
  negativeIndices: number[],
  window: number
): boolean => {
  for (const positiveIndex of positiveIndices) {
    for (const negativeIndex of negativeIndices) {
      if (Math.abs(positiveIndex - negativeIndex) <= window) {
        return true;
      }
    }
  }
  return false;
};

const hasContrastBetweenPolarity = (
  positiveIndices: number[],
  negativeIndices: number[],
  contrastIndices: number[]
): boolean => {
  for (const positiveIndex of positiveIndices) {
    for (const negativeIndex of negativeIndices) {
      const start = Math.min(positiveIndex, negativeIndex);
      const end = Math.max(positiveIndex, negativeIndex);
      for (const contrastIndex of contrastIndices) {
        if (contrastIndex > start && contrastIndex < end) {
          return true;
        }
      }
    }
  }
  return false;
};

export class AmbiguityAnalyzer {
  analyze(text: string): AmbiguitySignal {
    const constants = MASTER_CONSTANTS.ambiguityAnalyzer;
    const lexicon = constants.lexicon;
    const hedgingTokens: ReadonlySet<string> = new Set(
      lexicon.hedgingTokens as readonly string[]
    );
    const modalTokens: ReadonlySet<string> = new Set(
      lexicon.modalTokens as readonly string[]
    );
    const contrastTokens: ReadonlySet<string> = new Set(
      lexicon.contrastTokens as readonly string[]
    );
    const positiveTokens: ReadonlySet<string> = new Set(
      lexicon.polarity.positive as readonly string[]
    );
    const negativeTokens: ReadonlySet<string> = new Set(
      lexicon.polarity.negative as readonly string[]
    );
    const sourceSet = new Set<string>();
    const input = text ?? "";
    const normalized = input.toLowerCase();

    const rawTokens = normalized.match(WORD_PATTERN) ?? [];
    const tokens = rawTokens.filter(
      (token) => token.length >= constants.thresholds.minTokenLength
    );

    let hedgingCount = 0;
    let modalCount = 0;
    let contrastCount = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    const positiveIndices: number[] = [];
    const negativeIndices: number[] = [];
    const contrastIndices: number[] = [];

    for (const [index, token] of tokens.entries()) {
      if (hedgingTokens.has(token)) hedgingCount += 1;
      if (modalTokens.has(token)) modalCount += 1;
      if (contrastTokens.has(token)) {
        contrastCount += 1;
        contrastIndices.push(index);
      }
      if (positiveTokens.has(token)) {
        positiveCount += 1;
        positiveIndices.push(index);
      }
      if (negativeTokens.has(token)) {
        negativeCount += 1;
        negativeIndices.push(index);
      }
    }

    for (const phrase of HEDGING_PHRASES) {
      hedgingCount += countMatches(normalized, phrase);
    }

    const hasQuestionMark = normalized.includes("?");
    let rhetoricalCount = 0;
    if (hasQuestionMark) {
      for (const pattern of RHETORICAL_PATTERNS) {
        rhetoricalCount += countMatches(normalized, pattern);
      }
    }

    const passiveCount = countMatches(normalized, PASSIVE_VOICE_PATTERN);

    const contradictionDetected = positiveCount > 0 && negativeCount > 0;
    const polarityNearby = hasNearbyPolarity(
      positiveIndices,
      negativeIndices,
      constants.thresholds.contradictionTokenWindow
    );
    const contrastSeparated = hasContrastBetweenPolarity(
      positiveIndices,
      negativeIndices,
      contrastIndices
    );

    if (hedgingCount > 0 || modalCount > 0) sourceSet.add("semantic");
    if (rhetoricalCount > 0) sourceSet.add("pragmatic");
    if (contrastCount > 0 || contradictionDetected) sourceSet.add("structural");
    if (passiveCount > 0) sourceSet.add("narrative");

    const normalizeCount = (count: number, saturation: number): number =>
      Math.min(count / saturation, constants.bounds.max);

    let score = constants.baseline.score;
    score +=
      constants.weights.hedging *
      normalizeCount(hedgingCount, constants.saturation.hedgingCount);
    score +=
      constants.weights.modal *
      normalizeCount(modalCount, constants.saturation.modalCount);
    score +=
      constants.weights.contrast *
      normalizeCount(contrastCount, constants.saturation.contrastCount);
    score +=
      constants.weights.rhetorical *
      normalizeCount(rhetoricalCount, constants.saturation.rhetoricalCount);
    score +=
      constants.weights.passive *
      normalizeCount(passiveCount, constants.saturation.passiveCount);
    const contradictionMultiplier =
      contradictionDetected && !(polarityNearby || contrastSeparated)
        ? constants.thresholds.contradictionDistantMultiplier
        : 1;
    score +=
      constants.weights.contradiction *
      (contradictionDetected
        ? constants.saturation.contradictionFlag * contradictionMultiplier
        : 0);

    score =
      constants.baseline.score +
      (score - constants.baseline.score) * constants.scoring.dampening;
    if (sourceSet.size > 0 && score === constants.baseline.score) {
      // Ensure detectable signals stay above baseline after dampening.
      score =
        constants.baseline.score + constants.invariants.minExistenceDelta;
    }
    score = clamp(score, constants.bounds.min, constants.bounds.max);

    const rawHint = 1 - score * constants.penaltyHint.scale;
    const penaltyHint = clamp(
      rawHint,
      Number(constants.penaltyHint.min),
      Number(constants.penaltyHint.max)
    );

    // NOTE: This is a multiplicative confidence cap, not a meaning inference.
    // It can only reduce downstream confidence; it never increases it.
    const confidencePenaltyHint = Math.max(
      penaltyHint,
      constants.penaltyHint.floor
    );

    // Surface-level rhetorical + contrast marker pattern only.
    // This does NOT infer sarcasm, intent, or emotion.
    const tonalInversionPatternDetected =
      rhetoricalCount > 0 && (contrastCount > 0 || contradictionDetected);

    return {
      ambiguityScore: score,
      ambiguitySources: Array.from(sourceSet),
      contradictionDetected,
      tonalInversionPatternDetected,
      confidencePenaltyHint,
    };
  }
}
