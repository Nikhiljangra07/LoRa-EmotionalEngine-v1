// ──────────────────────────────────────────────────────
// VerificationResult — output of the extraction verifier
// Returned after checking extracted facts + fingerprint
// against the original session summary.
// ──────────────────────────────────────────────────────

/** A flagged fact that doesn't match the summary */
export interface FlaggedFact {
  /** Index into the FactAnchor[] array */
  anchorIndex: number;
  /** Why this fact was flagged */
  reason: string;
}

/** A suggested correction from the verifier */
export interface SuggestedCorrection {
  /** What field to correct */
  field: string;
  /** Current (incorrect) value */
  currentValue: string;
  /** Suggested replacement */
  suggestedValue: string;
}

export interface VerificationResult {
  /** True if all extractions match the summary */
  verified: boolean;
  /** Facts that don't match the summary */
  flaggedFacts: FlaggedFact[];
  /** Issues with the emotional fingerprint */
  fingerprintIssues: string[];
  /** Suggested corrections for flagged items */
  suggestedCorrections: SuggestedCorrection[];
}
