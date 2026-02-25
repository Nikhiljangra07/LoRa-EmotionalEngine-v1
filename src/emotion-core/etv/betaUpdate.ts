// src/emotion-core/etv/betaUpdate.ts

import type { ETVStateStored, ETVStateDerived } from './types';
import { ETV_CONFIG } from './constants';

// ── Derived quantities ────────────────────────────────────────────

export function computeDerived(r: number, s: number): {
  etvMean: number;
  etvVar: number;
  effectiveN: number;
} {
  const n = r + s;
  return {
    etvMean: r / n,
    etvVar: (r * s) / (n * n * (n + 1)),
    effectiveN: n,
  };
}

// ── Temporal decay ────────────────────────────────────────────────

/**
 * Apply half-life decay to pseudo-counts.
 *
 * decay = max(2^(-Δt / H), decayFloor)
 *
 * After decay, both r and s are floored at epsilon to keep the
 * Beta distribution valid (r > 0, s > 0).
 *
 * @param deltaHours Elapsed time since last session end, in hours.
 *                   Clamped to >= 0 (handles clock skew).
 */
export function applyDecay(
  state: ETVStateStored,
  deltaHours: number,
): { state: ETVStateStored; decay: number } {
  const dt = Math.max(deltaHours, 0);
  const deltaDays = dt / 24;

  const rawDecay = Math.pow(2, -deltaDays / ETV_CONFIG.decayHalfLifeDays);
  const decay = Math.max(rawDecay, ETV_CONFIG.decayFloor);

  const r = Math.max(state.r * decay, ETV_CONFIG.epsilonFloor);
  const s = Math.max(state.s * decay, ETV_CONFIG.epsilonFloor);

  return {
    state: { ...state, r, s },
    decay,
  };
}

// ── Evidence update ───────────────────────────────────────────────

/**
 * Accumulate session evidence into pseudo-counts.
 *
 * r += M * z_t
 * s += M * (1 - z_t)
 *
 * @param z_t  Session evidence score in [0, 1].
 * @param mass Evidence mass (V1: constant 1.0).
 */
export function applyEvidence(
  state: ETVStateStored,
  z_t: number,
  mass: number = ETV_CONFIG.evidenceMass,
): ETVStateStored {
  return {
    ...state,
    r: state.r + mass * z_t,
    s: state.s + mass * (1 - z_t),
  };
}

// ── Full derive helper ────────────────────────────────────────────

export function toFullState(stored: ETVStateStored): ETVStateDerived {
  const derived = computeDerived(stored.r, stored.s);
  return { ...stored, ...derived };
}
