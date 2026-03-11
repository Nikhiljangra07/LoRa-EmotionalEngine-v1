import { MOMENTUM_CONSTANTS } from '../config/momentum.constants';
import { MomentumState } from './MomentumState';

/**
 * Momentum update parameters.
 *
 * These values are intentionally conservative:
 * - decay keeps inertia weak
 * - gain prevents override
 *
 * Rationale:
 * This is exponential smoothing, not escalation.
 */
const {
  decay,
  gain,
  confidence,
  history,
  hardBreakThreshold,
} = MOMENTUM_CONSTANTS;

type MomentumSignal = {
  valence: number;
  arousal: number;
  confidence: number;
};

export function updateMomentum(
  previous: MomentumState,
  detected: MomentumSignal,
  recentSignals: MomentumSignal[]
): MomentumState {
  const historyWindow = recentSignals.slice(
    Math.max(0, recentSignals.length - history.maxEntries)
  );
  const historyCount = historyWindow.length;

  const historyTotals = historyWindow.reduce(
    (acc, signal) => {
      acc.valence += signal.valence;
      acc.arousal += signal.arousal;
      acc.confidence += signal.confidence;
      return acc;
    },
    { valence: 0, arousal: 0, confidence: 0 }
  );

  const meanValence =
    historyCount > 0 ? historyTotals.valence / historyCount : detected.valence;
  const meanArousal =
    historyCount > 0 ? historyTotals.arousal / historyCount : detected.arousal;
  const meanConfidence =
    historyCount > 0
      ? historyTotals.confidence / historyCount
      : detected.confidence;

  const hasSufficientHistory =
    historyCount >= history.minEntriesForConfidence;

  const aggregatedConfidence = hasSufficientHistory
    ? Math.max(meanConfidence, confidence.aggregationFloor)
    : meanConfidence;

  // If signal confidence is too low, do not propagate momentum
  if (detected.confidence < confidence.floor && !hasSufficientHistory) {
    return {
      ...previous,
      confidence: Math.max(
        0,
        previous.confidence - confidence.lowSignalPenalty
      ),
    };
  }

  // Hard contradiction → reset bias to detected signal
  if (
    Math.abs(detected.valence - previous.valenceBias) >
    hardBreakThreshold
  ) {
    return {
      valenceBias: detected.valence,
      arousalBias: detected.arousal,
      confidence: aggregatedConfidence,
    };
  }

  // Soft blend (exponential smoothing)
  return {
    valenceBias: previous.valenceBias * decay + meanValence * gain,

    arousalBias: previous.arousalBias * decay + meanArousal * gain,

    confidence:
      previous.confidence * decay + aggregatedConfidence * gain,
  };
}
