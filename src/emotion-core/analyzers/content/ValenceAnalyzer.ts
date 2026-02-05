import { MASTER_CONSTANTS } from "../../config/master.constants";

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

const VALENCE_CONSTANTS = MASTER_CONSTANTS.valenceAnalyzer;
const NEGATION_TOKENS: ReadonlySet<string> = new Set(
  VALENCE_CONSTANTS.negation.tokens as readonly string[]
);
const CONTRAST_MARKERS: ReadonlySet<string> = new Set(
  VALENCE_CONSTANTS.contrast.markers as readonly string[]
);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/*
CONSTRAINT:
ValenceAnalyzer MUST NOT use emotion-labeled lexicons
(e.g., anger, sadness, fear words).
*/
// Valence ignores expressivity by design.
// Surface signals are handled by ES.
const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const normalizeForPhrase = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeToken = (token: string): string => token.replace(/[^a-z]/g, "");

type Span = { start: number; end: number };

type PolarityMap = Record<string, number>;

const FORBIDDEN_EMOTION_TOKENS = new Set([
  "anger",
  "sadness",
  "fear",
  "joy",
  "disgust",
  "surprise",
  "trust",
  "anticipation",
]);

const validatePolarityLexicon = (
  lexicon: PolarityMap,
  environment: string | undefined
) => {
  if (environment === "production") return;
  Object.keys(lexicon).forEach((token) => {
    if (FORBIDDEN_EMOTION_TOKENS.has(token)) {
      throw new Error(
        `Emotion-labeled token detected in polarity lexicon: ${token}`
      );
    }
  });
};

const buildPolarityLexicon = (): PolarityMap => {
  const lexicon: PolarityMap = {};
  VALENCE_CONSTANTS.lexicon.polarity.positive.forEach((token) => {
    lexicon[token] = VALENCE_CONSTANTS.bounds.one;
  });
  VALENCE_CONSTANTS.lexicon.polarity.negative.forEach((token) => {
    lexicon[token] = VALENCE_CONSTANTS.bounds.negOne;
  });
  validatePolarityLexicon(lexicon, process.env.NODE_ENV);
  return lexicon;
};

const buildNegationSpans = (tokens: string[]): Span[] => {
  const spans: Span[] = [];
  tokens.forEach((token, index) => {
    if (!NEGATION_TOKENS.has(token)) {
      return;
    }
    const scopeEnd = Math.min(
      index + VALENCE_CONSTANTS.negation.scope,
      tokens.length - VALENCE_CONSTANTS.iteration.indexStep
    );
    if (scopeEnd > index) {
      spans.push({ start: index + VALENCE_CONSTANTS.iteration.indexStep, end: scopeEnd });
    }
  });
  return spans;
};

const isNegatedIndex = (index: number, spans: Span[]): boolean =>
  spans.some((span) => index >= span.start && index <= span.end);


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
    const normalizedText = normalizeForPhrase(trimmed);
    const lexicon = buildPolarityLexicon();
    const negationSpans = buildNegationSpans(tokens);
    const contrastiveMarkers: string[] = [];
    let lastContrastIndex: number | undefined;
    const tokenSet = new Set(tokens.map((token) => normalizeToken(token)));

    tokens.forEach((token, index) => {
      const normalized = normalizeToken(token);
      if (!normalized) return;
      if (CONTRAST_MARKERS.has(normalized)) {
        contrastiveMarkers.push(normalized);
        lastContrastIndex = index;
      }
    });

    const polarityHits = {
      positive: VALENCE_CONSTANTS.bounds.zero,
      negative: VALENCE_CONSTANTS.bounds.zero,
    };

    let positiveWeight = VALENCE_CONSTANTS.bounds.zero;
    let negativeWeight = VALENCE_CONSTANTS.bounds.zero;
    tokens.forEach((token, index) => {
      const normalized = normalizeToken(token);
      if (!normalized) return;

      const polarity = lexicon[normalized];
      if (!polarity) return;

      if (polarity === VALENCE_CONSTANTS.bounds.one) {
        polarityHits.positive += VALENCE_CONSTANTS.bounds.one;
      } else if (polarity === VALENCE_CONSTANTS.bounds.negOne) {
        polarityHits.negative += VALENCE_CONSTANTS.bounds.one;
      }

      const isNegated = isNegatedIndex(index, negationSpans);
      const effectivePolarity = isNegated
        ? polarity * VALENCE_CONSTANTS.bounds.negOne
        : polarity;

      const contrastWeight =
        lastContrastIndex !== undefined && index < lastContrastIndex
          ? VALENCE_CONSTANTS.contrast.preWeight
          : VALENCE_CONSTANTS.contrast.postWeight;

      const contribution = effectivePolarity * contrastWeight;
      if (contribution > VALENCE_CONSTANTS.bounds.zero) {
        positiveWeight += contribution;
      } else if (contribution < VALENCE_CONSTANTS.bounds.zero) {
        negativeWeight += Math.abs(contribution);
      }
    });

    const markers = VALENCE_CONSTANTS.lexicon.markers;
    const matchedMarkers = {
      selfConsciousnessNegative: markers.selfConsciousnessNegative.filter(
        (token) => tokenSet.has(token)
      ),
      playfulHedgingPositive: markers.playfulHedgingPositive.filter((token) =>
        tokenSet.has(token)
      ),
      phrasesPositive: markers.phrasesPositive.filter((phrase) =>
        normalizedText.includes(phrase)
      ),
      phrasesNegative: markers.phrasesNegative.filter((phrase) =>
        normalizedText.includes(phrase)
      ),
      emotiveEmojiPositive: markers.emotiveEmojiPositive.filter((emoji) =>
        trimmed.includes(emoji)
      ),
      emotiveEmojiNegative: markers.emotiveEmojiNegative.filter((emoji) =>
        trimmed.includes(emoji)
      ),
    };

    const markerHits = {
      selfConsciousnessNegative:
        matchedMarkers.selfConsciousnessNegative.length,
      playfulHedgingPositive: matchedMarkers.playfulHedgingPositive.length,
      phrasesPositive: matchedMarkers.phrasesPositive.length,
      phrasesNegative: matchedMarkers.phrasesNegative.length,
      emotiveEmojiPositive: matchedMarkers.emotiveEmojiPositive.length,
      emotiveEmojiNegative: matchedMarkers.emotiveEmojiNegative.length,
    };

    positiveWeight +=
      markerHits.playfulHedgingPositive *
        VALENCE_CONSTANTS.markerWeights.playfulHedgingPositive +
      markerHits.phrasesPositive * VALENCE_CONSTANTS.markerWeights.phrasesPositive +
      markerHits.emotiveEmojiPositive *
        VALENCE_CONSTANTS.markerWeights.emotiveEmojiPositive;

    negativeWeight +=
      markerHits.selfConsciousnessNegative *
        VALENCE_CONSTANTS.markerWeights.selfConsciousnessNegative +
      markerHits.phrasesNegative * VALENCE_CONSTANTS.markerWeights.phrasesNegative +
      markerHits.emotiveEmojiNegative *
        VALENCE_CONSTANTS.markerWeights.emotiveEmojiNegative;

    const markerEvidenceCount =
      markerHits.selfConsciousnessNegative +
      markerHits.playfulHedgingPositive +
      markerHits.phrasesPositive +
      markerHits.phrasesNegative +
      markerHits.emotiveEmojiPositive +
      markerHits.emotiveEmojiNegative;

    const polarityTokenCount =
      polarityHits.positive + polarityHits.negative;
    const effectiveEvidenceCount = polarityTokenCount + markerEvidenceCount;

    if (
      effectiveEvidenceCount <
      VALENCE_CONSTANTS.confidence.minAffectiveTokens
    ) {
      neutralTriggers.push("low_evidence");
    }

    if (
      positiveWeight === VALENCE_CONSTANTS.bounds.zero &&
      negativeWeight === VALENCE_CONSTANTS.bounds.zero
    ) {
      neutralTriggers.push("no_polarity_tokens");
    }
    void contrastiveMarkers;

    let score: number = VALENCE_CONSTANTS.bounds.zero;
    if (polarityTokenCount === VALENCE_CONSTANTS.bounds.zero) {
      const denominator =
        positiveWeight +
        negativeWeight +
        VALENCE_CONSTANTS.normalization.markerBaseline;
      const raw = (positiveWeight - negativeWeight) / denominator;
      score = clamp(
        raw,
        VALENCE_CONSTANTS.normalization.minScore,
        VALENCE_CONSTANTS.normalization.maxScore
      );
    } else if (
      positiveWeight > VALENCE_CONSTANTS.bounds.zero &&
      negativeWeight === VALENCE_CONSTANTS.bounds.zero
    ) {
      score = VALENCE_CONSTANTS.bounds.one;
    } else if (
      negativeWeight > VALENCE_CONSTANTS.bounds.zero &&
      positiveWeight === VALENCE_CONSTANTS.bounds.zero
    ) {
      score = VALENCE_CONSTANTS.bounds.negOne;
    } else {
      const denominator =
        positiveWeight +
        negativeWeight +
        VALENCE_CONSTANTS.normalization.epsilon;
      const raw = (positiveWeight - negativeWeight) / denominator;
      score = clamp(
        raw,
        VALENCE_CONSTANTS.normalization.minScore,
        VALENCE_CONSTANTS.normalization.maxScore
      );
    }
    const magnitude = Math.abs(score);

    let valence: Valence = "NEUTRAL";
    if (magnitude >= VALENCE_CONSTANTS.thresholds.minMagnitude) {
      if (score > VALENCE_CONSTANTS.bounds.zero) {
        valence = "POSITIVE";
      } else if (score < VALENCE_CONSTANTS.bounds.zero) {
        valence = "NEGATIVE";
      }
    } else {
      neutralTriggers.push("balanced_signal");
    }

    let confidence = Math.min(VALENCE_CONSTANTS.bounds.one, magnitude);
    if (
      effectiveEvidenceCount <
      VALENCE_CONSTANTS.confidence.minAffectiveTokens
    ) {
      confidence *= VALENCE_CONSTANTS.confidence.lowEvidenceMultiplier;
    }

    const markerConfidence =
      markerHits.selfConsciousnessNegative *
        VALENCE_CONSTANTS.markerConfidence.selfConsciousnessNegative +
      markerHits.playfulHedgingPositive *
        VALENCE_CONSTANTS.markerConfidence.playfulHedgingPositive +
      markerHits.phrasesPositive *
        VALENCE_CONSTANTS.markerConfidence.phrasesPositive +
      markerHits.phrasesNegative *
        VALENCE_CONSTANTS.markerConfidence.phrasesNegative +
      markerHits.emotiveEmojiPositive *
        VALENCE_CONSTANTS.markerConfidence.emotiveEmojiPositive +
      markerHits.emotiveEmojiNegative *
        VALENCE_CONSTANTS.markerConfidence.emotiveEmojiNegative;

    confidence = clamp(
      Math.max(confidence, markerConfidence),
      VALENCE_CONSTANTS.bounds.zero,
      VALENCE_CONSTANTS.bounds.one
    );

    if (process.env.LORA_DEBUG) {
      console.log("[LoRa::ValenceDebug]", {
        markers: matchedMarkers,
        polarityHits,
        positiveWeight,
        negativeWeight,
        neutralTriggers,
      });
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
