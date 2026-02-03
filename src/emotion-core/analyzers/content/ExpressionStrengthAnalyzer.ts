import { ES_CONFIG } from "../../config/es.config";
import { MASTER_CONSTANTS } from "../../config/master.constants";
import { computeES, type ESConfig } from "../../scorers/computeES";
import type { ExpressionStrengthFeatures } from "../../types/ExpressionStrength";

const ES_CONSTANTS = MASTER_CONSTANTS.expressionStrength;
const { zero: ZERO, one: ONE } = ES_CONSTANTS.numbers;
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const WORD_REGEX = /[A-Za-z]+/g;
const UPPER_REGEX = /[A-Z]/g;

export interface ExpressionStrengthMetadata {
  breakdown: {
    capitalization: number;
    exclamations: number;
    questions: number;
    emojis: number;
    elongation: number;
    intensifiers: number;
    interjections: number;
    shortBoost: number;
  };
  config: {
    weights: Record<string, number>;
    saturationLimits: Record<string, number>;
  };
}

export type AnalyzerOutput<TMeta = unknown> = {
  score: number;
  dimension: "expression_strength";
  metadata: TMeta;
};

export class ExpressionStrengthAnalyzer {
  public readonly name = "ExpressionStrengthAnalyzer";
  public readonly version = "1.0.0";

  private cfg: ESConfig;

  constructor(cfg: Partial<ESConfig> = {}) {
    this.cfg = {
      ...ES_CONFIG,
      ...cfg,
      weights: { ...ES_CONFIG.weights, ...(cfg as ESConfig).weights },
      saturation: { ...ES_CONFIG.saturation, ...(cfg as ESConfig).saturation },
      shortMessage: { ...ES_CONFIG.shortMessage, ...(cfg as ESConfig).shortMessage },
    };
  }

  /**
   * Visual-expressive only: punctuation, caps, emoji, elongation.
   * This analyzer does NOT measure meaning, intent, or arousal.
   */
  analyze(
    features: ExpressionStrengthFeatures
  ): AnalyzerOutput<ExpressionStrengthMetadata> {
    const { es, breakdown } = computeES(features, this.cfg);

    return {
      score: es,
      dimension: "expression_strength",
      metadata: {
        breakdown: {
          capitalization: breakdown.capsScore,
          exclamations: breakdown.exclScore,
          questions: breakdown.questScore,
          emojis: breakdown.emojiScore,
          elongation: breakdown.lengthScore,
          intensifiers: breakdown.intensScore,
          interjections: breakdown.interjScore,
          shortBoost: breakdown.shortBoost,
        },
        config: {
          weights: this.cfg.weights,
          saturationLimits: this.cfg.saturation,
        },
      },
    };
  }
}

const countConsecutiveRepeats = (word: string): number => {
  const minRepeat = ES_CONSTANTS.elongation.minRepeat;
  let total = ZERO;
  let current = ONE;

  for (let i = ONE; i < word.length; i += ONE) {
    const prev = word[i - ONE];
    const curr = word[i];
    if (prev.toLowerCase() === curr.toLowerCase()) {
      current += ONE;
    } else {
      if (current >= minRepeat) {
        total += current - ONE;
      }
      current = ONE;
    }
  }

  if (current >= minRepeat) {
    total += current - ONE;
  }

  return total;
};

const countElongation = (text: string): number => {
  const words = text.match(WORD_REGEX) ?? [];
  return words.reduce<number>(
    (sum, word) => sum + countConsecutiveRepeats(word),
    Number(ZERO)
  );
};

const countPunctuationRepetition = (text: string, symbol: string): number => {
  const pattern = new RegExp(`\\${symbol}+`, "g");
  const matches = text.match(pattern) ?? [];
  return matches.reduce<number>(
    (sum, match) => sum + Math.max(match.length - ONE, ZERO),
    Number(ZERO)
  );
};

export const buildExpressionStrengthFeatures = (
  text: string
): ExpressionStrengthFeatures => {
  const trimmed = text.trim();
  const totalChars = Math.max(text.length, ES_CONSTANTS.density.minTotalChars);
  const uppercaseCount = (text.match(UPPER_REGEX) ?? []).length;
  const emojiCount = (text.match(EMOJI_REGEX) ?? []).length;

  return {
    capsRatio: uppercaseCount / totalChars,
    exclamationCount: countPunctuationRepetition(text, "!"),
    questionCount: countPunctuationRepetition(text, "?"),
    hasMixedPunctuation: false,
    emojiCount,
    expressiveLengtheningCount: countElongation(text),
    intensifierCount: ZERO,
    interjectionCount: ZERO,
    messageCharLength: text.length,
    hasText: trimmed.length > ZERO,
  };
};