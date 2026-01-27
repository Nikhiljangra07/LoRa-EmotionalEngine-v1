/**
 * Layer 0: MASTER CONSTANTS
 *
 * Centralized numeric constants intended for reuse across analyzers and scorers.
 * Declarative only — no functions, no calculations.
 */

export const MASTER_CONSTANTS = {
  bounds: {},
  thresholds: {},
  weights: {},
  limits: {},
  es: {
    weights: {
      caps: 0.25,
      exclamation: 0.22,
      question: 0.12,
      emoji: 0.22,
      lengthening: 0.17,
      intensifier: 0.12,
      interjection: 0.10,
    },
    saturation: {
      exclamation: 3,
      question: 3,
      emoji: 3,
      lengthening: 2,
      intensifier: 2,
      interjection: 3,
    },
    shortMessage: {
      maxLength: 20,
      boost: 0.07,
      scoreThreshold: 0.5,
    },
    scoring: {
      capsRatioMultiplier: 3,
      mixedPunctuationBoost: 0.2,
    },
    clip: {
      min: 0,
      max: 1,
    },
  },
  capitalization: {
    weights: {
      capsBase: 0.18,
      repeatBase: 0.13,
    },
    thresholds: {
      minTokenLength: 2,
      emotionalTokenLengthMinExclusive: 2,
      capsBoostCountThreshold: 1,
      repeatedLetterMinCount: 2,
    },
    confidence: {
      allCaps: 0.55,
      repeatedLetters: 0.75,
      allCapsBoosted: 0.8,
    },
  },
  punctuationAnalyzer: {
    thresholds: {
      positionStartRatio: 0.25,
      positionEndRatio: 0.75,
      ellipsisMinDots: 3,
    },
    scoring: {
      mixedPairDivisor: 2,
      periodCount: 1,
    },
  },
  emojiAnalyzer: {
    thresholds: {
      emptyTextLength: 0,
      emptyEmojiCount: 0,
    },
    defaults: {
      confidence: 0,
      countSeed: 0,
      indexStart: 0,
    },
  },
  repetitionAnalyzer: {
    thresholds: {
      minRepeatCount: 2,
    },
  },
} as const;
