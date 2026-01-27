import { ES_CONFIG } from "../config/es.config";
import {
  ExpressionStrengthFeatures,
  ExpressionStrengthResult,
} from "../types/ExpressionStrength";

export type ESConfig = typeof ES_CONFIG;

export type ESBreakdown = {
  capsScore: number;
  exclScore: number;
  questScore: number;
  emojiScore: number;
  lengthScore: number;
  intensScore: number;
  interjScore: number;
  shortBoost: number;
  esRaw: number;
};

const clamp01 = (value: number, config: ESConfig): number =>
  Math.max(config.clipMin, Math.min(config.clipMax, value));

export function computeES(
  features: ExpressionStrengthFeatures,
  config: ESConfig = ES_CONFIG
): ExpressionStrengthResult & { breakdown: ESBreakdown } {
  const {
    capsRatio,
    exclamationCount,
    questionCount,
    hasMixedPunctuation,
    emojiCount,
    expressiveLengtheningCount,
    intensifierCount,
    interjectionCount,
    messageCharLength,
  } = features;

  const sat = config.saturation;
  const w = config.weights;
  const clipMax = config.clipMax;
  const scoring = config.scoring;

  const capsScore = Math.min(clipMax, scoring.capsRatioMultiplier * capsRatio);
  const exclScore = Math.min(clipMax, exclamationCount / sat.exclamation);
  const questScore = Math.min(
    clipMax,
    Math.min(clipMax, questionCount / sat.question) +
      (hasMixedPunctuation ? scoring.mixedPunctuationBoost : 0)
  );

  const emojiScore = Math.min(clipMax, emojiCount / sat.emoji);
  const lengthScore = Math.min(clipMax, expressiveLengtheningCount / sat.lengthening);
  const intensScore = Math.min(clipMax, intensifierCount / sat.intensifier);
  const interjScore = Math.min(clipMax, interjectionCount / sat.interjection);

  let esRaw =
    w.caps * capsScore +
    w.exclamation * exclScore +
    w.question * questScore +
    w.emoji * emojiScore +
    w.lengthening * lengthScore +
    w.intensifier * intensScore +
    w.interjection * interjScore;

  const shortBoost =
    messageCharLength < config.shortMessage.maxLength &&
    (capsScore > config.shortMessage.scoreThreshold ||
      exclScore > config.shortMessage.scoreThreshold ||
      emojiScore > config.shortMessage.scoreThreshold)
      ? config.shortMessage.boost
      : 0;

  esRaw += shortBoost;

  const es = clamp01(esRaw, config);

  return {
    es,
    breakdown: {
      capsScore,
      exclScore,
      questScore,
      emojiScore,
      lengthScore,
      intensScore,
      interjScore,
      shortBoost,
      esRaw,
    },
  };
}