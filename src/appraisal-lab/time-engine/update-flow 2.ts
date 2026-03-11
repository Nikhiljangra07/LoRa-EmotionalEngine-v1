import { TAU_LONG_SECONDS, TAU_SHORT_SECONDS, applyTimeDecay } from "./decay-engine";
import {
  DEFAULT_BASELINE_LATENCY_SECONDS,
  computeGainModifier,
} from "./latency-detector";
import { applySessionDecay, isNewSession } from "./session-boundary";

// Combined time-based preprocessing. Does not compute emotional input. Prepares decayed pressure and timing gain.
export interface TimeUpdateResult {
  pressureAfterDecay: number;
  gainModifier: number;
}

export function updatePressureWithTime(
  previousPressure: number,
  deltaMessageSeconds: number,
  deltaSessionSeconds: number,
  baselineLatencySeconds: number = DEFAULT_BASELINE_LATENCY_SECONDS
): TimeUpdateResult {
  let pressureBeforeMessageDecay = previousPressure;

  if (isNewSession(deltaSessionSeconds)) {
    pressureBeforeMessageDecay = applySessionDecay(
      pressureBeforeMessageDecay,
      deltaSessionSeconds,
      TAU_LONG_SECONDS
    );
  }

  const pressureAfterDecay = applyTimeDecay(
    pressureBeforeMessageDecay,
    deltaMessageSeconds,
    TAU_SHORT_SECONDS
  );

  const gainModifier = computeGainModifier(
    deltaMessageSeconds,
    baselineLatencySeconds
  );

  return {
    pressureAfterDecay,
    gainModifier,
  };
}
