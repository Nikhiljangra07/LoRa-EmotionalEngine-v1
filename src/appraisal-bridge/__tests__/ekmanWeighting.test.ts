import { computeEkmanWeighting } from '../ekmanWeighting';

describe('computeEkmanWeighting', () => {
  test('returns not-applied when ekmanDominant is undefined', () => {
    const result = computeEkmanWeighting(undefined, undefined, {});
    expect(result.applied).toBe(false);
    expect(result.family).toBeNull();
  });

  test('returns not-applied when confidence is below threshold', () => {
    const result = computeEkmanWeighting('ANGER', 0.2, {});
    expect(result.applied).toBe(false);
  });

  test('SADNESS: raises validationIntensity', () => {
    const result = computeEkmanWeighting('SADNESS', 0.7, {
      validationIntensity: 'MEDIUM',
    });
    expect(result.applied).toBe(true);
    expect(result.modifiers.validationIntensity).toBe('HIGH');
  });

  test('SADNESS: softens HARD_STOP interrupt to FIRM', () => {
    const result = computeEkmanWeighting('SADNESS', 0.7, {
      interruptHint: 'HARD_STOP',
    });
    expect(result.modifiers.interruptHint).toBe('FIRM');
  });

  test('SADNESS: softens FIRM interrupt to SOFT', () => {
    const result = computeEkmanWeighting('SADNESS', 0.7, {
      interruptHint: 'FIRM',
    });
    expect(result.modifiers.interruptHint).toBe('SOFT');
  });

  test('ANGER: sets interruptHint to FIRM when none exists', () => {
    const result = computeEkmanWeighting('ANGER', 0.6, {});
    expect(result.applied).toBe(true);
    expect(result.modifiers.interruptHint).toBe('FIRM');
  });

  test('ANGER: reduces questionBudget', () => {
    const result = computeEkmanWeighting('ANGER', 0.6, {
      questionBudgetHint: 'ONE',
    });
    expect(result.modifiers.questionBudgetHint).toBe('ZERO');
  });

  test('FEAR: enforces SLOW pacing', () => {
    const result = computeEkmanWeighting('FEAR', 0.5, {});
    expect(result.applied).toBe(true);
    expect(result.modifiers.pacingHint).toBe('SLOW');
  });

  test('DISGUST: sets preferDirectness', () => {
    const result = computeEkmanWeighting('DISGUST', 0.5, {});
    expect(result.applied).toBe(true);
    expect(result.modifiers.preferDirectness).toBe(true);
  });

  test('JOY: sets preferEnergyMatch', () => {
    const result = computeEkmanWeighting('JOY', 0.5, {});
    expect(result.applied).toBe(true);
    expect(result.modifiers.preferEnergyMatch).toBe(true);
  });

  test('SURPRISE: returns not-applied (no modifiers)', () => {
    const result = computeEkmanWeighting('SURPRISE', 0.7, {});
    expect(result.applied).toBe(false);
  });
});
