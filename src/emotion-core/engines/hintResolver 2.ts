/**
 * Pure, deterministic hint resolver.
 *
 * Trims excessive overlay stacking by enforcing safety invariants
 * and a hard cap on concurrent active hints. Never introduces new
 * hint values — only drops or suppresses.
 */

export interface ResolvableHints {
  guidanceMode?: string;
  pacingHint?: string;
  toneHint?: string;
  validationIntensity?: string;
  validationHint?: string;
  actionHint?: string;
  interruptHint?: string;
  stepHint?: string;
  questionBudgetHint?: string;
}

export interface ResolvedHints extends ResolvableHints {}

const MAX_ACTIVE_HINTS = 5;

type HintKey = Exclude<keyof ResolvableHints, 'guidanceMode'>;

const PRIORITY_ORDER: HintKey[] = [
  'interruptHint',
  'questionBudgetHint',
  'pacingHint',
  'toneHint',
  'validationHint',
  'actionHint',
  'validationIntensity',
  'stepHint',
];

export function resolveHints(input: ResolvableHints): ResolvedHints {
  const out: ResolvedHints = { ...input };

  // A) STABILIZE safety
  if (out.guidanceMode === 'STABILIZE') {
    out.stepHint = undefined;
    if (out.questionBudgetHint !== undefined) {
      out.questionBudgetHint = 'ZERO';
    }
  }

  // B) Interrupt dominance
  if (out.interruptHint !== undefined) {
    out.stepHint = undefined;
    if (out.questionBudgetHint !== undefined && out.questionBudgetHint !== 'ZERO') {
      out.questionBudgetHint = 'ZERO';
    }
  }

  // C) Slow pacing suppresses stepHint
  if (out.pacingHint === 'SLOW') {
    out.stepHint = undefined;
  }

  // D) Hard overlay cap — drop lowest-priority hints until <= MAX_ACTIVE_HINTS
  const activeKeys = PRIORITY_ORDER.filter((k) => out[k] !== undefined);
  if (activeKeys.length > MAX_ACTIVE_HINTS) {
    const toDrop = activeKeys.slice(MAX_ACTIVE_HINTS);
    for (const key of toDrop) {
      out[key] = undefined;
    }
  }

  return out;
}
