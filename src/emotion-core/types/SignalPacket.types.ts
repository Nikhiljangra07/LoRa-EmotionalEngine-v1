export interface SentenceData {
  readonly text: string;
  readonly position: number;
  readonly esScore: number;
  readonly arousalScore: number;
}

export interface Layer1Health {
  readonly degraded: boolean;
  readonly reason: string;
  readonly failingAnalyzer?: string;
}

/**
 * SignalPacket is a Layer-1 output contract promised by the architecture.
 * It is NOT wired into v1 runtime. Wiring is deferred to v1.1.
 *
 * NOTE:
 * - Immutable by design (readonly fields).
 * - Type-only contract; do not import into runtime paths yet.
 */
export interface SignalPacket {
  readonly messageText: string;
  readonly sentences: readonly SentenceData[];
  readonly layer1Health: Layer1Health;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly expressionStrength?: { score: number; confidence: number };
  readonly valence?: { score: number; confidence: number };
  readonly arousal?: { arousal: number; confidence: number };
  readonly ambiguity?: {
    ambiguityScore: number;
    tonalContrastDetected: boolean;
    confidencePenaltyHint: number;
  };
}
