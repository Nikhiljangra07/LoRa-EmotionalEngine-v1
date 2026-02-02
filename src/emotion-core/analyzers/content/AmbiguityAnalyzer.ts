import { MASTER_CONSTANTS } from "../../config/master.constants";

export interface AmbiguitySignal {
  ambiguityScore: number;
  ambiguitySources: string[];
  contradictionDetected: boolean;
  sarcasmPossible: boolean;
  confidencePenaltyHint: number;
}

const HEDGING_TOKENS = new Set([
  "maybe",
  "perhaps",
  "guess",
  "kinda",
  "kind",
  "sort",
  "probably",
  "possibly",
  "roughly",
  "around",
]);

const HEDGING_PHRASES = [
  /\bkind\s+of\b/g,
  /\bsort\s+of\b/g,
  /\bi\s+guess\b/g,
  /\bi\s+think\b/g,
];

const MODAL_TOKENS = new Set(["might", "could", "may", "would", "should"]);

const CONTRAST_TOKENS = new Set([
  "but",
  "however",
  "though",
  "yet",
  "whereas",
  "nevertheless",
]);

const POSITIVE_TOKENS = new Set([
  "good",
  "great",
  "love",
  "like",
  "amazing",
  "happy",
  "excited",
  "nice",
  "wonderful",
  "awesome",
]);

const NEGATIVE_TOKENS = new Set([
  "bad",
  "hate",
  "awful",
  "terrible",
  "sad",
  "angry",
  "upset",
  "annoyed",
  "horrible",
  "worse",
  "worst",
]);

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
  /\b(am|is|are|was|were|be|been|being)\b\s+\b(\w+ed|\w+en|made|done|seen|known|given|taken|gone|left|set)\b/g;

const WORD_PATTERN = /[a-z']+/g;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const countMatches = (text: string, pattern: RegExp): number => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

export class AmbiguityAnalyzer {
  analyze(text: string): AmbiguitySignal {
    const constants = MASTER_CONSTANTS.ambiguityAnalyzer;
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

    for (const token of tokens) {
      if (HEDGING_TOKENS.has(token)) hedgingCount += 1;
      if (MODAL_TOKENS.has(token)) modalCount += 1;
      if (CONTRAST_TOKENS.has(token)) contrastCount += 1;
      if (POSITIVE_TOKENS.has(token)) positiveCount += 1;
      if (NEGATIVE_TOKENS.has(token)) negativeCount += 1;
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

    if (hedgingCount > 0) sourceSet.add("hedging");
    if (modalCount > 0) sourceSet.add("modal");
    if (contrastCount > 0) sourceSet.add("contrast");
    if (rhetoricalCount > 0) sourceSet.add("rhetorical");
    if (contradictionDetected) sourceSet.add("contradiction");
    if (passiveCount > 0) sourceSet.add("passive");

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
    score +=
      constants.weights.contradiction *
      (contradictionDetected ? constants.saturation.contradictionFlag : 0);

    score =
      constants.baseline.score +
      (score - constants.baseline.score) * constants.scoring.dampening;
    score = clamp(score, constants.bounds.min, constants.bounds.max);

    const rawHint = 1 - score * constants.penaltyHint.scale;
    const penaltyHint = clamp(
      rawHint,
      constants.penaltyHint.min,
      constants.penaltyHint.max
    );

    const confidencePenaltyHint = Math.max(
      penaltyHint,
      constants.penaltyHint.floor
    );

    const sarcasmPossible =
      rhetoricalCount > 0 && (contrastCount > 0 || contradictionDetected);

    return {
      ambiguityScore: score,
      ambiguitySources: Array.from(sourceSet),
      contradictionDetected,
      sarcasmPossible,
      confidencePenaltyHint,
    };
  }
}
