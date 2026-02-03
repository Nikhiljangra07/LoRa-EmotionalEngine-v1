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
    emojiCount,
    expressiveLengtheningCount,
    messageCharLength,
  } = features;

  const sat = config.saturation;
  const w = config.weights;
  const clipMax = config.clipMax;
  const scoring = config.scoring;
  const { zero: ZERO, one: ONE } = config.numbers;

  const totalChars = Math.max(messageCharLength, config.density.minTotalChars);
  const exclamationDensity = exclamationCount / totalChars;
  const questionDensity = questionCount / totalChars;
  const emojiDensity = emojiCount / totalChars;
  const elongationDensity = expressiveLengtheningCount / totalChars;

  const capsScore = Math.min(clipMax, scoring.capsRatioMultiplier * capsRatio);
  const exclScore = Math.min(clipMax, exclamationDensity * sat.exclamation);
  const questScore = Math.min(clipMax, questionDensity * sat.question);
  const emojiScore = Math.min(clipMax, emojiDensity * sat.emoji);
  const lengthScore = Math.min(clipMax, elongationDensity * sat.lengthening);
  const intensScore = ZERO;
  const interjScore = ZERO;

  let esRaw =
    w.caps * capsScore +
    w.exclamation * exclScore +
    w.question * questScore +
    w.emoji * emojiScore +
    w.lengthening * lengthScore +
    w.intensifier * intensScore +
    w.interjection * interjScore;

  const shortBoost = ZERO;

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