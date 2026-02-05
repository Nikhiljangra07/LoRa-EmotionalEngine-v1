/**
 * Momentum constants (v1 runtime-only)
 *
 * These control session-local emotional inertia.
 * They do NOT affect detection or scoring.
 *
 * Governance:
 * - Centralized for audit
 * - Explicitly NOT empirically calibrated yet
 */
export const MOMENTUM_CONSTANTS = {
  DECAY: 0.85,
  GAIN: 0.15,

  CONFIDENCE_FLOOR: 0.4,
  HARD_BREAK_THRESHOLD: 0.75,

  guidanceBias: {
    confidenceMinExclusive: 0.5,
    arousalHighMinExclusive: 0.6,
    valenceNegativeMaxExclusive: -0.4,
  },
} as const;
