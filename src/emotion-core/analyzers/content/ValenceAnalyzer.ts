import { MASTER_CONSTANTS } from "../../config/master.constants";
import { debugEnabled } from "../../utils/debugGate";

export type Valence = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export interface ValenceResult {
  valence: Valence;
  score: number;        // range [-1.0 … +1.0]
  confidence: number;   // range [0.0 … 1.0]
  semanticScore: number; // range [-1.0 … +1.0], lexicon-based
  evidence: {
    positiveWeight: number;
    negativeWeight: number;
    neutralTriggers: string[];
  };
}

const SEMANTIC_NEGATIVE_KEYWORDS: ReadonlySet<string> = new Set([
  // original
  "furious", "bullshit", "useless", "done", "angry",
  "hate", "overwhelmed", "worthless", "can't", "cant",
  // violent-intent / high-distress expansion
  "kill", "murder", "beat", "hit", "hurt", "die",
  "violence", "threat", "rage", "attack", "destroy", "revenge",
]);

const SEMANTIC_POSITIVE_KEYWORDS: ReadonlySet<string> = new Set([
  "confident", "excited", "ready", "strong", "grateful",
]);

function computeSemanticScore(tokens: string[]): number {
  let hits = 0;
  let total = 0;
  for (const token of tokens) {
    if (SEMANTIC_POSITIVE_KEYWORDS.has(token)) {
      hits += 1;
      total += 1;
    } else if (SEMANTIC_NEGATIVE_KEYWORDS.has(token)) {
      hits -= 1;
      total += 1;
    }
  }
  if (total === 0) return 0;
  return Math.max(-1, Math.min(1, hits / total));
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
        semanticScore: 0,
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
    const rawTokens = trimmed.split(/\s+/).filter(Boolean);

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
      positiveTokens: markers.positiveTokens.filter((token) =>
        tokenSet.has(token)
      ),
      negativeTokens: markers.negativeTokens.filter((token) =>
        tokenSet.has(token)
      ),
      positivePhrases: markers.positivePhrases.filter((phrase) =>
        normalizedText.includes(phrase)
      ),
      negativePhrases: markers.negativePhrases.filter((phrase) =>
        normalizedText.includes(phrase)
      ),
      contextIntensifiers: markers.contextIntensifiers.filter((phrase) =>
        normalizedText.includes(phrase)
      ),
      emotiveEmojiPositive: markers.emotiveEmojiPositive.filter((emoji) =>
        trimmed.includes(emoji)
      ),
      emotiveEmojiNegative: markers.emotiveEmojiNegative.filter((emoji) =>
        trimmed.includes(emoji)
      ),
      contextualEmoji: markers.contextualEmoji.filter((emoji) =>
        trimmed.includes(emoji)
      ),
    };

    const markerHits = {
      positiveTokens: matchedMarkers.positiveTokens.length,
      negativeTokens: matchedMarkers.negativeTokens.length,
      positivePhrases: matchedMarkers.positivePhrases.length,
      negativePhrases: matchedMarkers.negativePhrases.length,
      contextIntensifiers: matchedMarkers.contextIntensifiers.length,
      emotiveEmojiPositive: matchedMarkers.emotiveEmojiPositive.length,
      emotiveEmojiNegative: matchedMarkers.emotiveEmojiNegative.length,
      contextualEmoji: matchedMarkers.contextualEmoji.length,
    };

    const positiveMarkerCount =
      markerHits.positiveTokens + markerHits.positivePhrases;

    const hasCapsToken =
      rawTokens.filter((token) => {
        const normalized = token.replace(/[^A-Za-z]/g, "");
        if (
          normalized.length <
          VALENCE_CONSTANTS.evidenceBoost.capsTokenMinLength
        ) {
          return false;
        }
        return normalized === normalized.toUpperCase();
      }).length >= VALENCE_CONSTANTS.evidenceBoost.capsTokenMinCount;

    const hasRepeatedPunctuation =
      new RegExp(
        `[!?]{${VALENCE_CONSTANTS.evidenceBoost.punctuationRepeatMin},}`
      ).test(trimmed) ||
      new RegExp(
        `\\.{${VALENCE_CONSTANTS.evidenceBoost.ellipsisMin},}`
      ).test(trimmed);

    const evidenceMultiplier =
      VALENCE_CONSTANTS.bounds.one +
      (hasCapsToken
        ? VALENCE_CONSTANTS.evidenceBoost.capsMultiplier
        : VALENCE_CONSTANTS.bounds.zero) +
      (hasRepeatedPunctuation
        ? VALENCE_CONSTANTS.evidenceBoost.punctuationMultiplier
        : VALENCE_CONSTANTS.bounds.zero);

    positiveWeight +=
      markerHits.positiveTokens *
        VALENCE_CONSTANTS.markerWeights.positiveTokens +
      markerHits.positivePhrases *
        VALENCE_CONSTANTS.markerWeights.positivePhrases +
      markerHits.emotiveEmojiPositive *
        VALENCE_CONSTANTS.markerWeights.emotiveEmojiPositive;

    negativeWeight +=
      markerHits.negativeTokens *
        VALENCE_CONSTANTS.markerWeights.negativeTokens +
      markerHits.negativePhrases *
        VALENCE_CONSTANTS.markerWeights.negativePhrases +
      markerHits.emotiveEmojiNegative *
        VALENCE_CONSTANTS.markerWeights.emotiveEmojiNegative;

    if (markerHits.contextualEmoji > VALENCE_CONSTANTS.bounds.zero) {
      const usePositiveEmoji =
        positiveMarkerCount >=
        VALENCE_CONSTANTS.emojiContext.positiveMarkerThreshold;
      if (usePositiveEmoji) {
        positiveWeight +=
          markerHits.contextualEmoji *
          VALENCE_CONSTANTS.markerWeights.contextualEmojiPositive;
      } else {
        negativeWeight +=
          markerHits.contextualEmoji *
          VALENCE_CONSTANTS.markerWeights.contextualEmojiNegative;
      }
    }

    const markerEvidenceCount =
      markerHits.positiveTokens +
      markerHits.negativeTokens +
      markerHits.positivePhrases +
      markerHits.negativePhrases +
      markerHits.contextIntensifiers +
      markerHits.emotiveEmojiPositive +
      markerHits.emotiveEmojiNegative +
      markerHits.contextualEmoji;

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

    const contextualEmojiPositive =
      markerHits.contextualEmoji > VALENCE_CONSTANTS.bounds.zero &&
      positiveMarkerCount >=
        VALENCE_CONSTANTS.emojiContext.positiveMarkerThreshold;

    const markerConfidence =
      markerHits.positiveTokens *
        VALENCE_CONSTANTS.markerConfidence.positiveTokens +
      markerHits.negativeTokens *
        VALENCE_CONSTANTS.markerConfidence.negativeTokens +
      markerHits.positivePhrases *
        VALENCE_CONSTANTS.markerConfidence.positivePhrases +
      markerHits.negativePhrases *
        VALENCE_CONSTANTS.markerConfidence.negativePhrases +
      markerHits.contextIntensifiers *
        VALENCE_CONSTANTS.markerConfidence.contextIntensifiers +
      markerHits.emotiveEmojiPositive *
        VALENCE_CONSTANTS.markerConfidence.emotiveEmojiPositive +
      markerHits.emotiveEmojiNegative *
        VALENCE_CONSTANTS.markerConfidence.emotiveEmojiNegative +
      markerHits.contextualEmoji *
        (contextualEmojiPositive
          ? VALENCE_CONSTANTS.markerConfidence.contextualEmojiPositive
          : VALENCE_CONSTANTS.markerConfidence.contextualEmojiNegative);

    confidence = clamp(
      Math.max(confidence, markerConfidence * evidenceMultiplier),
      VALENCE_CONSTANTS.bounds.zero,
      VALENCE_CONSTANTS.bounds.one
    );

    if (debugEnabled) {
      console.log("[LoRa::ValenceDebug]", {
        markers: matchedMarkers,
        polarityHits,
        positiveWeight,
        negativeWeight,
        evidenceMultiplier,
        neutralTriggers,
      });
    }

    const semanticScore = computeSemanticScore(tokens);

    return {
      valence,
      score,
      confidence,
      semanticScore,
      evidence: {
        positiveWeight,
        negativeWeight,
        neutralTriggers,
      },
    };
  }
}
