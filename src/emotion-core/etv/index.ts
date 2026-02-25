// src/emotion-core/etv/index.ts — public exports

export type {
  ETVBand,
  SessionSummaryV1,
  ETVStateStored,
  ETVStateDerived,
  ETVPolicy,
  ETVUpdateLog,
  ETVConfig,
} from './types';

export {
  ETV_CONFIG,
  ETV_EVIDENCE_WEIGHTS,
  ETV_BAND_THRESHOLDS,
  ETV_POLICY_KNOBS,
  AVI_PARAMS,
  SHORT_SESSION,
  ETV_EIV_RISK,
  SESSION_GAP_MS,
} from './constants';

export { computeEvidenceScore } from './evidenceScore';
export { applyDecay, applyEvidence, computeDerived, toFullState } from './betaUpdate';
export { computePolicy, computeBand } from './policyMap';
export { ETVStorage } from './storage';
export { buildSessionSummary } from './sessionSummary';
export { ETVEngineV1 } from './engine';
