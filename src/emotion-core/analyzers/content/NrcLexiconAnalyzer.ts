// src/emotion-core/analyzers/content/NrcLexiconAnalyzer.ts

/**
 * NRC Emotion Categories (Discrete)
 * ---------------------------------
 * Matches NRC Emotion Lexicon v0.92
 */
import { NRCEmotion } from '../../types';
import { MASTER_CONSTANTS } from '../../config/master.constants';

const NRC_CONSTANTS = MASTER_CONSTANTS.nrcLexiconAnalyzer;

export interface NrcLexiconResult {
  distribution: Record<NRCEmotion, number>;
  dominantEmotion?: NRCEmotion;
  confidenceGap: number;
}

const distribution: Record<NRCEmotion, number> = {
  [NRCEmotion.ANGER]: 0,
  [NRCEmotion.ANTICIPATION]: 0,
  [NRCEmotion.DISGUST]: 0,
  [NRCEmotion.FEAR]: 0,
  [NRCEmotion.JOY]: 0,
  [NRCEmotion.SADNESS]: 0,
  [NRCEmotion.SURPRISE]: 0,
  [NRCEmotion.TRUST]: 0,
  [NRCEmotion.POSITIVE]: 0,
  [NRCEmotion.NEGATIVE]: 0,
};


/**
 * Analyzer Output (Sentence-level)
 */
export interface NrcAnalysisResult {
  /** Normalized emotion scores [0,1] */
  distribution: Record<NRCEmotion, number>;

  /** Dominant emotion if confidence gap allows */
  dominantEmotion?: NRCEmotion;

  /** Confidence gap between top-1 and top-2 emotions */
  confidenceGap: number;

  /** Reliability estimate based on word count */
  confidenceLevel: 'LOW' | 'MODERATE' | 'HIGH';

  /** Raw counts for debugging / audit */
  rawCounts: Record<NRCEmotion, number>;

  /** Total emotion-bearing tokens */
  tokenCount: number;
}

/**
 * Internal lexicon structure
 * word -> emotion -> 1
 */
type NrcLexicon = Record<string, Partial<Record<NRCEmotion, 1>>>;

/**
 * Load lexicon ONCE at module scope
 * --------------------------------
 * - No fs
 * - No runtime IO
 * - Deterministic
 */
import lexicon from '../../resources/nrc/processed/nrc_lexicon.json';

const NRC_LEXICON = lexicon as NrcLexicon;

/**
 * NRC Lexicon Analyzer
 * ====================
 * - Word-level lookup
 * - Sentence-level aggregation
 * - Frequency normalization
 * - Confidence gap detection
 *
 * NO negation handling here
 * NO POS filtering here
 */
export class NrcLexiconAnalyzer {
  static analyze(text: string): NrcAnalysisResult {
    const tokens = this.tokenize(text);
    const rawCounts = this.initializeCounts();

    let emotionTokenCount = 0;

    for (const token of tokens) {
      const entry = NRC_LEXICON[token];
      if (!entry) continue;

      emotionTokenCount++;

      for (const emotion of Object.keys(entry) as NRCEmotion[]) {
        rawCounts[emotion]++;
      }
    }

    const distribution = this.normalize(rawCounts);
    const { dominantEmotion, confidenceGap } =
      this.detectDominance(distribution);

    return {
      distribution,
      dominantEmotion,
      confidenceGap,
      confidenceLevel: this.estimateConfidence(tokens.length),
      rawCounts,
      tokenCount: emotionTokenCount,
    };
  }

  /* ============================================================
   * Tokenization (Deterministic, Conservative)
   * ============================================================
   */
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /* ============================================================
   * Utilities
   * ============================================================
   */
  private static initializeCounts(): Record<NRCEmotion, number> {
    return {
      [NRCEmotion.ANGER]: 0,
      [NRCEmotion.FEAR]: 0,
      [NRCEmotion.ANTICIPATION]: 0,
      [NRCEmotion.TRUST]: 0,
      [NRCEmotion.SURPRISE]: 0,
      [NRCEmotion.SADNESS]: 0,
      [NRCEmotion.JOY]: 0,
      [NRCEmotion.DISGUST]: 0,
      [NRCEmotion.POSITIVE]: 0,
      [NRCEmotion.NEGATIVE]: 0,
    };
  }

  private static normalize(
    counts: Record<NRCEmotion, number>
  ): Record<NRCEmotion, number> {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    if (total === 0) {
      return Object.fromEntries(
        Object.keys(counts).map((k) => [k, 0])
      ) as Record<NRCEmotion, number>;
    }

    return Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [
        k,
        Number((v / total).toFixed(4)),
      ])
    ) as Record<NRCEmotion, number>;
  }

  private static detectDominance(
    distribution: Record<NRCEmotion, number>
  ): {
    dominantEmotion?: NRCEmotion;
    confidenceGap: number;
  } {
    const sorted = Object.entries(distribution)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v > 0);

    if (sorted.length < 2) {
      return {
        dominantEmotion: sorted[0]?.[0] as NRCEmotion | undefined,
        confidenceGap: NRC_CONSTANTS.normalization.singleEmotionGap,
      };
    }

    const gap = Number(
      (sorted[0][1] - sorted[1][1]).toFixed(
        NRC_CONSTANTS.normalization.precisionDigits
      )
    );

    return {
      dominantEmotion:
        gap >= NRC_CONSTANTS.thresholds.dominantGapMin
          ? (sorted[0][0] as NRCEmotion)
          : undefined,
      confidenceGap: gap,
    };
  }

  private static estimateConfidence(
    tokenLength: number
  ): 'LOW' | 'MODERATE' | 'HIGH' {
    if (tokenLength < NRC_CONSTANTS.thresholds.confidenceTokenLowMaxExclusive) {
      return 'LOW';
    }
    if (
      tokenLength <
      NRC_CONSTANTS.thresholds.confidenceTokenModerateMaxExclusive
    ) {
      return 'MODERATE';
    }
    return 'HIGH';
  }
}