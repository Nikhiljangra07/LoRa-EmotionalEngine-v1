import { exponentialDecay } from "./decay-engine";

export const SESSION_THRESHOLD_SECONDS = 3600; // 1 hour

export function isNewSession(deltaSeconds: number): boolean {
  // New session when inactivity exceeds threshold.
  return deltaSeconds > SESSION_THRESHOLD_SECONDS;
}

export function applySessionDecay(
  previousPressure: number,
  deltaSessionSeconds: number,
  tauLongSeconds: number
): number {
  // Soft decay across session gap using long tau.
  return exponentialDecay(previousPressure, deltaSessionSeconds, tauLongSeconds);
}
