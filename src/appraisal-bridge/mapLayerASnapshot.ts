import type { EmotionalState } from '../emotion-core/types/analysis.types';
import type { LayerASnapshot, PatternSignals } from './types';

// ─── Boundary sanitizers ─────────────────────────────────────────────

const MAX_DELTA_SECONDS = 86_400; // 24 h — any gap beyond this is clamped

/** Clamp a finite number to [0, 1]; non-finite → 0. */
export function sanitize01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Clamp a finite number to [-1, 1]; non-finite → 0. */
export function sanitize11(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(-1, Math.min(1, x));
}

/** Clamp a finite non-negative number to [0, MAX_DELTA_SECONDS]; non-finite or negative → 0. */
export function sanitizeDelta(x: number): number {
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.min(x, MAX_DELTA_SECONDS);
}

/** Non-finite → 0, otherwise pass through with a floor of 0. */
function sanitizeNonNeg(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, x);
}

// ─── Args / Mapper ───────────────────────────────────────────────────

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
  const s = args.analyzerScalars;

  const snapshot: LayerASnapshot = {
    messageIndex: args.messageIndex,
    timestampMs: args.timestampMs,
    deltaMessageSeconds: sanitizeDelta(args.deltaMessageSeconds),

    valenceScore: sanitize11(s.valenceScore),
    valenceConfidence: sanitize01(s.valenceConfidence),
    arousalScore: sanitize01(s.arousalScore),
    arousalConfidence: sanitize01(s.arousalConfidence),
    expressionStrength: sanitize01(s.expressionStrength),
    esConfidence: sanitize01(s.esConfidence),

    eivValue: sanitize01(args.eiv.value),
    eivTier: args.eiv.tier,

    ...(args.patternSignals
      ? {
          patternSignals: Object.freeze({
            capsRatio: sanitize01(args.patternSignals.capsRatio),
            punctuationHits: sanitizeNonNeg(args.patternSignals.punctuationHits),
            emojiHits: sanitizeNonNeg(args.patternSignals.emojiHits),
            repetitionScore: sanitize01(args.patternSignals.repetitionScore),
            questionMarks: sanitizeNonNeg(args.patternSignals.questionMarks),
          }),
        }
      : {}),

    emotionalState: args.emotionalState,
  };

  return Object.freeze(snapshot);
}
