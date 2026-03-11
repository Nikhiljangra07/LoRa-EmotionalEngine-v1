// src/emotion-core/etv/types.ts

// ── Capability Bands ──────────────────────────────────────────────

export type ETVBand =
  | 'BAND_0' // Baseline Access
  | 'BAND_1' // Verified Interaction
  | 'BAND_2' // Stable Operator
  | 'BAND_3' // Reliable Context Use
  | 'BAND_4'; // High-Confidence Adaptation

// ── Session-level input ───────────────────────────────────────────

/**
 * V1 slim SessionSummary — uses only signals the codebase produces today.
 * Full blueprint adds correctionRate, contradictionRate, clarificationRate,
 * safetyTriggerRate, inferenceReliability once memory-layer detection
 * systems arrive.
 */
export type SessionSummaryV1 = {
  sessionId: string;
  userId: string;
  startedAt: number; // epoch ms
  endedAt: number; // epoch ms
  messageCount: number;

  eivMean: number; // 0..1
  eivMax: number; // 0..1

  aviMean: number; // 0..1
  aviMax: number; // 0..1

  hasViolation: boolean;
};

// ── Persisted state (JSON file per user) ──────────────────────────

export type ETVStateStored = {
  userId: string;
  r: number; // positive pseudo-count
  s: number; // negative pseudo-count
  lastSessionEndedAt: number; // epoch ms
  updatedAt: number; // epoch ms
};

// ── Full runtime state (stored + derived) ─────────────────────────

export type ETVStateDerived = ETVStateStored & {
  etvMean: number; // r / (r + s)
  etvVar: number; // Beta variance
  effectiveN: number; // r + s
};

// ── Runtime policy output ─────────────────────────────────────────

export type ETVPolicy = {
  etvMean: number;
  etvVar: number;
  band: ETVBand;

  maxInitiative: number; // 0..1
  maxDepth: number; // 0..1
  assertiveness: number; // 0..1
  personalizationStrength: number; // 0..1
  clarificationBias: number; // 0..1
  maxResponseTokens: number; // integer, 120..520
};

// ── Observability log ─────────────────────────────────────────────

export type ETVUpdateLog = {
  userId: string;
  sessionId: string;
  deltaHours: number;
  decay: number;
  z_t: number;
  evidenceMass: number;
  r_before: number;
  s_before: number;
  r_after: number;
  s_after: number;
  etvMean: number;
  etvVar: number;
  band: ETVBand;
  policy: ETVPolicy;
  timestamp: number;

  effectiveN: number;
  riskAdjusted: number;
  conf: number;
  messageCount: number;
  eivMean: number;
  aviMean: number;
};

// ── Config shape (for future per-user tuning) ─────────────────────

export type ETVConfig = {
  decayHalfLifeDays: number;
  decayFloor: number;
  epsilonFloor: number;
  evidenceMass: number;
  riskAversionK: number;
  varianceConfidenceScale: number;
  initR: number;
  initS: number;
};
