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
const DECAY = 0.85; // keeps continuity without dominance
const GAIN = 0.15; // ensures new signal always matters

const CONFIDENCE_FLOOR = 0.4;
const HARD_BREAK_THRESHOLD = 0.75;

export function updateMomentum(
  previous: MomentumState,
  detected: {
    valence: number;
    arousal: number;
    confidence: number;
  }
): MomentumState {
  // If signal confidence is too low, do not propagate momentum
  if (detected.confidence < CONFIDENCE_FLOOR) {
    return {
      ...previous,
      confidence: Math.max(0, previous.confidence - 0.1),
    };
  }

  // Hard contradiction → reset bias to detected signal
  if (
    Math.abs(detected.valence - previous.valenceBias) >
    HARD_BREAK_THRESHOLD
  ) {
    return {
      valenceBias: detected.valence,
      arousalBias: detected.arousal,
      confidence: detected.confidence,
    };
  }

  // Soft blend (exponential smoothing)
  return {
    valenceBias:
      previous.valenceBias * DECAY + detected.valence * GAIN,

    arousalBias:
      previous.arousalBias * DECAY + detected.arousal * GAIN,

    confidence:
      previous.confidence * DECAY + detected.confidence * GAIN,
  };
}
