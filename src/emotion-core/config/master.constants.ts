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
} as const;
