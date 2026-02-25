// src/emotion-core/etv/evidenceScore.ts

import type { SessionSummaryV1 } from './types';
import { ETV_EVIDENCE_WEIGHTS } from './constants';

/**
 * V1 slim evidence score — 3-input z_t formula.
 *
 * z_t = clamp(stability - safetyPenalty, 0, 1)
 *
 * where:
 *   stability    = 1 - w1 * aviMean - w2 * aviMax
 *   safetyPenalty = w3 * (hasViolation ? 1 : 0)
 *
 * Will expand when correction/contradiction detection and memory-layer
 * pattern extraction arrive.
 */
export function computeEvidenceScore(summary: SessionSummaryV1): number {
  const { aviMean, aviMax, hasViolation } = summary;
  const w = ETV_EVIDENCE_WEIGHTS;

  const stability = 1 - w.aviMean * aviMean - w.aviMax * aviMax;
  const penalty = hasViolation ? w.violationPenalty : 0;

  const raw = stability - penalty;

  if (!Number.isFinite(raw)) return 0.5;

  return Math.min(Math.max(raw, 0), 1);
}
