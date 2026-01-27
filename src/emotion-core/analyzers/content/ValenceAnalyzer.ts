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

const ZERO = VALENCE_CONSTANTS.bounds.zero;
const ONE = VALENCE_CONSTANTS.bounds.one;
const NEG_ONE = VALENCE_CONSTANTS.bounds.negOne;

const INDEX_STEP = VALENCE_CONSTANTS.iteration.indexStep;

const EPSILON = VALENCE_CONSTANTS.normalization.epsilon;
const MIN_SCORE = VALENCE_CONSTANTS.normalization.minScore;
const MAX_SCORE = VALENCE_CONSTANTS.normalization.maxScore;

const MIN_MAGNITUDE = VALENCE_CONSTANTS.thresholds.minMagnitude;
const MIN_AFFECTIVE_TOKENS = VALENCE_CONSTANTS.confidence.minAffectiveTokens;
const LOW_EVIDENCE_MULTIPLIER = VALENCE_CONSTANTS.confidence.lowEvidenceMultiplier;
const NEGATION_ATTENUATION = VALENCE_CONSTANTS.negation.attenuation;

const ZERO = 0;
const ONE = 1;
const NEG_ONE = -1;

const INDEX_STEP = 1;

const EPSILON = VALENCE_CONFIG.normalization.epsilon;
const MIN_SCORE = VALENCE_CONFIG.normalization.minScore;
const MAX_SCORE = VALENCE_CONFIG.normalization.maxScore;

const MIN_MAGNITUDE = VALENCE_CONFIG.thresholds.minMagnitude;
const MIN_AFFECTIVE_TOKENS = VALENCE_CONFIG.confidence.minAffectiveTokens;
const LOW_EVIDENCE_MULTIPLIER = VALENCE_CONFIG.confidence.lowEvidenceMultiplier;
const NEGATION_ATTENUATION = VALENCE_CONFIG.negation.attenuation;

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

    if (trimmed.length === ZERO) {
      neutralTriggers.push("empty_input");
      return {
        valence: "NEUTRAL",
        score: ZERO,
        confidence: ZERO,
        evidence: {
          positiveWeight: ZERO,
          negativeWeight: ZERO,
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
        i += INDEX_STEP
      ) {
        negatedIndexes.add(i);
      }
    }

    let positiveWeight = ZERO;
    let negativeWeight = ZERO;
    let affectiveTokenCount = ZERO;

    tokens.forEach((token, index) => {
      const normalized = normalizeToken(token);
      if (!normalized) return;

      const entry = NRC_LEXICON[normalized];
      if (!entry) return;

      const positive = entry.positive ?? ZERO;
      const negative = entry.negative ?? ZERO;
      const hasAffect = positive > ZERO || negative > ZERO;

      if (!hasAffect) return;

      affectiveTokenCount += ONE;

      const attenuation = negatedIndexes.has(index)
        ? NEGATION_ATTENUATION
        : ONE;

      if (positive > ZERO) {
        positiveWeight += positive * attenuation;
      }

      if (negative > ZERO) {
        negativeWeight += negative * attenuation;
      }
    });

    if (affectiveTokenCount < MIN_AFFECTIVE_TOKENS) {
      neutralTriggers.push("low_evidence");
    }

    if (positiveWeight === ZERO && negativeWeight === ZERO) {
      neutralTriggers.push("no_affective_tokens");
    }

    const denominator = positiveWeight + negativeWeight + EPSILON;
    const raw = (positiveWeight - negativeWeight) / denominator;
    const score = clamp(raw, MIN_SCORE, MAX_SCORE);
    const magnitude = Math.abs(score);

    const isBalanced = magnitude < MIN_MAGNITUDE;
    if (isBalanced) {
      neutralTriggers.push("balanced_signal");
    }

    let valence: Valence = "NEUTRAL";
    if (affectiveTokenCount >= MIN_AFFECTIVE_TOKENS && !isBalanced) {
      if (score >= MIN_MAGNITUDE) {
        valence = "POSITIVE";
      } else if (score <= NEG_ONE * MIN_MAGNITUDE) {
        valence = "NEGATIVE";
      }
    }

    let confidence = Math.min(ONE, magnitude);
    if (affectiveTokenCount < MIN_AFFECTIVE_TOKENS) {
      confidence *= LOW_EVIDENCE_MULTIPLIER;
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
