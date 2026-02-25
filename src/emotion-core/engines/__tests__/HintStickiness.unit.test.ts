import { applyHintStickiness, type StickyHints, type StickyHintKey } from '../hintStickiness';

const HOLD_CONFIG: Partial<Record<StickyHintKey, number>> = {
  pacingHint: 2,
  questionBudgetHint: 2,
  interruptHint: 2,
  toneHint: 1,
  validationHint: 1,
  actionHint: 1,
  validationIntensity: 1,
  stepHint: 0,
};

describe('applyHintStickiness — pure unit tests', () => {
  test('active hint sets hold counter to configured value', () => {
    const { final, holdsRemainingNext } = applyHintStickiness({
      resolved: { pacingHint: 'SLOW' },
      previous: {},
      holdsRemaining: {},
      holdConfig: HOLD_CONFIG,
    });

    expect(final.pacingHint).toBe('SLOW');
    expect(holdsRemainingNext.pacingHint).toBe(2);
  });

  test('previous hint persists during countdown', () => {
    const { final, holdsRemainingNext } = applyHintStickiness({
      resolved: {},
      previous: { pacingHint: 'SLOW' },
      holdsRemaining: { pacingHint: 2 },
      holdConfig: HOLD_CONFIG,
    });

    expect(final.pacingHint).toBe('SLOW');
    expect(holdsRemainingNext.pacingHint).toBe(1);
  });

  test('countdown decrements to zero then hint disappears', () => {
    // Hold at 1 → decrement to 0, still sticky
    const step1 = applyHintStickiness({
      resolved: {},
      previous: { toneHint: 'GENTLE' },
      holdsRemaining: { toneHint: 1 },
      holdConfig: HOLD_CONFIG,
    });
    expect(step1.final.toneHint).toBe('GENTLE');
    expect(step1.holdsRemainingNext.toneHint).toBe(0);

    // Hold at 0, previous exists but no hold → gone
    const step2 = applyHintStickiness({
      resolved: {},
      previous: step1.final,
      holdsRemaining: step1.holdsRemainingNext,
      holdConfig: HOLD_CONFIG,
    });
    expect(step2.final.toneHint).toBeUndefined();
    expect(step2.holdsRemainingNext.toneHint).toBeUndefined();
  });

  test('resolved value overrides previous and resets hold counter', () => {
    const { final, holdsRemainingNext } = applyHintStickiness({
      resolved: { toneHint: 'FIRM' },
      previous: { toneHint: 'GENTLE' },
      holdsRemaining: { toneHint: 0 },
      holdConfig: HOLD_CONFIG,
    });

    expect(final.toneHint).toBe('FIRM');
    expect(holdsRemainingNext.toneHint).toBe(1);
  });

  test('no invention: undefined in + no previous = undefined out', () => {
    const { final } = applyHintStickiness({
      resolved: {},
      previous: {},
      holdsRemaining: {},
      holdConfig: HOLD_CONFIG,
    });

    expect(final.pacingHint).toBeUndefined();
    expect(final.toneHint).toBeUndefined();
    expect(final.interruptHint).toBeUndefined();
    expect(final.questionBudgetHint).toBeUndefined();
    expect(final.validationHint).toBeUndefined();
    expect(final.actionHint).toBeUndefined();
    expect(final.validationIntensity).toBeUndefined();
    expect(final.stepHint).toBeUndefined();
  });

  test('stepHint with holdConfig 0 never sticks', () => {
    // Step 1: stepHint active → hold set to 0
    const step1 = applyHintStickiness({
      resolved: { stepHint: 'ONE_STEP' },
      previous: {},
      holdsRemaining: {},
      holdConfig: HOLD_CONFIG,
    });
    expect(step1.final.stepHint).toBe('ONE_STEP');
    expect(step1.holdsRemainingNext.stepHint).toBe(0);

    // Step 2: resolved gone, hold is 0 → disappears immediately
    const step2 = applyHintStickiness({
      resolved: {},
      previous: step1.final,
      holdsRemaining: step1.holdsRemainingNext,
      holdConfig: HOLD_CONFIG,
    });
    expect(step2.final.stepHint).toBeUndefined();
  });

  test('multiple hints operate independently', () => {
    const { final, holdsRemainingNext } = applyHintStickiness({
      resolved: { pacingHint: 'SLOW', interruptHint: 'FIRM' },
      previous: { toneHint: 'GENTLE', validationHint: 'STRONG' },
      holdsRemaining: { toneHint: 1, validationHint: 0 },
      holdConfig: HOLD_CONFIG,
    });

    expect(final.pacingHint).toBe('SLOW');
    expect(final.interruptHint).toBe('FIRM');
    expect(final.toneHint).toBe('GENTLE');
    expect(final.validationHint).toBeUndefined();
    expect(holdsRemainingNext.pacingHint).toBe(2);
    expect(holdsRemainingNext.interruptHint).toBe(2);
    expect(holdsRemainingNext.toneHint).toBe(0);
    expect(holdsRemainingNext.validationHint).toBeUndefined();
  });

  test('previous hint with no hold remaining does not persist', () => {
    const { final } = applyHintStickiness({
      resolved: {},
      previous: { actionHint: 'ENCOURAGE_BREATH' },
      holdsRemaining: { actionHint: 0 },
      holdConfig: HOLD_CONFIG,
    });
    expect(final.actionHint).toBeUndefined();
  });
});
