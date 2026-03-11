export const TAU_SHORT_SECONDS = 900; // 15 minutes
export const TAU_LONG_SECONDS = 14400; // 4 hours

export function exponentialDecay(
  value: number,
  deltaSeconds: number,
  tauSeconds: number
): number {
  // Exponential decay models leaky integration over elapsed time.
  // Tau controls how quickly the value decays.
  const decayFactor = Math.exp(-deltaSeconds / tauSeconds);
  return value * decayFactor;
}

export function applyTimeDecay(
  previousPressure: number,
  deltaSeconds: number,
  tauSeconds: number
): number {
  return exponentialDecay(previousPressure, deltaSeconds, tauSeconds);
}
