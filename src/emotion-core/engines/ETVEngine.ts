// src/emotion-core/engines/ETVEngine.ts

export class ETVEngine {
  static updateETV(
    currentETV: number,
    sessionEIV: number,
    hasViolation: boolean
  ): number {
    const BASE_RECOVERY_RATE = 0.015; // conservative
    const VIOLATION_PENALTY = 0.08;

    let newETV = currentETV;

    // -----------------------------
    // Violation impact (unchanged)
    // -----------------------------
    if (hasViolation) {
      newETV -= VIOLATION_PENALTY * sessionEIV;
    }

    // -----------------------------
    // Recovery logic (with bias)
    // -----------------------------
    if (!hasViolation && sessionEIV >= 0.55) {
      const recoveryBias =
        sessionEIV >= 0.75 ? 1.25 :
        sessionEIV >= 0.65 ? 1.15 :
        1.1;

      const recoveryAmount =
        BASE_RECOVERY_RATE * sessionEIV * recoveryBias;

      newETV += recoveryAmount;
    }

    // -----------------------------
    // Clamp (safety rail)
    // -----------------------------
    newETV = Math.max(0, Math.min(1, newETV));

    return Number(newETV.toFixed(3));
  }

  // ----------------------------------
  // Sessions-to-recover (unchanged)
  // ----------------------------------
  static sessionsToRecover(
    currentETV: number,
    targetETV: number
  ): number {
    if (currentETV >= targetETV) return 0;

    const avgRecoveryPerSession = 0.02;
    return Math.ceil(
      (targetETV - currentETV) / avgRecoveryPerSession
    );
  }
}
