import { TimeDeltaResult } from "./types";

// Standardize all inputs to Unix seconds to avoid unit-mixing bugs.
export function computeDeltaSeconds(
  currentTs: number,
  previousTs: number
): number {
  // Clamp negative values to zero to handle out-of-order timestamps safely.
  return Math.max(0, currentTs - previousTs);
}

export function computeTimeDeltas(
  currentTs: number,
  previousMessageTs: number,
  previousSessionTs: number
): TimeDeltaResult {
  const deltaMessage = computeDeltaSeconds(currentTs, previousMessageTs);
  const deltaSession = computeDeltaSeconds(currentTs, previousSessionTs);

  return {
    deltaMessage,
    deltaSession,
  };
}
