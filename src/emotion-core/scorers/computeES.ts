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

  const capsScore = Math.min(1, 3 * capsRatio);
  const exclScore = Math.min(1, exclamationCount / sat.exclamation);
  const questScore = Math.min(
    1,
    Math.min(1, questionCount / sat.question) +
      (hasMixedPunctuation ? 0.2 : 0)
  );

  const emojiScore = Math.min(1, emojiCount / sat.emoji);
  const lengthScore = Math.min(1, expressiveLengtheningCount / sat.lengthening);
  const intensScore = Math.min(1, intensifierCount / sat.intensifier);
  const interjScore = Math.min(1, interjectionCount / sat.interjection);

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
    (capsScore > 0.5 || exclScore > 0.5 || emojiScore > 0.5)
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