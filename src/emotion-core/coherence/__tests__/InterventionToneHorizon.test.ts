export {};

import {
  makeAppraisalResult,
  setAdaptiveOn,
  saveEnv,
  restoreEnv,
  runSequence,
  type StepSpec,
} from './coherenceHarness';

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

const LOW_NEUTRAL = {
  dominant: 'NEUTRAL' as const,
  arousal: 'LOW' as const,
  valence: 'NEUTRAL' as const,
  confidence: 0.5,
};

describe('Intervention toneMode → toneHint horizon safety', () => {
  test('toneHint from intervention.toneMode only activates after msg 3 (GENTLE)', async () => {
    const base = makeAppraisalResult({});
    const withGentleTone = Object.freeze({
      ...base,
      intervention: Object.freeze({
        ...(base as any).intervention,
        toneMode: 'REFLECTIVE',
      }),
    });
    const stepFn = jest.fn().mockReturnValue(withGentleTone);

    const specs: StepSpec[] = [
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
    ];

    setAdaptiveOn();
    process.env.LORA_INTERVENTION_TONE_HINT = '1';
    const results = await runSequence(specs, { stepFn });

    expect(results[0].prompt).not.toContain('[TONE_HINT:');
    expect(results[0].payload.toneHint).toBeUndefined();
    expect(results[1].prompt).not.toContain('[TONE_HINT:');
    expect(results[1].payload.toneHint).toBeUndefined();

    expect(results[2].prompt).toContain('[TONE_HINT:GENTLE]');
    expect(results[2].payload.toneHint).toBe('GENTLE');
  });

  test('toneHint from intervention.toneMode only activates after msg 3 (FIRM)', async () => {
    const base = makeAppraisalResult({});
    const withFirmTone = Object.freeze({
      ...base,
      intervention: Object.freeze({
        ...(base as any).intervention,
        toneMode: 'FIRM_CONTAIN',
      }),
    });
    const stepFn = jest.fn().mockReturnValue(withFirmTone);

    const specs: StepSpec[] = [
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
    ];

    setAdaptiveOn();
    process.env.LORA_INTERVENTION_TONE_HINT = '1';
    const results = await runSequence(specs, { stepFn });

    expect(results[0].prompt).not.toContain('[TONE_HINT:');
    expect(results[1].prompt).not.toContain('[TONE_HINT:');

    expect(results[2].prompt).toContain('[TONE_HINT:FIRM]');
    expect(results[2].payload.toneHint).toBe('FIRM');
  });
});
