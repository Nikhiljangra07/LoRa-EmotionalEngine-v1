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

describe('Intervention pacingMode → pacingHint horizon safety', () => {
  test('pacingHint from intervention.pacingMode only activates after msg 3', async () => {
    const slowPolicy = makeAppraisalResult({});
    const withSlow = {
      ...slowPolicy,
      intervention: Object.freeze({
        ...(slowPolicy as any).intervention,
        pacingMode: 'SLOW',
      }),
    };
    const stepFn = jest.fn().mockReturnValue(Object.freeze(withSlow));

    const specs: StepSpec[] = [
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
    ];

    setAdaptiveOn();
    process.env.LORA_INTERVENTION_PACING_HINT = '1';
    const results = await runSequence(specs, { stepFn });

    // Messages 1-2 (index 0-1): no pacing markers (stability horizon)
    expect(results[0].prompt).not.toContain('[PACING_HINT:');
    expect(results[0].payload.pacingHint).toBeUndefined();
    expect(results[1].prompt).not.toContain('[PACING_HINT:');
    expect(results[1].payload.pacingHint).toBeUndefined();

    // Message 3 (index 2): pacingHint activates
    expect(results[2].prompt).toContain('[PACING_HINT:SLOW]');
    expect(results[2].payload.pacingHint).toBe('SLOW');
  });
});
