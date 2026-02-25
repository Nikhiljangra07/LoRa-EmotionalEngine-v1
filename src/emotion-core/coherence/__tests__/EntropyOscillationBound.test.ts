export {};

import {
  makeAppraisalResult,
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  runSequence,
  countMarkers,
  APPRAISAL_FORBIDDEN_KEYS,
  type StepSpec,
  type CapturedStep,
  type MockAppraisalOverrides,
} from './coherenceHarness';

// ── Local helpers ────────────────────────────────────────────────────

const NONE = '__NONE__';

function valueTransitions(values: Array<string | undefined>): number {
  const normalized = values.map((v) => v ?? NONE);
  let count = 0;
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i] !== normalized[i - 1]) count++;
  }
  return count;
}

function slidingFlipBound(values: Array<string | undefined>, windowSize: number, maxFlips: number): boolean {
  const normalized = values.map((v) => v ?? NONE);
  for (let start = 0; start <= normalized.length - windowSize; start++) {
    let flips = 0;
    for (let j = start + 1; j < start + windowSize; j++) {
      if (normalized[j] !== normalized[j - 1]) flips++;
    }
    if (flips > maxFlips) return false;
  }
  return true;
}

// ── Emotional presets ────────────────────────────────────────────────

const LOW_NEUTRAL = { dominant: 'NEUTRAL' as const, arousal: 'LOW' as const, valence: 'NEUTRAL' as const, confidence: 0.5 };
const HIGH_NEGATIVE = { dominant: 'ANGER' as const, arousal: 'HIGH' as const, valence: 'NEGATIVE' as const, confidence: 0.9 };
const MEDIUM_NEGATIVE = { dominant: 'SADNESS' as const, arousal: 'MEDIUM' as const, valence: 'NEGATIVE' as const, confidence: 0.7 };

// ── Cycle builder ────────────────────────────────────────────────────

function buildOneCycle(): StepSpec[] {
  const cycle: StepSpec[] = [];

  // 10 steps escalation: interruptionLevel cycles 1/2/3 deterministically
  for (let i = 0; i < 10; i++) {
    const intLevel: 0 | 1 | 2 | 3 = i < 4 ? 1 : i < 7 ? 2 : 3;
    cycle.push({
      text: 'escalation',
      appraisalOverrides: {
        escalationLevel: 2,
        escalationScore: 0.8,
        pressureScalar: 2.0,
        pressureVolatility: 1.0,
        toneMode: 'FIRM_CONTAIN',
        pacingMode: 'SHORT_DIRECT',
        actionMode: 'INTERRUPT_LOOP',
        validationMode: 'BOUNDARIED',
        interruptionLevel: intLevel,
      },
      emotionalOverride: HIGH_NEGATIVE,
    });
  }

  // 5 steps collapse: intense intervention, safety gates should activate
  for (let i = 0; i < 5; i++) {
    cycle.push({
      text: 'collapse',
      appraisalOverrides: {
        collapseEvent: true,
        collapseSeverity: 0.9,
        pressureScalar: 3.5,
        pressureVolatility: 2.0,
        toneMode: 'FIRM_CONTAIN',
        pacingMode: 'SHORT_DIRECT',
        actionMode: 'INTERRUPT_LOOP',
        validationMode: 'BOUNDARIED',
        interruptionLevel: 3,
      },
      emotionalOverride: HIGH_NEGATIVE,
    });
  }

  // 5 steps post-clarity: reflective, low interruption
  for (let i = 0; i < 5; i++) {
    cycle.push({
      text: 'clarity',
      appraisalOverrides: {
        postClarityActive: true,
        toneMode: 'REFLECTIVE',
        pacingMode: 'NORMAL',
        validationMode: 'STANDARD',
        actionMode: 'NONE',
        interruptionLevel: 0,
      },
      emotionalOverride: MEDIUM_NEGATIVE,
    });
  }

  // 10 steps calm rebuild: neutral everything
  for (let i = 0; i < 10; i++) {
    cycle.push({
      text: 'calm',
      appraisalOverrides: {},
      emotionalOverride: LOW_NEUTRAL,
    });
  }

  return cycle;
}

function buildFullSequence(): StepSpec[] {
  const warmup: StepSpec[] = [
    { text: 'hello', emotionalOverride: LOW_NEUTRAL },
    { text: 'hello', emotionalOverride: LOW_NEUTRAL },
  ];
  const oneCycle = buildOneCycle();
  const cycles: StepSpec[] = [];
  for (let c = 0; c < 50; c++) {
    cycles.push(...oneCycle);
  }
  return [...warmup, ...cycles];
}

// ── Test suite ───────────────────────────────────────────────────────

describe('EntropyOscillationBound — 1502-step mixed-stress long session', () => {
  const saved = saveEnv();
  let results: CapturedStep[];

  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps = buildFullSequence();
    expect(steps.length).toBe(1502);

    setFullAdaptiveOn();

    let idx = 0;
    const stepFn = jest.fn(() => {
      const spec = steps[idx] ?? steps[steps.length - 1];
      idx++;
      return makeAppraisalResult(spec.appraisalOverrides);
    });

    results = await runSequence(steps, { stepFn, captureBuilderArgs: true });
  }, 120000);

  afterAll(() => {
    restoreEnv(saved);
    jest.restoreAllMocks();
  });

  // ── A. Entropy / transition bounds ─────────────────────────────────

  test('A — guidanceMode transitions bounded', () => {
    const modes = results.slice(2).map((s) => s.payload.promptProfile?.guidanceMode);
    const transitions = valueTransitions(modes);
    // 50 cycles × 4 phases; cooldown fire/suppress/fire pattern within each
    // escalation phase produces ~15 mode flips per cycle. Observed: 749.
    expect(transitions).toBeLessThanOrEqual(759);
  });

  test('A — toneHint transitions bounded', () => {
    const tones = results.slice(2).map((s) => s.payload.toneHint as string | undefined);
    const transitions = valueTransitions(tones);
    // toneHint toggles GENTLE↔undefined across escalation/collapse/calm phases.
    // 50 cycles × ~6 transitions per cycle. Observed: 299.
    expect(transitions).toBeLessThanOrEqual(309);
  });

  test('A — interruptHint transitions bounded', () => {
    const hints = results.slice(2).map((s) => s.payload.interruptHint as string | undefined);
    const transitions = valueTransitions(hints);
    // interruptHint toggles across SOFT/FIRM/undefined as interruptionLevel
    // changes within each cycle phase. 50 cycles × ~8 transitions. Observed: 399.
    expect(transitions).toBeLessThanOrEqual(409);
  });

  test('A — pacingHint transitions bounded', () => {
    const hints = results.slice(2).map((s) => s.payload.pacingHint as string | undefined);
    const transitions = valueTransitions(hints);
    // pacingHint toggles SLOW↔undefined across escalation/calm phases.
    // Observed: <=200.
    expect(transitions).toBeLessThanOrEqual(200);
  });

  // ── B. No pathological oscillation streaks ─────────────────────────

  test('B — no 25-step window with >15 guidanceMode flips', () => {
    const modes = results.slice(2).map((s) => s.payload.promptProfile?.guidanceMode as string | undefined);
    expect(slidingFlipBound(modes, 25, 15)).toBe(true);
  });

  // ── C. Drift monitor sanity ────────────────────────────────────────

  test('C — driftDetected count bounded by 2× cycle count', () => {
    const driftCount = results.slice(2).filter((s) => s.payload.driftDetected === true).length;
    // At most 2 drift detections per cycle (50 cycles → max 100)
    expect(driftCount).toBeLessThanOrEqual(100);
  });

  // ── D. Overlay density ─────────────────────────────────────────────

  test('D — horizon steps have 0 markers; active steps max 7', () => {
    expect(countMarkers(results[0].prompt)).toBe(0);
    expect(countMarkers(results[1].prompt)).toBe(0);

    for (let i = 2; i < results.length; i++) {
      expect(countMarkers(results[i].prompt)).toBeLessThanOrEqual(7);
    }
  });

  // ── E. Forbidden combinations ──────────────────────────────────────

  test('E — no forbidden marker combinations during STABILIZE', () => {
    for (const step of results.slice(2)) {
      if (step.payload.promptProfile?.guidanceMode === 'STABILIZE') {
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
        expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
        expect(step.prompt).not.toContain('[STEP_HINT:');
      }
    }
  });

  test('E — no forbidden marker combinations during DE_ESCALATE', () => {
    for (const step of results.slice(2)) {
      if (step.payload.promptProfile?.guidanceMode === 'DE_ESCALATE') {
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
      }
    }
  });

  // ── F. Leakage guard (first 60 steps) ──────────────────────────────

  test('F — no appraisal leakage in builder args (first 60 steps)', () => {
    const window = results.slice(0, 60);
    for (const step of window) {
      if (step.builderArgs) {
        for (const key of APPRAISAL_FORBIDDEN_KEYS) {
          expect(step.builderArgs).not.toHaveProperty(key);
        }
      }
    }
  });
});
