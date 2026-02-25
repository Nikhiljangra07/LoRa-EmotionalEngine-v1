export {};

/**
 * PHASE 5 — Pipeline Integrity Audit
 *
 * Proves the hint pipeline stages (resolve → stickiness → resolve → guard)
 * maintain invariants: density cap, present-or-absent contract, and
 * guard never inflates hint count.
 */

import { resolveHints, type ResolvableHints } from '../../engines/hintResolver';
import { applyHintStickiness, type StickyHints } from '../../engines/hintStickiness';
import { enforceHintSemanticCoherence } from '../../engines/hintSemanticGuard';

function countActive(hints: ResolvableHints): number {
  let n = 0;
  if (hints.pacingHint) n++;
  if (hints.toneHint) n++;
  if (hints.validationIntensity) n++;
  if (hints.validationHint) n++;
  if (hints.actionHint) n++;
  if (hints.interruptHint) n++;
  if (hints.stepHint) n++;
  if (hints.questionBudgetHint) n++;
  return n;
}

const HINT_KEYS: (keyof ResolvableHints)[] = [
  'pacingHint', 'toneHint', 'validationIntensity', 'validationHint',
  'actionHint', 'interruptHint', 'stepHint', 'questionBudgetHint',
];

describe('Phase 5 — Pipeline Order Audit', () => {
  describe('resolveHints — density cap', () => {
    test('caps active hints to ≤ 5', () => {
      const input: ResolvableHints = {
        guidanceMode: 'ENERGY_MATCH',
        pacingHint: 'SLOW',
        toneHint: 'GENTLE',
        validationIntensity: 'HIGH',
        validationHint: 'STRONG',
        actionHint: 'OFFER_STEPS',
        interruptHint: 'FIRM',
        stepHint: 'ONE_STEP',
        questionBudgetHint: 'ONE',
      };
      const resolved = resolveHints(input);
      expect(countActive(resolved)).toBeLessThanOrEqual(5);
    });

    test('STABILIZE drops stepHint and forces questionBudget ZERO', () => {
      const input: ResolvableHints = {
        guidanceMode: 'STABILIZE',
        stepHint: 'ONE_STEP',
        questionBudgetHint: 'ONE',
        pacingHint: 'SLOW',
      };
      const resolved = resolveHints(input);
      expect(resolved.stepHint).toBeUndefined();
      expect(resolved.questionBudgetHint).toBe('ZERO');
    });
  });

  describe('applyHintStickiness — hysteresis', () => {
    test('holds previous hint when resolved drops it', () => {
      const { final, holdsRemainingNext } = applyHintStickiness({
        resolved: {},
        previous: { pacingHint: 'SLOW' },
        holdsRemaining: { pacingHint: 2 },
        holdConfig: { pacingHint: 2 },
      });
      expect(final.pacingHint).toBe('SLOW');
      expect(holdsRemainingNext.pacingHint).toBe(1);
    });

    test('does not invent new hints', () => {
      const { final } = applyHintStickiness({
        resolved: {},
        previous: {},
        holdsRemaining: {},
        holdConfig: { pacingHint: 2, toneHint: 1 },
      });
      expect(final.pacingHint).toBeUndefined();
      expect(final.toneHint).toBeUndefined();
    });
  });

  describe('enforceHintSemanticCoherence — guard', () => {
    test('never increases hint count', () => {
      const scenarios: ResolvableHints[] = [
        { guidanceMode: 'STABILIZE', toneHint: 'FIRM', interruptHint: 'HARD_STOP', stepHint: 'ONE_STEP', questionBudgetHint: 'ONE' },
        { guidanceMode: 'DE_ESCALATE', toneHint: 'FIRM', interruptHint: 'HARD_STOP' },
        { pacingHint: 'SLOW', stepHint: 'TWO_STEPS', actionHint: 'SUGGEST_BREAK', questionBudgetHint: 'ONE' },
        { validationIntensity: 'HIGH', toneHint: 'FIRM' },
        { interruptHint: 'FIRM', questionBudgetHint: 'ONE', stepHint: 'ONE_STEP' },
      ];

      for (const input of scenarios) {
        const before = countActive(input);
        const after = countActive(enforceHintSemanticCoherence(input));
        expect(after).toBeLessThanOrEqual(before);
      }
    });

    test('STABILIZE + HARD_STOP downgrades to FIRM', () => {
      const result = enforceHintSemanticCoherence({
        guidanceMode: 'STABILIZE',
        interruptHint: 'HARD_STOP',
      });
      expect(result.interruptHint).toBe('FIRM');
    });
  });

  describe('full pipeline: resolve → stickiness → resolve → guard', () => {
    test('end-to-end density ≤ 5', () => {
      const raw: ResolvableHints = {
        guidanceMode: 'DE_ESCALATE',
        pacingHint: 'SLOW',
        toneHint: 'GENTLE',
        validationIntensity: 'HIGH',
        validationHint: 'STRONG',
        actionHint: 'SUGGEST_BREAK',
        interruptHint: 'FIRM',
        stepHint: 'ONE_STEP',
        questionBudgetHint: 'ONE',
      };

      let current = resolveHints(raw);

      const sticky = applyHintStickiness({
        resolved: current,
        previous: { pacingHint: 'SLOW', toneHint: 'GENTLE', interruptHint: 'FIRM' },
        holdsRemaining: { pacingHint: 1, toneHint: 1, interruptHint: 1 },
        holdConfig: { pacingHint: 2, toneHint: 1, interruptHint: 2 },
      });
      current = { ...current, ...sticky.final };

      current = resolveHints(current);
      current = enforceHintSemanticCoherence(current);

      expect(countActive(current)).toBeLessThanOrEqual(5);
    });

    test('present-or-absent contract: no hint has falsy string value', () => {
      const raw: ResolvableHints = {
        guidanceMode: 'STABILIZE',
        pacingHint: 'SLOW',
        toneHint: 'FIRM',
        interruptHint: 'HARD_STOP',
        questionBudgetHint: 'ONE',
      };

      let current = resolveHints(raw);
      current = resolveHints(current);
      current = enforceHintSemanticCoherence(current);

      for (const key of HINT_KEYS) {
        const val = current[key];
        if (val !== undefined) {
          expect(typeof val).toBe('string');
          expect(val.length).toBeGreaterThan(0);
          expect(val).not.toBe('NONE');
          expect(val).not.toBe('NORMAL');
          expect(val).not.toBe('NEUTRAL');
          expect(val).not.toBe('false');
        }
      }
    });
  });
});
