export interface AmbiguitySignal {
  ambiguityScore: number;
  ambiguitySources: string[];
  contradictionDetected: boolean;
  /**
   * INVARIANT:
   * If ambiguityScore > MASTER_CONSTANTS.ambiguity.threshold,
   * ALL downstream confidence scores MUST be multiplied by confidencePenaltyHint.
   */
  confidencePenaltyHint: number;
}
