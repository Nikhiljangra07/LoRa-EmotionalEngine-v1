import type { SentenceBoundaryAnalyzerConstants } from "../types/SentenceBoundary.types";

/**
 * Layer 0: MASTER CONSTANTS
 *
 * Centralized numeric constants intended for reuse across analyzers and scorers.
 * Declarative only — no functions, no calculations.
 *
 * V1 frozen: do not change these values without updating tests and documentation.
 */

const MASTER_BOUNDS = {
  zero: 0,
  one: 1,
} as const;
const MASTER_THRESHOLDS = {} as const;
const MASTER_WEIGHTS = {} as const;
const MASTER_LIMITS = {} as const;

// ES (Expression Strength)
const ES_CONSTANTS = {
  numbers: {
    zero: 0,
    one: 1,
  },
  weights: {
    caps: 0.25,
    exclamation: 0.22,
    question: 0.12,
    emoji: 0.22,
    lengthening: 0.17,
    intensifier: 0.12,
    interjection: 0.10,
  },
  elongation: {
    // UNJUSTIFIED: calibrate minimum repeat threshold for elongation.
    minRepeat: 3,
  },
  density: {
    minTotalChars: 1,
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
  baselineFloor: 0.05,
} as const;

// CAPS (Capitalization Analyzer)
const CAPITALIZATION_CONSTANTS = {
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
  eivMath: {
    maxEiv: 1, // upper bound for capitalization intensity
    softCapLimit: 4, // full contribution upper bound
    hardCapLimit: 6, // diminishing returns upper bound
    diminishingMultiplier: 0.5, // reduced contribution factor
    densityThreshold: 0.4, // caps density penalty threshold
    densityPenaltyFactor: 0.85, // confidence multiplier under high density
    signalCounts: {
      single: 1, // single signal count
    },
    confidenceDefaults: {
      emptySignals: 1, // confidence when no caps signals
      singleSignal: 0.55, // single all-caps confidence
      controlledSignals: 0.75, // controlled repetition confidence
      overuseSignals: 0.65, // overuse confidence
    },
    clamp: {
      min: 0, // intensity/confidence lower bound
      max: 1, // intensity/confidence upper bound
    },
  },
} as const;

// PUNCTUATION (Punctuation Analyzer)
const PUNCTUATION_ANALYZER_CONSTANTS = {
  thresholds: {
    positionStartRatio: 0.25,
    positionEndRatio: 0.75,
    ellipsisMinDots: 3,
  },
  scoring: {
    mixedPairDivisor: 2,
    periodCount: 1,
  },
} as const;

// EMOJI (Emoji Analyzer)
const EMOJI_ANALYZER_CONSTANTS = {
  thresholds: {
    emptyTextLength: 0,
    emptyEmojiCount: 0,
  },
  defaults: {
    confidence: 0,
    countSeed: 0,
    indexStart: 0,
  },
} as const;

// REPETITION (Repetition Analyzer)
const REPETITION_ANALYZER_CONSTANTS = {
  thresholds: {
    minRepeatCount: 2,
  },
} as const;

// REPETITION (Math)
const REPETITION_MATH_CONSTANTS = {
  maxEiv: 1, // upper bound for repetition intensity
  maxRepetitionBoost: 0.4, // maximum repetition boost
  repetitionScale: 0.15, // repetition saturation scale
  maxEffectiveRepetition: 5, // stylistic saturation cap
  minBoostCount: 2, // minimum repetitions for boost
  confidence: {
    singleMaxInclusive: 1, // single occurrence threshold
    doubleCount: 2, // double occurrence threshold
    controlledMaxInclusive: 5, // controlled repetition cap
    single: 0.5, // single confidence
    double: 0.75, // double confidence
    controlled: 0.85, // controlled confidence
    overuse: 0.7, // overuse confidence
  },
  clamp: {
    min: 0, // lower bound
    max: 1, // upper bound
  },
} as const;

// NRC (NRC Lexicon Analyzer)
const NRC_LEXICON_ANALYZER_CONSTANTS = {
  thresholds: {
    dominantGapMin: 0.6,
    minDominanceCandidates: 2,
    minNonZeroScore: 0,
    confidenceTokenLowMaxExclusive: 10,
    confidenceTokenModerateMaxExclusive: 30,
  },
  normalization: {
    precisionDigits: 4,
    singleEmotionGap: 1,
  },
} as const;

// NEGATION (Negation Scope Analyzer)
const NEGATION_SCOPE_CONSTANTS = {
  windows: {
    forward: 5,
    backward: 2,
  },
  thresholds: {
    doubleNegationMinCount: 2,
    unPrefixMinLengthExclusive: 3,
  },
} as const;

// VALENCE (Valence Analyzer)
const VALENCE_ANALYZER_CONSTANTS = {
  lexicon: {
    polarity: {
      positive: [
        "good",
        "great",
        "excellent",
        "nice",
        "pleasant",
        "favorable",
        "awesome",
        "wonderful",
      ],
      negative: [
        "bad",
        "terrible",
        "awful",
        "poor",
        "horrible",
        "worse",
        "worst",
        "unpleasant",
      ],
    },
  },
  thresholds: {
    minMagnitude: 0.15,
    dominanceEpsilon: 0.05,
  },
  confidence: {
    minAffectiveTokens: 2,
    lowEvidenceMultiplier: 0.5,
  },
  negation: {
    attenuation: 0.5,
    scope: 5,
    tokens: ["not", "never", "no", "none", "cannot"],
  },
  contrast: {
    markers: ["but", "however", "although", "though", "yet"],
    preWeight: 0.5,
    postWeight: 1,
  },
  normalization: {
    epsilon: 1e-6,
    minScore: -1,
    maxScore: 1,
  },
  bounds: {
    zero: 0,
    one: 1,
    negOne: -1,
  },
  iteration: {
    indexStep: 1,
  },
} as const;

// AMBIGUITY (Ambiguity Analyzer)
interface AmbiguityAnalyzerConstants {
  lexicon: {
    hedgingTokens: readonly string[];
    modalTokens: readonly string[];
    contrastTokens: readonly string[];
    polarity: {
      positive: readonly string[];
      negative: readonly string[];
    };
  };
  baseline: {
    score: number;
  };
  weights: {
    hedging: number;
    modal: number;
    contrast: number;
    rhetorical: number;
    contradiction: number;
    passive: number;
  };
  saturation: {
    hedgingCount: number;
    modalCount: number;
    contrastCount: number;
    rhetoricalCount: number;
    passiveCount: number;
    contradictionFlag: number;
  };
  thresholds: {
    minTokenLength: number;
    contradictionTokenWindow: number;
    contradictionDistantMultiplier: number;
  };
  passiveVoice: {
    irregularParticiples: readonly string[];
  };
  scoring: {
    dampening: number;
  };
  /**
   * Minimum upward deviation applied when at least one ambiguity signal is detected.
   */
  minSignalDelta: number;
  invariants: {
    /**
     * Minimum upward deviation applied when at least one ambiguity signal is detected.
     */
    minExistenceDelta: number;
  };
  bounds: {
    min: number;
    max: number;
  };
  penaltyHint: {
    scale: number;
    min: number;
    max: number;
    floor: number;
  };
}

const AMBIGUITY_ANALYZER_CONSTANTS: AmbiguityAnalyzerConstants = {
  lexicon: {
    hedgingTokens: [
      "maybe",
      "perhaps",
      "guess",
      "kinda",
      "kind",
      "sort",
      "probably",
      "possibly",
      "roughly",
      "around",
    ],
    modalTokens: ["might", "could", "may", "would", "should"],
    contrastTokens: [
      "but",
      "however",
      "though",
      "yet",
      "whereas",
      "nevertheless",
    ],
    polarity: {
      positive: [
        "good",
        "great",
        "love",
        "like",
        "amazing",
        "happy",
        "excited",
        "nice",
        "wonderful",
        "awesome",
      ],
      negative: [
        "bad",
        "hate",
        "awful",
        "terrible",
        "sad",
        "angry",
        "upset",
        "annoyed",
        "horrible",
        "worse",
        "worst",
      ],
    },
  },
  baseline: {
    score: 0.08,
  },
  weights: {
    hedging: 0.16,
    modal: 0.14,
    contrast: 0.12,
    rhetorical: 0.18,
    contradiction: 0.22,
    passive: 0.14,
  },
  saturation: {
    hedgingCount: 2,
    modalCount: 2,
    contrastCount: 2,
    rhetoricalCount: 1,
    passiveCount: 2,
    contradictionFlag: 1,
  },
  thresholds: {
    minTokenLength: 2,
    contradictionTokenWindow: 3,
    contradictionDistantMultiplier: 0.45,
  },
  passiveVoice: {
    irregularParticiples: [
      "made",
      "done",
      "seen",
      "known",
      "given",
      "taken",
      "gone",
      "left",
      "set",
      "hurt",
    ],
  },
  scoring: {
    dampening: 0.85,
  },
  minSignalDelta: 0.01,
  invariants: {
    minExistenceDelta: 0.01,
  },
  bounds: {
    min: 0,
    max: 1,
  },
  penaltyHint: {
    scale: 0.9,
    min: 0,
    max: 1,
    floor: 0.35,
  },
} as const;

const AMBIGUITY_CONSTRAINTS = {
  threshold: AMBIGUITY_ANALYZER_CONSTANTS.baseline.score,
} as const;

// SENTENCE BOUNDARY (Sentence Boundary Analyzer)
const SENTENCE_BOUNDARY_ANALYZER_CONSTANTS: SentenceBoundaryAnalyzerConstants = {
  enableChatHeuristics: true,
  numbers: {
    zero: 0,
    one: 1,
  },
  bounds: {
    min: 0,
    max: 1,
  },
  confidence: {
    // UNJUSTIFIED: calibrate ordinal base via boundary audit set.
    base: 0.55,
    // UNJUSTIFIED: hard minimum for routing fallback in downstream analyzers.
    hardMinimum: 0.4,
    punctuationBoost: {
      // UNJUSTIFIED: calibrate punctuation ordinal boosts.
      period: 0.12,
      exclamation: 0.16,
      question: 0.16,
      newline: 0.08,
    },
    // UNJUSTIFIED: capitalization heuristic boost.
    capitalizationBoost: 0.08,
    // UNJUSTIFIED: abbreviation ambiguity penalty.
    abbreviationPenalty: 0.18,
    // UNJUSTIFIED: decimal proximity penalty.
    decimalPenalty: 0.2,
    // UNJUSTIFIED: URL/email proximity penalty.
    urlOrEmailPenalty: 0.22,
    // UNJUSTIFIED: emoji adjacency penalty.
    emojiAdjacencyPenalty: 0.16,
    // UNJUSTIFIED: ellipsis context penalty.
    ellipsisPenalty: 0.14,
    // UNJUSTIFIED: chat fragment penalty.
    chatFragmentPenalty: 0.12,
    // UNJUSTIFIED: code-like context penalty.
    codeBlockPenalty: 0.2,
    // UNJUSTIFIED: Punkt LLR support boost.
    llrBoost: 0.1,
  },
  punkt: {
    abbreviations: [
      "dr",
      "mr",
      "mrs",
      "ms",
      "prof",
      "sr",
      "jr",
      "st",
      "vs",
      "etc",
      "e.g",
      "i.e",
    ],
    llr: {},
    // UNJUSTIFIED: requires Punkt calibration set (>=500k tokens).
    llrThreshold: 0,
  },
  heuristics: {
    // UNJUSTIFIED: calibrate ellipsis minimum length.
    ellipsisMinLength: 3,
    // UNJUSTIFIED: adjacency window for emoji + boundary.
    emojiAdjacencyWindow: 1,
    // UNJUSTIFIED: max chars for chat fragment line.
    chatFragmentMaxLength: 40,
  },
  regex: {
    urlOrEmail: {
      pattern: "\\bhttps?:\\/\\/\\S+|\\bwww\\.\\S+|\\b\\S+@\\S+\\b",
      flags: "g",
    },
    codeLike: {
      pattern:
        "(^|\\n)\\s*(const|let|var|function|if|for|while|return|class)\\b",
      flags: "",
    },
    wordChar: {
      pattern: "[A-Za-z]",
      flags: "",
    },
    digit: {
      pattern: "\\d",
      flags: "",
    },
    emoji: {
      pattern: "\\p{Extended_Pictographic}",
      flags: "gu",
    },
    codeBlock: {
      pattern: "```[\\s\\S]*?```",
      flags: "g",
    },
    newlineWindows: {
      pattern: "\\r\\n",
      flags: "g",
    },
    newlineClassic: {
      pattern: "\\r",
      flags: "g",
    },
    chatFragmentPrefix: {
      pattern: "^[-*>]",
      flags: "",
    },
  },
} as const;

const VALENCE_AMBIGUITY_CONSTRAINTS = {
  NEGATIVE_MIN_CONF: 0,
  NEGATIVE_MAX_CONF: 0.7,
  NEUTRAL_MIN_CONF: 0,
  NEUTRAL_MAX_CONF: 0.6,
  OVERCONFIDENT_MAX: 0.8,
} as const;

const EIV_COMPOSITION_CONSTANTS = {
  EPS: 1e-6,
  CLAMP: { MIN: 0, MAX: 1 },
  CONF: { MIN: 0.4, MAX: 0.9 },

  BASE_FLOOR_GATE: 0.20,
  ES_GAIN_MAX_DELTA: 0.25,
  LOW_BASE_GAIN_SCALE: 0.25,

  DOMINANCE: {
    ENABLE: false,
  },
} as const;

// AROUSAL (Arousal Analyzer)
// Structural / cognitive load only. No emotion or expressivity signals.
const AROUSAL_CALIBRATION_CONSTANTS = {
  numbers: {
    zero: 0,
    one: 1,
  },
  bounds: {
    min: 0.20,
    max: 1.0,
  },
  weights: {
    // UNJUSTIFIED: calibrate signal weights on audit set.
    sentenceLengthVariance: 0.25,
    rareWordUsage: 0.18,
    questionDensity: 0.12,
    imperativePresence: 0.10,
    clauseStacking: 0.20,
  },
  saturation: {
    // UNJUSTIFIED: calibrate saturation thresholds.
    sentenceLengthVariance: 0.02,
    rareWordRatio: 0.25,
    questionDensity: 0.25,
    imperativeDensity: 0.25,
    clauseStackingRatio: 0.25,
  },
  thresholds: {
    // UNJUSTIFIED: calibrate minimum token counts for variance.
    minTokensForVariance: 12,
    // UNJUSTIFIED: calibrate minimum token length for rarity.
    rareTokenMinLength: 2,
    minSignalCount: 1,
  },
  confidence: {
    base: 0.8,
    lowEvidencePenalty: 0.2,
    min: 0.4,
    max: 0.9,
  },
  question: {
    starters: [
      "who",
      "what",
      "when",
      "where",
      "why",
      "how",
      "do",
      "does",
      "did",
      "is",
      "are",
      "can",
      "could",
      "should",
      "would",
      "will",
    ],
  },
  imperative: {
    verbs: [
      "do",
      "tell",
      "give",
      "show",
      "make",
      "take",
      "bring",
      "send",
      "go",
      "stop",
      "start",
    ],
  },
  clause: {
    conjunctions: [
      "and",
      "or",
      "but",
      "so",
      "because",
      "although",
      "though",
      "yet",
      "however",
    ],
  },
  rarity: {
    commonTokens: [
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "of",
      "to",
      "in",
      "on",
      "for",
      "with",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "this",
      "that",
      "these",
      "those",
      "it",
      "they",
      "we",
      "you",
      "i",
      "he",
      "she",
      "them",
    ],
  },
  regex: {
    token: "[A-Za-z']+",
  },
} as const;

// LAYER-1 HEALTH (audit: confidence degradation threshold)
const LAYER1_CONSTANTS = {
  degradation: {
    confidenceThreshold: 0.3, // minimum acceptable Layer-1 confidence
  },
} as const;

// ENGINE DEFAULTS (audit: centralized initialization)
const ENGINE_DEFAULTS = {
  initialETV: 0.5, // default session starting point
} as const;

// STATE CLASSIFICATION (audit: branching thresholds)
const STATE_CLASSIFICATION = {
  eivTier: {
    lowMaxExclusive: 0.25, // low tier upper bound
    mediumMaxExclusive: 0.5, // medium tier upper bound
    highMaxExclusive: 0.75, // high tier upper bound
  },
  arousalFromEiv: {
    highMinInclusive: 0.75, // high arousal lower bound
    mediumMinInclusive: 0.35, // medium arousal lower bound
  },
  relationshipStyle: {
    professionalMaxExclusive: 0.4, // professional upper bound
    friendlyMaxExclusive: 0.6, // friendly upper bound
  },
} as const;

// EMOTIONAL STATE INTERPRETATION (audit: arousal classification)
const EMOTIONAL_STATE_INTERPRETATION = {
  arousalFromEiv: {
    highMinInclusive: 0.75, // high arousal lower bound
    mediumMinInclusive: 0.35, // medium arousal lower bound
  },
} as const;

// PROMPT POLICY (audit: formality thresholds)
const PROMPT_POLICY = {
  etvThresholds: {
    professionalMaxExclusive: 0.35, // professional upper bound
    friendlyMaxExclusive: 0.65, // friendly upper bound
  },
} as const;

// PROMPT TEMPLATE (audit: relationship bands)
const PROMPT_TEMPLATE = {
  etvBands: {
    professionalMaxExclusive: 0.4, // professional upper bound
    friendlyMaxExclusive: 0.6, // friendly upper bound
  },
} as const;

// EIV TIERS (audit: tier thresholds)
const EIV_CONSTANTS = {
  tiers: {
    minimalMaxExclusive: 0.15, // minimal upper bound
    lowMaxExclusive: 0.3, // low upper bound
    moderateMaxExclusive: 0.55, // moderate upper bound
    highMaxExclusive: 0.8, // high upper bound
  },
} as const;

// ETV RECOVERY (audit: recovery calibration)
const ETV_RECOVERY = {
  baseRate: 0.015, // conservative baseline recovery rate
  minSessionEivForRecovery: 0.55, // minimum EIV to trigger recovery
  bias: {
    highMinInclusive: 0.75, // high-EIV recovery bias threshold
    midMinInclusive: 0.65, // mid-EIV recovery bias threshold
    high: 1.25, // high recovery bias multiplier
    mid: 1.15, // mid recovery bias multiplier
    low: 1.1, // low recovery bias multiplier
  },
  avgRecoveryPerSession: 0.02, // sessions-to-recover average increment
} as const;

// PENALTIES (audit: explicit penalty constants)
const PENALTIES = {
  etvViolation: 0.08, // violation penalty multiplier
} as const;

// ETV BOUNDS (audit: clamp and rounding policy)
const ETV_BOUNDS = {
  min: 0, // lower clamp
  max: 1, // upper clamp
  roundingDecimals: 3, // persisted precision
} as const;

// ETV (audit: recovery + bounds)
const ETV_CONSTANTS = {
  recovery: {
    baseRate: ETV_RECOVERY.baseRate,
    minSessionEivForRecovery: ETV_RECOVERY.minSessionEivForRecovery,
    bias: ETV_RECOVERY.bias,
    avgRecoveryPerSession: ETV_RECOVERY.avgRecoveryPerSession,
    violationPenalty: PENALTIES.etvViolation,
  },
  bounds: ETV_BOUNDS,
} as const;

export const MASTER_CONSTANTS = {
  bounds: MASTER_BOUNDS,
  thresholds: MASTER_THRESHOLDS,
  weights: MASTER_WEIGHTS,
  limits: MASTER_LIMITS,
  es: ES_CONSTANTS,
  expressionStrength: ES_CONSTANTS,
  capitalization: CAPITALIZATION_CONSTANTS,
  punctuationAnalyzer: PUNCTUATION_ANALYZER_CONSTANTS,
  emojiAnalyzer: EMOJI_ANALYZER_CONSTANTS,
  repetitionAnalyzer: REPETITION_ANALYZER_CONSTANTS,
  repetitionMath: REPETITION_MATH_CONSTANTS,
  nrcLexiconAnalyzer: NRC_LEXICON_ANALYZER_CONSTANTS,
  negationScopeAnalyzer: NEGATION_SCOPE_CONSTANTS,
  valenceAnalyzer: VALENCE_ANALYZER_CONSTANTS,
  ambiguityAnalyzer: AMBIGUITY_ANALYZER_CONSTANTS,
  ambiguity: AMBIGUITY_CONSTRAINTS,
  sentenceBoundaryAnalyzer: SENTENCE_BOUNDARY_ANALYZER_CONSTANTS,
  valenceAmbiguityConstraints: VALENCE_AMBIGUITY_CONSTRAINTS,
  arousalCalibrationConstants: AROUSAL_CALIBRATION_CONSTANTS,
  eivCompositionConstants: EIV_COMPOSITION_CONSTANTS,
  layer1: LAYER1_CONSTANTS,
  engineDefaults: ENGINE_DEFAULTS,
  stateClassification: STATE_CLASSIFICATION,
  emotionalState: {
    interpretation: EMOTIONAL_STATE_INTERPRETATION,
  },
  promptPolicy: PROMPT_POLICY,
  promptTemplate: PROMPT_TEMPLATE,
  eiv: EIV_CONSTANTS,
  etvRecovery: ETV_RECOVERY,
  penalties: PENALTIES,
  etvBounds: ETV_BOUNDS,
  etv: ETV_CONSTANTS,
} as const;

export { VALENCE_AMBIGUITY_CONSTRAINTS };
