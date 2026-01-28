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
    let negatedPositiveWeight = VALENCE_CONSTANTS.bounds.zero;
    let negatedNegativeWeight = VALENCE_CONSTANTS.bounds.zero;
    let hasNegatedPositive = false;
    let hasNegatedNegative = false;
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
        const contribution = positive * attenuation;
        positiveWeight += contribution;
        if (attenuation !== VALENCE_CONSTANTS.bounds.one) {
          negatedPositiveWeight += contribution;
          hasNegatedPositive = true;
        }
      }

      if (negative > VALENCE_CONSTANTS.bounds.zero) {
        const contribution = negative * attenuation;
        negativeWeight += contribution;
        if (attenuation !== VALENCE_CONSTANTS.bounds.one) {
          negatedNegativeWeight += contribution;
          hasNegatedNegative = true;
        }
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

    const unnegatedPositiveWeight = positiveWeight - negatedPositiveWeight;
    const unnegatedNegativeWeight = negativeWeight - negatedNegativeWeight;
    const dominanceDelta = Math.abs(positiveWeight - negativeWeight);
    const isBalanced =
      dominanceDelta < VALENCE_CONSTANTS.thresholds.dominanceEpsilon &&
      magnitude < VALENCE_CONSTANTS.thresholds.minMagnitude;

    // STEP 1 — Balanced Mixed Affect (NO negation)
    const hasAnyNegation = hasNegatedPositive || hasNegatedNegative;
    const isPureMixedAffect =
      positiveWeight > VALENCE_CONSTANTS.bounds.zero &&
      negativeWeight > VALENCE_CONSTANTS.bounds.zero &&
      !hasAnyNegation &&
      negatedPositiveWeight === VALENCE_CONSTANTS.bounds.zero &&
      negatedNegativeWeight === VALENCE_CONSTANTS.bounds.zero;

    let valence: Valence = "NEUTRAL";

    if (isPureMixedAffect && isBalanced) {
      neutralTriggers.push("balanced_signal");
    } else {
      // Initial polarity from score
      if (score > VALENCE_CONSTANTS.bounds.zero) {
        valence = "POSITIVE";
      } else if (score < VALENCE_CONSTANTS.bounds.zero) {
        valence = "NEGATIVE";
      }

      // STEP 2 — Negation Asymmetry Dominance
      const hasNegatedContribution =
        negatedPositiveWeight > VALENCE_CONSTANTS.bounds.zero ||
        negatedNegativeWeight > VALENCE_CONSTANTS.bounds.zero;

      if (hasNegatedContribution) {
        if (unnegatedNegativeWeight > negatedPositiveWeight) {
          valence = "NEGATIVE";
        } else if (unnegatedPositiveWeight > negatedNegativeWeight) {
          valence = "POSITIVE";
        }
      }

      if (isBalanced) {
        neutralTriggers.push("balanced_signal");
      }

      // STEP 3 — Neutral Collapse (fallback)
      if (
        isBalanced &&
        affectiveTokenCount <
          VALENCE_CONSTANTS.confidence.minAffectiveTokens
      ) {
        valence = "NEUTRAL";
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
