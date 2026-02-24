import type { EmotionalState } from '../emotion-core/types/analysis.types';
import type { LayerASnapshot, PatternSignals } from './types';

export interface LayerASnapshotArgs {
  messageIndex: number;
  timestampMs: number;
  deltaMessageSeconds: number;
  analyzerScalars: {
    valenceScore: number;
    valenceConfidence: number;
    arousalScore: number;
    arousalConfidence: number;
    expressionStrength: number;
    esConfidence: number;
  };
  eiv: { value: number; tier: string };
  emotionalState: EmotionalState;
  patternSignals?: PatternSignals;
}

export function mapLayerASnapshot(args: LayerASnapshotArgs): LayerASnapshot {
  const snapshot: LayerASnapshot = {
    messageIndex: args.messageIndex,
    timestampMs: args.timestampMs,
    deltaMessageSeconds: args.deltaMessageSeconds,

    valenceScore: args.analyzerScalars.valenceScore,
    valenceConfidence: args.analyzerScalars.valenceConfidence,
    arousalScore: args.analyzerScalars.arousalScore,
    arousalConfidence: args.analyzerScalars.arousalConfidence,
    expressionStrength: args.analyzerScalars.expressionStrength,
    esConfidence: args.analyzerScalars.esConfidence,

    eivValue: args.eiv.value,
    eivTier: args.eiv.tier,

    ...(args.patternSignals
      ? {
          patternSignals: Object.freeze({ ...args.patternSignals }),
        }
      : {}),

    emotionalState: args.emotionalState,
  };

  return Object.freeze(snapshot);
}
