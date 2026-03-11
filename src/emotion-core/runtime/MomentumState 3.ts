/**
 * MomentumState
 * --------------
 * Session-local emotional inertia buffer.
 *
 * Purpose:
 * - Preserve emotional continuity across turns
 * - Bias prompt interpretation (NOT detection or scoring)
 *
 * Explicit constraints:
 * - Runtime-only (no persistence)
 * - No history storage
 * - No timing assumptions
 * - No effect on EIV math
 *
 * This is NOT memory.
 * This is NOT escalation.
 */
export interface MomentumState {
  /** Valence carryover bias [-1, 1] */
  valenceBias: number;

  /** Arousal carryover bias [0, 1] */
  arousalBias: number;

  /** Confidence that momentum is meaningful [0, 1] */
  confidence: number;
}

export const INITIAL_MOMENTUM_STATE: MomentumState = {
  valenceBias: 0,
  arousalBias: 0,
  confidence: 0,
};
