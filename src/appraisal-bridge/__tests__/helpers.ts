import type { LayerASnapshot } from '../types';
import { mapLayerASnapshot } from '../mapLayerASnapshot';

export function makeSnapshot(
  overrides: Partial<{
    messageIndex: number;
    timestampMs: number;
    deltaMessageSeconds: number;
    valenceScore: number;
    arousalScore: number;
    expressionStrength: number;
    eivValue: number;
    eivTier: string;
    capsRatio: number;
    punctuationHits: number;
    emojiHits: number;
    repetitionScore: number;
    questionMarks: number;
  }> = {}
): LayerASnapshot {
  return mapLayerASnapshot({
    messageIndex: overrides.messageIndex ?? 0,
    timestampMs: overrides.timestampMs ?? 1_000_000,
    deltaMessageSeconds: overrides.deltaMessageSeconds ?? 30,
    analyzerScalars: {
      valenceScore: overrides.valenceScore ?? 0,
      valenceConfidence: 0.7,
      arousalScore: overrides.arousalScore ?? 0.3,
      arousalConfidence: 0.7,
      expressionStrength: overrides.expressionStrength ?? 0.3,
      esConfidence: 0.7,
    },
    eiv: {
      value: overrides.eivValue ?? 0.3,
      tier: overrides.eivTier ?? 'moderate',
    },
    emotionalState: {
      dominant: 'NEUTRAL',
      arousal: 'MEDIUM',
      valence: 'NEUTRAL',
      confidence: 0.7,
    },
    patternSignals: {
      capsRatio: overrides.capsRatio ?? 0.05,
      punctuationHits: overrides.punctuationHits ?? 1,
      emojiHits: overrides.emojiHits ?? 0,
      repetitionScore: overrides.repetitionScore ?? 0.1,
      questionMarks: overrides.questionMarks ?? 0,
    },
  });
}
