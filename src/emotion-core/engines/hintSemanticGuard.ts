/**
 * Pure, deterministic semantic coherence guard for hints.
 *
 * Enforces cross-hint consistency rules after the resolver and
 * stickiness passes. Never introduces new hints — only removes
 * or downgrades to eliminate contradictions.
 *
 * Rules are applied in a fixed, deterministic order.
 */

import type { ResolvableHints } from './hintResolver';

export function enforceHintSemanticCoherence(
  hints: ResolvableHints,
): ResolvableHints {
  const out: ResolvableHints = { ...hints };

  // RULE 1 — Interrupt Dominance
  if (out.interruptHint !== undefined) {
    if (out.questionBudgetHint !== undefined) {
      out.questionBudgetHint = 'ZERO';
    }
    out.stepHint = undefined;
  }

  // RULE 2 — STABILIZE Consistency
  if (out.guidanceMode === 'STABILIZE') {
    if (out.toneHint === 'FIRM') {
      out.toneHint = undefined;
    }
    if (out.questionBudgetHint !== undefined) {
      out.questionBudgetHint = 'ZERO';
    }
    out.stepHint = undefined;
  }

  // RULE 3 — DE_ESCALATE Consistency
  if (out.guidanceMode === 'DE_ESCALATE') {
    if (out.toneHint === 'FIRM') {
      out.toneHint = undefined;
    }
    if (out.interruptHint === 'HARD_STOP') {
      out.interruptHint = undefined;
    }
  }

  // RULE 4 — Slow Pacing Suppresses Action Density
  if (out.pacingHint === 'SLOW') {
    out.stepHint = undefined;
  }

  // RULE 5 — Validation High + Firm Conflict
  if (out.validationIntensity === 'HIGH' && out.toneHint === 'FIRM') {
    out.toneHint = 'GENTLE';
  }

  // RULE 6 — Action vs Question Conflict
  if (out.actionHint === 'SUGGEST_BREAK') {
    if (out.questionBudgetHint !== undefined) {
      out.questionBudgetHint = 'ZERO';
    }
  }

  return out;
}
