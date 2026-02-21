import { ExpressionStrengthScorer } from "../scorers/ExpressionStrengthScorer";
import { ValenceAnalyzer } from "../analyzers/content/ValenceAnalyzer";
import { ArousalAnalyzer } from "../analyzers/content/ArousalAnalyzer";
import { composeEIV } from "../scorers/EIVComposer";
import { MASTER_CONSTANTS } from "../config/master.constants";
import type { ExpressionStrengthFeatures } from "../types/ExpressionStrength";

const sessionInputs = [
  "hey",
  "what?",
  "WHAT?",
  "WHAT???",
  "this is ridiculous",
  "THIS IS RIDICULOUS!!!",
  "...",
  "fine.",
  "whatever",
  "ok.",
];

const ES_CONFIDENCE = MASTER_CONSTANTS.eivCompositionConstants.CONF.MAX;

const INTENSIFIERS = new Set([
  "very",
  "really",
  "so",
  "too",
  "extremely",
  "absolutely",
  "totally",
  "completely",
  "utterly",
  "super",
  "quite",
  "seriously",
]);

const INTERJECTIONS = new Set([
  "hey",
  "what",
  "ok",
  "okay",
  "ugh",
  "wow",
  "huh",
  "oh",
  "no",
]);

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

const countMatches = (text: string, regex: RegExp): number =>
  (text.match(regex) ?? []).length;

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const countCapsRatio = (text: string): number => {
  const letters = text.match(/[A-Za-z]/g) ?? [];
  if (letters.length === 0) {
    return 0;
  }
  const upper = letters.filter((char) => char === char.toUpperCase()).length;
  return upper / letters.length;
};

const countExpressiveLengthening = (tokens: string[]): number => {
  const pattern = /(.)\1{2,}/i;
  return tokens.reduce(
    (count, token) => (pattern.test(token) ? count + 1 : count),
    0
  );
};

const buildESFeatures = (text: string): ExpressionStrengthFeatures => {
  const tokens = tokenize(text);
  return {
    capsRatio: countCapsRatio(text),
    exclamationCount: countMatches(text, /!/g),
    questionCount: countMatches(text, /\?/g),
    hasMixedPunctuation: /(\?!|!\?)/.test(text),
    emojiCount: countMatches(text, EMOJI_REGEX),
    expressiveLengtheningCount: countExpressiveLengthening(tokens),
    intensifierCount: tokens.filter((token) => INTENSIFIERS.has(token)).length,
    interjectionCount: tokens.filter((token) => INTERJECTIONS.has(token)).length,
    messageCharLength: text.length,
    hasText: text.trim().length > 0,
  };
};

const valenceAnalyzer = new ValenceAnalyzer();
const arousalAnalyzer = new ArousalAnalyzer();

sessionInputs.forEach((text, index) => {
  const features = buildESFeatures(text);
  const esResult = ExpressionStrengthScorer.compute(features);
  const valenceResult = valenceAnalyzer.analyze(text);
  const arousalResult = arousalAnalyzer.analyze(text);

  const composition = composeEIV({
    es: { score: esResult.es, confidence: ES_CONFIDENCE },
    valence: {
      score: valenceResult.score,
      confidence: valenceResult.confidence,
    },
    arousal: {
      score: arousalResult.arousal,
      confidence: arousalResult.confidence,
    },
  });

  const trace = {
    turn: index + 1,
    text,
    ES: {
      score: esResult.es,
      confidence: ES_CONFIDENCE,
    },
    valence: {
      score: valenceResult.score,
      confidence: valenceResult.confidence,
    },
    arousal: {
      score: arousalResult.arousal,
      confidence: arousalResult.confidence,
    },
    EIV: {
      value: composition.value,
      baseIntensity: composition.base,
      gain: composition.gain,
      confidence: composition.baseConfidence,
    },
  };

  console.group(`turn-${index + 1}`);
  console.debug(trace);
  console.groupEnd();
});
