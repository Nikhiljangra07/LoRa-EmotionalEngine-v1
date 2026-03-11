// src/emotion-core/etv/evidenceScore.ts

import type { SessionSummaryV1 } from './types';
import { ETV_EVIDENCE_WEIGHTS, ETV_EIV_RISK } from './constants';

/**
 * V1 evidence score — 4-input z_t formula.
 *
 * z_t = clamp(stability - safetyPenalty - eivRiskPenalty, 0, 1)
 *
 * where:
 *   stability      = 1 - w1 * aviMean - w2 * aviMax
 *   safetyPenalty   = w3 * (hasViolation ? 1 : 0)
 *   eivRiskPenalty  = w4 * clamp((eivMean - T) / (1 - T), 0, 1)
 *
 * The eivRisk term prevents stable-high-intensity sessions (low AVI,
 * high EIV) from appearing "safe" and inflating trust.
 */
export function computeEvidenceScore(summary: SessionSummaryV1): number {
  const { aviMean, aviMax, eivMean, hasViolation } = summary;
  const w = ETV_EVIDENCE_WEIGHTS;

  const stability = 1 - w.aviMean * aviMean - w.aviMax * aviMax;
  const safetyPenalty = hasViolation ? w.violationPenalty : 0;

  const T = ETV_EIV_RISK.startThreshold;
  const eivRiskRaw = (eivMean - T) / (1 - T);
  const eivRiskPenalty = ETV_EIV_RISK.weight * Math.min(Math.max(eivRiskRaw, 0), 1);

  const raw = stability - safetyPenalty - eivRiskPenalty;

  if (!Number.isFinite(raw)) return 0.5;

  return Math.min(Math.max(raw, 0), 1);
}
