import { MASTER_CONSTANTS } from "../../config/master.constants";
import { NegationScopeAnalyzer } from "../semantic/NegationScopeAnalyzer";
import lexicon from "../../resources/nrc/processed/nrc_lexicon.json";

export type Valence = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export interface ValenceResult {
  valence: Valence;
  score: number;        // range [-1.0 … +1.0]
  confidence: number;   // range [0.0 … 1.0]
  evidence: {
    positiveWeight: number;
    negativeWeight: number;
    neutralTriggers: string[];
  };
}

type NrcLexiconEntry = {
  positive?: number;
  negative?: number;
  [key: string]: number | undefined;
};

type NrcLexicon = Record<string, NrcLexiconEntry>;

const NRC_LEXICON = lexicon as NrcLexicon;

const VALENCE_CONSTANTS = MASTER_CONSTANTS.valenceAnalyzer;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// Valence ignores expressivity by design.
// Surface signals are handled by ES.
const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const normalizeToken = (token: string): string => token.replace(/[^a-z]/g, "");

export class ValenceAnalyzer {
  readonly analyzerId = "valence";

  analyze(text: string): ValenceResult {
    const neutralTriggers: string[] = [];
    const trimmed = text.trim();

    if (trimmed.length === VALENCE_CONSTANTS.bounds.zero) {
      neutralTriggers.push("empty_input");
      return {
        valence: "NEUTRAL",
        score: VALENCE_CONSTANTS.bounds.zero,
        confidence: VALENCE_CONSTANTS.bounds.zero,
        evidence: {
          positiveWeight: VALENCE_CONSTANTS.bounds.zero,
          negativeWeight: VALENCE_CONSTANTS.bounds.zero,
          neutralTriggers,
        },
      };
    }

    const tokens = tokenize(trimmed);
    const negationScopes = NegationScopeAnalyzer.analyze(trimmed).scopes;
    const negatedIndexes = new Set<number>();

    for (const scope of negationScopes) {
      for (
        let i = scope.scopeStart;
        i <= scope.scopeEnd;
        i += VALENCE_CONSTANTS.iteration.indexStep
      ) {
        negatedIndexes.add(i);
      }
    }

    let positiveWeight = VALENCE_CONSTANTS.bounds.zero;
    let negativeWeight = VALENCE_CONSTANTS.bounds.zero;
    let affectiveTokenCount = VALENCE_CONSTANTS.bounds.zero;

    tokens.forEach((token, index) => {
      const normalized = normalizeToken(token);
      if (!normalized) return;

      const entry = NRC_LEXICON[normalized];
      if (!entry) return;

      const positive = entry.positive ?? VALENCE_CONSTANTS.bounds.zero;
      const negative = entry.negative ?? VALENCE_CONSTANTS.bounds.zero;
      const hasAffect =
        positive > VALENCE_CONSTANTS.bounds.zero ||
        negative > VALENCE_CONSTANTS.bounds.zero;

      if (!hasAffect) return;

      affectiveTokenCount += VALENCE_CONSTANTS.bounds.one;

      const attenuation = negatedIndexes.has(index)
        ? VALENCE_CONSTANTS.negation.attenuation
        : VALENCE_CONSTANTS.bounds.one;

      if (positive > VALENCE_CONSTANTS.bounds.zero) {
        positiveWeight += positive * attenuation;
      }

      if (negative > VALENCE_CONSTANTS.bounds.zero) {
        negativeWeight += negative * attenuation;
      }
    });

    if (
      affectiveTokenCount <
      VALENCE_CONSTANTS.confidence.minAffectiveTokens
    ) {
      neutralTriggers.push("low_evidence");
    }

    if (
      positiveWeight === VALENCE_CONSTANTS.bounds.zero &&
      negativeWeight === VALENCE_CONSTANTS.bounds.zero
    ) {
      neutralTriggers.push("no_affective_tokens");
    }

    const denominator =
      positiveWeight +
      negativeWeight +
      VALENCE_CONSTANTS.normalization.epsilon;
    const raw = (positiveWeight - negativeWeight) / denominator;
    const score = clamp(
      raw,
      VALENCE_CONSTANTS.normalization.minScore,
      VALENCE_CONSTANTS.normalization.maxScore
    );
    const magnitude = Math.abs(score);

    const isBalanced = magnitude < VALENCE_CONSTANTS.thresholds.minMagnitude;
    if (isBalanced) {
      neutralTriggers.push("balanced_signal");
    }

    let valence: Valence = "NEUTRAL";
    if (
      affectiveTokenCount >=
        VALENCE_CONSTANTS.confidence.minAffectiveTokens &&
      !isBalanced
    ) {
      if (score >= VALENCE_CONSTANTS.thresholds.minMagnitude) {
        valence = "POSITIVE";
      } else if (
        score <=
        VALENCE_CONSTANTS.bounds.negOne *
          VALENCE_CONSTANTS.thresholds.minMagnitude
      ) {
        valence = "NEGATIVE";
      }
    }

    let confidence = Math.min(VALENCE_CONSTANTS.bounds.one, magnitude);
    if (
      affectiveTokenCount <
      VALENCE_CONSTANTS.confidence.minAffectiveTokens
    ) {
      confidence *= VALENCE_CONSTANTS.confidence.lowEvidenceMultiplier;
    }

    return {
      valence,
      score,
      confidence,
      evidence: {
        positiveWeight,
        negativeWeight,
        neutralTriggers,
      },
    };
  }
}
