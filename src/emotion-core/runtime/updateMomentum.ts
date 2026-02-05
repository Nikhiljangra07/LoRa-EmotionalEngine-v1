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
  DECAY,
  GAIN,
  CONFIDENCE_FLOOR,
  HARD_BREAK_THRESHOLD,
} = MOMENTUM_CONSTANTS;

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
