export type SentenceBoundaryChar = "." | "!" | "?" | "\n";

export interface SentenceBoundary {
  boundaryIndex: number;
  boundaryChar: SentenceBoundaryChar;
  /**
   * Monotonic confidence score (ordinal), not a calibrated probability.
   * Invariant: if below `confidence.hardMinimum`, downstream sentence-level
   * analyzers MUST fall back to message-level computation.
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
    hardMinimum: number;
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
  regex: {
    urlOrEmail: {
      pattern: string;
      flags: string;
    };
    codeLike: {
      pattern: string;
      flags: string;
    };
    wordChar: {
      pattern: string;
      flags: string;
    };
    digit: {
      pattern: string;
      flags: string;
    };
    emoji: {
      pattern: string;
      flags: string;
    };
    codeBlock: {
      pattern: string;
      flags: string;
    };
    newlineWindows: {
      pattern: string;
      flags: string;
    };
    newlineClassic: {
      pattern: string;
      flags: string;
    };
    chatFragmentPrefix: {
      pattern: string;
      flags: string;
    };
  };
}
