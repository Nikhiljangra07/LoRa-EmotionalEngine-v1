// src/emotion-core/engines/ETVEngine.ts

import { MASTER_CONSTANTS } from "../config/master.constants";

export class ETVEngine {
  static updateETV(
    currentETV: number,
    sessionEIV: number,
    hasViolation: boolean
  ): number {
    const BASE_RECOVERY_RATE =
      MASTER_CONSTANTS.etvRecovery.baseRate; // conservative
    const VIOLATION_PENALTY =
      MASTER_CONSTANTS.penalties.etvViolation;

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
    if (
      !hasViolation &&
      sessionEIV >=
        MASTER_CONSTANTS.etvRecovery.minSessionEivForRecovery
    ) {
      const recoveryBias =
        sessionEIV >=
        MASTER_CONSTANTS.etvRecovery.bias.highMinInclusive
          ? MASTER_CONSTANTS.etvRecovery.bias.high
          : sessionEIV >=
            MASTER_CONSTANTS.etvRecovery.bias.midMinInclusive
          ? MASTER_CONSTANTS.etvRecovery.bias.mid
          : MASTER_CONSTANTS.etvRecovery.bias.low;

      const recoveryAmount =
        BASE_RECOVERY_RATE * sessionEIV * recoveryBias;

      newETV += recoveryAmount;
    }

    // -----------------------------
    // Clamp (safety rail)
    // -----------------------------
    newETV = Math.max(
      MASTER_CONSTANTS.etvBounds.min,
      Math.min(MASTER_CONSTANTS.etvBounds.max, newETV)
    );

    return Number(
      newETV.toFixed(MASTER_CONSTANTS.etvBounds.roundingDecimals)
    );
  }

  // ----------------------------------
  // Sessions-to-recover (unchanged)
  // ----------------------------------
  static sessionsToRecover(
    currentETV: number,
    targetETV: number
  ): number {
    if (currentETV >= targetETV) return 0;

    const avgRecoveryPerSession =
      MASTER_CONSTANTS.etvRecovery.avgRecoveryPerSession;
    return Math.ceil(
      (targetETV - currentETV) / avgRecoveryPerSession
    );
  }
}
