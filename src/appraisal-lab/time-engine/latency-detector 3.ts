export const DEFAULT_BASELINE_LATENCY_SECONDS = 90;

export function detectBurst(
  deltaSeconds: number,
  baselineSeconds: number
): boolean {
  // Burst = faster-than-expected reply.
  return deltaSeconds < 0.5 * baselineSeconds;
}

export function detectSilence(
  deltaSeconds: number,
  baselineSeconds: number
): boolean {
  // Silence = slower-than-expected reply.
  return deltaSeconds > 2.0 * baselineSeconds;
}

export function computeGainModifier(
  deltaSeconds: number,
  baselineSeconds: number
): number {
  if (detectBurst(deltaSeconds, baselineSeconds)) {
    // 1.3 = amplification during rapid exchange.
    return 1.3;
  }

  if (detectSilence(deltaSeconds, baselineSeconds)) {
    // 0.8 = dampening during prolonged silence.
    return 0.8;
  }

  // 1.0 = neutral timing.
  return 1.0;
}
