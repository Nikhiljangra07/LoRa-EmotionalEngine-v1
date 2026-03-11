// src/emotion-core/etv/constants.ts

import type { ETVConfig } from './types';

// ── Core model parameters ─────────────────────────────────────────

export const ETV_CONFIG: Readonly<ETVConfig> = Object.freeze({
  decayHalfLifeDays: 14,
  decayFloor: 0.01,
  epsilonFloor: 0.01,
  evidenceMass: 1.0,
  riskAversionK: 1.5,
  varianceConfidenceScale: 4.0,
  initR: 1.5,
  initS: 2.5,
});

// ── V1 slim evidence-score weights (3-input z_t formula) ──────────

export const ETV_EVIDENCE_WEIGHTS = Object.freeze({
  aviMean: 0.40,
  aviMax: 0.25,
  violationPenalty: 0.30,
});

// ── Band thresholds (on risk-adjusted mean) ───────────────────────

export const ETV_BAND_THRESHOLDS = Object.freeze({
  band1Min: 0.25,
  band2Min: 0.40,
  band3Min: 0.55,
  band4Min: 0.70,
});

// ── Policy knob coefficients ──────────────────────────────────────

export const ETV_POLICY_KNOBS = Object.freeze({
  initiative: { floor: 0.15, slope: 0.70 },
  depth: { floor: 0.20, slope: 0.70 },
  assertiveness: { floor: 0.10, slope: 0.60 },
  personalization: { floor: 0.10, slope: 0.80 },
  clarification: { ceiling: 0.70, slope: 0.60 },
  tokens: { floor: 120, slope: 400 },
});

// ── AVI (Appraisal Volatility Index) parameters ──────────────────

export const AVI_PARAMS = Object.freeze({
  windowSize: 8,
  saturation: 0.5,
  minMessages: 2,
});

// ── Short-session bias correction ────────────────────────────────

export const SHORT_SESSION = Object.freeze({
  minMessages: 4,
  reducedMass: 0.25,
});

// ── EIV-risk penalty (stable-high-intensity safety net) ──────────

export const ETV_EIV_RISK = Object.freeze({
  weight: 0.20,
  startThreshold: 0.70,
});

// ── Session boundary ──────────────────────────────────────────────

export const SESSION_GAP_MS = 35 * 60 * 1000; // 35 minutes
