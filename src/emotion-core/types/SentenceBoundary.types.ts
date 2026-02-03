export type SentenceBoundaryChar = "." | "!" | "?" | "\n";

export interface SentenceBoundary {
  boundaryIndex: number;
  boundaryChar: SentenceBoundaryChar;
  /**
   * Monotonic confidence score (ordinal), not a calibrated probability.
   */
  boundaryConfidence: number;
  boundarySources: string[];
  ambiguityFlags?: string[];
}

export interface SentenceBoundaryAnalysis {
  boundaries: SentenceBoundary[];
  normalizedText: string;
}

export interface SentenceBoundaryAnalyzerConstants {
  enableChatHeuristics: boolean;
  numbers: {
    zero: number;
    one: number;
  };
  bounds: {
    min: number;
    max: number;
  };
  confidence: {
    base: number;
    punctuationBoost: {
      period: number;
      exclamation: number;
      question: number;
      newline: number;
    };
    capitalizationBoost: number;
    abbreviationPenalty: number;
    decimalPenalty: number;
    urlOrEmailPenalty: number;
    emojiAdjacencyPenalty: number;
    ellipsisPenalty: number;
    chatFragmentPenalty: number;
    codeBlockPenalty: number;
    llrBoost: number;
  };
  punkt: {
    abbreviations: readonly string[];
    llr: Record<string, number>;
    llrThreshold: number;
  };
  heuristics: {
    ellipsisMinLength: number;
    emojiAdjacencyWindow: number;
    chatFragmentMaxLength: number;
  };
}
