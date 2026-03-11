/**
 * Reliability gating layer for posterior distributions.
 *
 * Thin, isolated wrapper that examines a posterior and decides whether
 * the model's prediction is confident enough to commit, needs hedging,
 * or is effectively uninformative.
 *
 * No learning, no calibration, no weighting.
 * Depends only on the posterior object — fully removable without
 * breaking any inference code.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

// ============================================================
// Types
// ============================================================

export type GatingDecision = "COMMIT" | "HEDGE" | "NEUTRAL";

export interface ReliabilityResult {
  pmax: number;
  margin: number;
  entropy: number;
  entropyNorm: number;
  decision: GatingDecision;
}

// ============================================================
// Thresholds
// ============================================================

const PMAX_COMMIT = 0.60;
const MARGIN_COMMIT = 0.15;
const ENTROPY_HEDGE = 0.80;

// ============================================================
// Core
// ============================================================

/**
 * Evaluate a posterior distribution and return a gating decision.
 *
 * @param posterior - Map of class label → probability (must sum to ~1).
 */
export function applyReliabilityGate(
  posterior: Record<string, number>,
): ReliabilityResult {
  const probs = Object.values(posterior);
  const K = probs.length;

  // Sort descending to extract p1 (max) and p2 (second)
  const sorted = probs.slice().sort((a, b) => b - a);
  const pmax = sorted[0] ?? 0;
  const p2 = sorted[1] ?? 0;
  const margin = pmax - p2;

  // Shannon entropy: H = -Σ p_i * log(p_i)
  // Convention: 0 * log(0) = 0
  let H = 0;
  for (const p of probs) {
    if (p > 0) {
      H -= p * Math.log(p);
    }
  }

  const Hmax = K > 1 ? Math.log(K) : 1;
  const entropyNorm = H / Hmax;

  // Decision policy
  let decision: GatingDecision;
  if (pmax >= PMAX_COMMIT && margin >= MARGIN_COMMIT && entropyNorm < ENTROPY_HEDGE) {
    decision = "COMMIT";
  } else if (entropyNorm >= ENTROPY_HEDGE) {
    decision = "NEUTRAL";
  } else {
    decision = "HEDGE";
  }

  return { pmax, margin, entropy: H, entropyNorm, decision };
}
