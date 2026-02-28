/**
 * Masked Pressure Persistence Gate — 2-of-4 rolling window.
 *
 * When maskedPressure=true for 2+ of the last 4 turns, the persistence
 * gate triggers downstream overrides (STABILIZING mode, qBudget clamp,
 * action hint). This improves focus on "logical + respectful + agency
 * forcing" when users minimize/deflect.
 */

/** True if at least 2 of the last 4 entries in history are true. */
export function isMaskedPressurePersistent(history: readonly boolean[]): boolean {
  const last4 = history.slice(-4);
  return last4.filter(Boolean).length >= 2;
}

export const MASKED_PRESSURE_HISTORY_MAX = 4;
