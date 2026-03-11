// src/emotion-core/etv/policyMap.ts

import type { ETVStateDerived, ETVBand, ETVPolicy } from './types';
import { ETV_CONFIG, ETV_BAND_THRESHOLDS, ETV_POLICY_KNOBS } from './constants';
import { assertPolicyValid } from './invariants';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ── Band computation ──────────────────────────────────────────────

export function computeBand(riskAdjusted: number): ETVBand {
  if (riskAdjusted < ETV_BAND_THRESHOLDS.band1Min) return 'BAND_0';
  if (riskAdjusted < ETV_BAND_THRESHOLDS.band2Min) return 'BAND_1';
  if (riskAdjusted < ETV_BAND_THRESHOLDS.band3Min) return 'BAND_2';
  if (riskAdjusted < ETV_BAND_THRESHOLDS.band4Min) return 'BAND_3';
  return 'BAND_4';
}

// ── Derived scalars (shared with engine for logging) ─────────────

export function computeRiskAdjusted(state: ETVStateDerived): number {
  return clamp(state.etvMean - ETV_CONFIG.riskAversionK * Math.sqrt(state.etvVar), 0, 1);
}

export function computeConf(state: ETVStateDerived): number {
  return clamp(1 - Math.sqrt(state.etvVar) * ETV_CONFIG.varianceConfidenceScale, 0, 1);
}

// ── Full policy computation ───────────────────────────────────────

export function computePolicy(state: ETVStateDerived): ETVPolicy {
  const K = ETV_CONFIG.riskAversionK;
  const C = ETV_CONFIG.varianceConfidenceScale;

  const riskAdjusted = state.etvMean - K * Math.sqrt(state.etvVar);
  const p = clamp(riskAdjusted, 0, 1);
  const conf = clamp(1 - Math.sqrt(state.etvVar) * C, 0, 1);
  assertPolicyValid(p, conf);

  const k = ETV_POLICY_KNOBS;

  return {
    etvMean: state.etvMean,
    etvVar: state.etvVar,
    band: computeBand(riskAdjusted),
    maxInitiative: clamp(k.initiative.floor + k.initiative.slope * p, 0, 1),
    maxDepth: clamp(k.depth.floor + k.depth.slope * p, 0, 1),
    assertiveness: clamp(k.assertiveness.floor + k.assertiveness.slope * p * conf, 0, 1),
    personalizationStrength: clamp(k.personalization.floor + k.personalization.slope * p * conf, 0, 1),
    clarificationBias: clamp(k.clarification.ceiling - k.clarification.slope * p * conf, 0, 1),
    maxResponseTokens: Math.round(k.tokens.floor + k.tokens.slope * p),
  };
}
