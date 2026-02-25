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

const HIGH_POSITIVE = {
  dominant: 'JOY' as const,
  arousal: 'HIGH' as const,
  valence: 'POSITIVE' as const,
  confidence: 0.9,
};

// ── EIV high + pressure low ─────────────────────────────────────────

describe('EIV high + pressure low → pacingHint must NOT trigger from EIV alone', () => {
  test('validationIntensity activates but pacingHint stays absent', async () => {
    const warmUp: StepSpec[] = [
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
    ];

    // High arousal drives validationIntensity HIGH (arousal=HIGH).
    // Low pressure/escalation/collapse ensures pacingHint stays absent.
    const highEivLowPressure: StepSpec[] = Array.from({ length: 20 }, () => ({
      text: 'I am so so excited about this!!!',
      appraisalOverrides: { pressureScalar: 0.2, pressureVolatility: 0.05 },
      emotionalOverride: HIGH_POSITIVE,
    }));

    const specs = [...warmUp, ...highEivLowPressure];

    setAdaptiveOn();
    const stepFn = jest.fn().mockReturnValue(
      makeAppraisalResult({ pressureScalar: 0.2, pressureVolatility: 0.05 }),
    );
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);

    // pacingHint must NOT appear (no collapse, no escalation, no high pressure)
    for (const step of active) {
      expect(step.payload.pacingHint).toBeUndefined();
    }

    // validationIntensity should appear (HIGH arousal)
    const viSteps = active.filter((s) => s.payload.validationIntensity !== undefined);
    expect(viSteps.length).toBeGreaterThanOrEqual(1);
    for (const step of viSteps) {
      expect(step.payload.validationIntensity).toBe('HIGH');
    }
  });
});

// ── Pressure high + EIV medium → pacingHint triggers, validationIntensity may be absent ──

describe('Pressure high + EIV medium → pacingHint triggers independently', () => {
  test('pacingHint SLOW fires but validationIntensity stays absent for LOW arousal', async () => {
    const warmUp: StepSpec[] = [
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
    ];

    // LOW arousal + LOW EIV → no validationIntensity
    // High pressure → pacingHint SLOW
    const highPressureLowEiv: StepSpec[] = Array.from({ length: 20 }, () => ({
      text: 'okay',
      appraisalOverrides: { pressureScalar: 3.0, pressureVolatility: 1.5 },
      emotionalOverride: LOW_NEUTRAL,
    }));

    const specs = [...warmUp, ...highPressureLowEiv];

    setAdaptiveOn();
    const stepFn = jest.fn().mockReturnValue(
      makeAppraisalResult({ pressureScalar: 3.0, pressureVolatility: 1.5 }),
    );
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);

    // pacingHint SLOW should appear (high pressure)
    const pacingSteps = active.filter((s) => s.payload.pacingHint === 'SLOW');
    expect(pacingSteps.length).toBeGreaterThanOrEqual(1);

    // validationIntensity should be absent for LOW arousal + low-EIV text
    for (const step of active) {
      expect(step.payload.validationIntensity).toBeUndefined();
    }
  });
});
