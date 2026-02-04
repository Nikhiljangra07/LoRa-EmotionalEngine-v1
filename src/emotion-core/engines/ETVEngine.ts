// src/emotion-core/engines/ETVEngine.ts

import { MASTER_CONSTANTS } from "../config/master.constants";

export class ETVEngine {
  static updateETV(
    currentETV: number,
    sessionEIV: number,
    hasViolation: boolean
  ): number {
    const BASE_RECOVERY_RATE =
      MASTER_CONSTANTS.etv.recovery.baseRate; // conservative
    const VIOLATION_PENALTY =
      MASTER_CONSTANTS.etv.recovery.violationPenalty;

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
        MASTER_CONSTANTS.etv.recovery.minSessionEivForRecovery
    ) {
      const recoveryBias =
        sessionEIV >=
        MASTER_CONSTANTS.etv.recovery.bias.highMinInclusive
          ? MASTER_CONSTANTS.etv.recovery.bias.high
          : sessionEIV >=
            MASTER_CONSTANTS.etv.recovery.bias.midMinInclusive
          ? MASTER_CONSTANTS.etv.recovery.bias.mid
          : MASTER_CONSTANTS.etv.recovery.bias.low;

      const recoveryAmount =
        BASE_RECOVERY_RATE * sessionEIV * recoveryBias;

      newETV += recoveryAmount;
    }

    // -----------------------------
    // Clamp (safety rail)
    // -----------------------------
    newETV = Math.max(
      MASTER_CONSTANTS.etv.bounds.min,
      Math.min(MASTER_CONSTANTS.etv.bounds.max, newETV)
    );

    return Number(
      newETV.toFixed(MASTER_CONSTANTS.etv.bounds.roundingDecimals)
    );
  }

  // ----------------------------------
  // Sessions-to-recover (unchanged)
  // ----------------------------------
  static sessionsToRecover(
    currentETV: number,
    targetETV: number
  ): number {
    if (currentETV >= targetETV) {
      return MASTER_CONSTANTS.etv.bounds.min;
    }

    const avgRecoveryPerSession =
      MASTER_CONSTANTS.etv.recovery.avgRecoveryPerSession;
    return Math.ceil(
      (targetETV - currentETV) / avgRecoveryPerSession
    );
  }
}
