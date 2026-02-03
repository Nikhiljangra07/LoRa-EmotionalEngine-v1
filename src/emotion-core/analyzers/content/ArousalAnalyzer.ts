import { MASTER_CONSTANTS } from "../../config/master.constants";
import { SentenceBoundaryAnalyzer } from "../SentenceBoundaryAnalyzer";

const AROUSAL_CONSTANTS = MASTER_CONSTANTS.arousalCalibrationConstants;
const { zero: ZERO, one: ONE } = AROUSAL_CONSTANTS.numbers;

/*
CONSTRAINT:
ArousalAnalyzer MUST NOT use:
- punctuation-based signals
- capitalization
- elongation
- emoji
- sentiment or emotion lexicons

Violation of this rule invalidates Layer-1 separation.
*/

const TOKEN_REGEX = new RegExp(AROUSAL_CONSTANTS.regex.token, "g");
const COMMON_TOKENS: ReadonlySet<string> = new Set(
  AROUSAL_CONSTANTS.rarity.commonTokens as readonly string[]
);
const QUESTION_STARTERS: ReadonlySet<string> = new Set(
  AROUSAL_CONSTANTS.question.starters as readonly string[]
);
const IMPERATIVE_VERBS: ReadonlySet<string> = new Set(
  AROUSAL_CONSTANTS.imperative.verbs as readonly string[]
);
const CLAUSE_CONJUNCTIONS: ReadonlySet<string> = new Set(
  AROUSAL_CONSTANTS.clause.conjunctions as readonly string[]
);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

type ArousalSources =
  | "sentence_length_variance"
  | "rare_word_usage"
  | "question_density"
  | "imperative_presence"
  | "clause_stacking";

export type ArousalAnalysis = {
  arousal: number;
  confidence: number;
  sources: ArousalSources[];
};

const tokenize = (text: string): string[] =>
  (text.match(TOKEN_REGEX) ?? []).map((token) => token.toLowerCase());

const countRareTokens = (tokens: string[]): number => {
  return tokens.reduce<number>((count, token) => {
    if (
      token.length < AROUSAL_CONSTANTS.thresholds.rareTokenMinLength ||
      COMMON_TOKENS.has(token)
    ) {
      return count;
    }
    return count + ONE;
  }, Number(ZERO));
};

const splitSentences = (text: string): string[] => {
  const analyzer = new SentenceBoundaryAnalyzer();
  const { boundaries, normalizedText } = analyzer.analyze(text);
  if (boundaries.length === 0) {
    return [normalizedText];
  }

  const sentences: string[] = [];
  let start: number = ZERO;
  boundaries.forEach((boundary) => {
    const end = boundary.boundaryIndex + ONE;
    sentences.push(normalizedText.slice(start, end));
    start = end;
  });
  if (start < normalizedText.length) {
    sentences.push(normalizedText.slice(start));
  }
  return sentences.filter((sentence) => sentence.trim().length > ZERO);
};

const sentenceLengthVariance = (counts: number[]): number => {
  if (counts.length <= ONE) {
    return ZERO;
  }
  const mean =
    counts.reduce<number>((sum, value) => sum + value, Number(ZERO)) /
    counts.length;
  const variance =
    counts.reduce<number>((sum, value) => {
      const diff = value - mean;
      return sum + diff * diff;
    }, Number(ZERO)) / counts.length;
  return variance;
};

const normalizedRatio = (numerator: number, denominator: number): number =>
  denominator > ZERO ? numerator / denominator : ZERO;

const isQuestionSentence = (tokens: string[]): boolean => {
  const first = tokens[ZERO];
  if (!first) return false;
  return QUESTION_STARTERS.has(first);
};

const isImperativeSentence = (tokens: string[]): boolean => {
  const first = tokens[ZERO];
  if (!first) return false;
  return IMPERATIVE_VERBS.has(first);
};

const countClauses = (tokens: string[]): number =>
  tokens.reduce<number>((count, token) => {
    if (CLAUSE_CONJUNCTIONS.has(token)) {
      return count + ONE;
    }
    return count;
  }, Number(ZERO));

const computeSignalScore = (
  value: number,
  saturation: number
): number => Math.min(value / saturation, AROUSAL_CONSTANTS.bounds.max);

export class ArousalAnalyzer {
  analyze(text: string): ArousalAnalysis {
    const sentences = splitSentences(text);
    const sentenceTokens = sentences.map((sentence) => tokenize(sentence));
    const sentenceLengths = sentenceTokens.map((tokens) => tokens.length);
    const totalTokens = sentenceLengths.reduce<number>(
      (sum, value) => sum + value,
      Number(ZERO)
    );

    const variance =
      totalTokens >= AROUSAL_CONSTANTS.thresholds.minTokensForVariance
        ? sentenceLengthVariance(sentenceLengths)
        : ZERO;
    const varianceScore = computeSignalScore(
      variance,
      AROUSAL_CONSTANTS.saturation.sentenceLengthVariance
    );

    const flattenedTokens = sentenceTokens.flat();
    const rareCount = countRareTokens(flattenedTokens);
    const rareRatio = normalizedRatio(rareCount, totalTokens);
    const rareScore = computeSignalScore(
      rareRatio,
      AROUSAL_CONSTANTS.saturation.rareWordRatio
    );

    const questionCount = sentenceTokens.reduce<number>((count, tokens) => {
      if (isQuestionSentence(tokens)) {
        return count + ONE;
      }
      return count;
    }, Number(ZERO));
    const questionDensity = normalizedRatio(questionCount, sentences.length);
    const questionScore = computeSignalScore(
      questionDensity,
      AROUSAL_CONSTANTS.saturation.questionDensity
    );

    const imperativeCount = sentenceTokens.reduce<number>((count, tokens) => {
      if (isImperativeSentence(tokens)) {
        return count + ONE;
      }
      return count;
    }, Number(ZERO));
    const imperativeDensity = normalizedRatio(imperativeCount, sentences.length);
    const imperativeScore = computeSignalScore(
      imperativeDensity,
      AROUSAL_CONSTANTS.saturation.imperativeDensity
    );

    const clauseCount = sentenceTokens.reduce<number>(
      (count, tokens) => count + countClauses(tokens),
      Number(ZERO)
    );
    const clauseRatio = normalizedRatio(clauseCount, totalTokens);
    const clauseScore = computeSignalScore(
      clauseRatio,
      AROUSAL_CONSTANTS.saturation.clauseStackingRatio
    );

    const sources: ArousalSources[] = [];
    if (varianceScore > ZERO) sources.push("sentence_length_variance");
    if (rareScore > ZERO) sources.push("rare_word_usage");
    if (questionScore > ZERO) sources.push("question_density");
    if (imperativeScore > ZERO) sources.push("imperative_presence");
    if (clauseScore > ZERO) sources.push("clause_stacking");

    const arousalRaw =
      AROUSAL_CONSTANTS.weights.sentenceLengthVariance * varianceScore +
      AROUSAL_CONSTANTS.weights.rareWordUsage * rareScore +
      AROUSAL_CONSTANTS.weights.questionDensity * questionScore +
      AROUSAL_CONSTANTS.weights.imperativePresence * imperativeScore +
      AROUSAL_CONSTANTS.weights.clauseStacking * clauseScore;

    const arousal = clamp(
      arousalRaw,
      AROUSAL_CONSTANTS.bounds.min,
      AROUSAL_CONSTANTS.bounds.max
    );

    let confidence = AROUSAL_CONSTANTS.confidence.base;
    if (sources.length < AROUSAL_CONSTANTS.thresholds.minSignalCount) {
      confidence -= AROUSAL_CONSTANTS.confidence.lowEvidencePenalty;
    }

    return {
      arousal,
      confidence: clamp(
        confidence,
        AROUSAL_CONSTANTS.confidence.min,
        AROUSAL_CONSTANTS.confidence.max
      ),
      sources,
    };
  }
}
