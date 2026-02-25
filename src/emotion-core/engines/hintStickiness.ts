/**
 * Pure hint hysteresis / stickiness layer.
 *
 * When a hint becomes active it "sticks" for a configurable number
 * of messages after the upstream signal drops away, reducing
 * oscillation without inventing new values.
 */

export type StickyHintKey =
  | 'pacingHint'
  | 'questionBudgetHint'
  | 'toneHint'
  | 'validationHint'
  | 'actionHint'
  | 'interruptHint'
  | 'stepHint'
  | 'validationIntensity';

export type StickyHints = Partial<Record<StickyHintKey, string>>;

const STICKY_KEYS: StickyHintKey[] = [
  'pacingHint',
  'questionBudgetHint',
  'toneHint',
  'validationHint',
  'actionHint',
  'interruptHint',
  'stepHint',
  'validationIntensity',
];

export interface StickinessInput {
  resolved: StickyHints;
  previous: StickyHints;
  holdsRemaining: Partial<Record<StickyHintKey, number>>;
  holdConfig: Partial<Record<StickyHintKey, number>>;
}

export interface StickinessOutput {
  final: StickyHints;
  holdsRemainingNext: Partial<Record<StickyHintKey, number>>;
}

export function applyHintStickiness(input: StickinessInput): StickinessOutput {
  const { resolved, previous, holdsRemaining, holdConfig } = input;
  const final: StickyHints = {};
  const holdsRemainingNext: Partial<Record<StickyHintKey, number>> = {};

  for (const key of STICKY_KEYS) {
    const resolvedVal = resolved[key];
    const prevVal = previous[key];
    const remaining = holdsRemaining[key] ?? 0;
    const configured = holdConfig[key] ?? 0;

    if (resolvedVal !== undefined) {
      final[key] = resolvedVal;
      holdsRemainingNext[key] = configured;
    } else if (remaining > 0 && prevVal !== undefined) {
      final[key] = prevVal;
      holdsRemainingNext[key] = remaining - 1;
    }
    // else: key stays absent in final (undefined), no hold entry
  }

  return { final, holdsRemainingNext };
}
