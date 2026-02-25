export {};

import {
  makeAppraisalResult,
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  runSequence,
  countMarkers,
  countTransitions,
  APPRAISAL_FORBIDDEN_KEYS,
  type StepSpec,
  type MockAppraisalOverrides,
  type CapturedStep,
} from './coherenceHarness';

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

// ── Shared fixtures ──────────────────────────────────────────────────

const LOW_NEUTRAL = { dominant: 'NEUTRAL' as const, arousal: 'LOW' as const, valence: 'NEUTRAL' as const, confidence: 0.5 };
const HIGH_NEGATIVE = { dominant: 'ANGER' as const, arousal: 'HIGH' as const, valence: 'NEGATIVE' as const, confidence: 0.9 };
const MEDIUM_NEGATIVE = { dominant: 'SADNESS' as const, arousal: 'MEDIUM' as const, valence: 'NEGATIVE' as const, confidence: 0.7 };

function warmUp(n = 2): StepSpec[] {
  return Array.from({ length: n }, () => ({ text: 'hello', emotionalOverride: LOW_NEUTRAL }));
}

function phase(n: number, overrides: MockAppraisalOverrides, emotional: StepSpec['emotionalOverride'] = LOW_NEUTRAL, text = 'test'): StepSpec[] {
  return Array.from({ length: n }, () => ({ text, appraisalOverrides: overrides, emotionalOverride: emotional }));
}

function buildStepFn(steps: StepSpec[]) {
  let idx = 0;
  return jest.fn(() => {
    const spec = steps[idx] ?? steps[steps.length - 1];
    idx++;
    return makeAppraisalResult(spec.appraisalOverrides);
  });
}

function buildStressSequence(): StepSpec[] {
  const steps: StepSpec[] = [...warmUp()];
  for (let c = 0; c < 10; c++) {
    // 10 escalation
    for (let i = 0; i < 10; i++) {
      const intLevel: 0 | 1 | 2 | 3 = i < 4 ? 1 : i < 7 ? 2 : 3;
      steps.push({
        text: 'escalation',
        appraisalOverrides: {
          escalationLevel: 2,
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
    // 5 collapse
    steps.push(...phase(5, {
      collapseEvent: true,
      pressureScalar: 3.5,
      pressureVolatility: 2.0,
      interruptionLevel: 3,
      toneMode: 'FIRM_CONTAIN',
      actionMode: 'INTERRUPT_LOOP',
    }, HIGH_NEGATIVE, 'collapse'));
    // 5 post-clarity
    steps.push(...phase(5, {
      postClarityActive: true,
      interruptionLevel: 0,
    }, MEDIUM_NEGATIVE, 'clarity'));
    // 10 calm
    steps.push(...phase(10, {}, LOW_NEUTRAL, 'calm'));
  }
  return steps;
}

function setAllFlagsNoResolver(): void {
  setFullAdaptiveOn();
  delete process.env.LORA_HINT_RESOLVER;
}

function setAllFlagsWithResolver(): void {
  setFullAdaptiveOn();
  process.env.LORA_HINT_RESOLVER = '1';
}

// =====================================================================
// 1) Flag OFF → prompts byte-identical + golden replay unchanged
// =====================================================================

describe('HintResolver — flag OFF identity', () => {
  test('prompts are byte-identical when resolver flag is OFF', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(8, { escalationLevel: 2, interruptionLevel: 2, pressureScalar: 2.5 }, HIGH_NEGATIVE),
      ...phase(5, { collapseEvent: true, pressureScalar: 3.0 }, HIGH_NEGATIVE),
      ...phase(5, { postClarityActive: true }, MEDIUM_NEGATIVE),
      ...phase(10, {}, LOW_NEUTRAL),
    ];

    // Run A: all adaptive flags ON, resolver OFF
    setAllFlagsNoResolver();
    const stepFnA = buildStepFn(steps);
    const resultsA = await runSequence(steps, { stepFn: stepFnA });

    // Run B: all adaptive flags ON, resolver still OFF (explicit)
    setAllFlagsNoResolver();
    const stepFnB = buildStepFn(steps);
    const resultsB = await runSequence(steps, { stepFn: stepFnB });

    for (let i = 0; i < resultsA.length; i++) {
      expect(resultsB[i].prompt).toBe(resultsA[i].prompt);
    }
  });

  test('golden replay hashes unchanged when resolver OFF', () => {
    jest.resetModules();
    jest.unmock('../../../appraisal-bridge/AppraisalBridgeRunner');
    jest.unmock('../../../debug/sessionTrace');

    const path = require('path');
    const { runReplayFromFile } = require('../../../appraisal-bridge/replay/runReplay');
    const dir = path.join(__dirname, '..', '..', '..', 'appraisal-bridge', 'replay', 'fixtures');

    const GOLDEN: Record<string, string> = {
      'calm_baseline_50.json': '48225cb02b2b85c891ad515c5dfebe14363f27beaa472f853bd595413a4486ee',
      'escalation_burst_30.json': '7527ad065d2839d652b55e919f1a841b326f23a4b9b5de1b3307cbdf32bf850f',
      'oscillation_100.json': '12ad623e950e28f0cbaf726641e8345f5278164bb85fd7a39b6123f8cc85afb3',
      'recovery_80.json': 'b1a665d175ad9d7d6bd7fd1707a9dd0e7765e35cdb9157ed7559c0272162c31e',
    };

    for (const [file, hash] of Object.entries(GOLDEN)) {
      expect(runReplayFromFile(path.join(dir, file)).hash).toBe(hash);
    }
  });
});

// =====================================================================
// 2) Resolver ON → overlay density <= 5
// =====================================================================

describe('HintResolver — overlay density cap', () => {
  test('resolver ON caps marker count to <= 5 across stress sequence', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps = buildStressSequence();
    setAllFlagsWithResolver();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    expect(countMarkers(results[0].prompt)).toBe(0);
    expect(countMarkers(results[1].prompt)).toBe(0);

    for (let i = 2; i < results.length; i++) {
      expect(countMarkers(results[i].prompt)).toBeLessThanOrEqual(5);
    }
  });
});

// =====================================================================
// 3) Resolver reduces chatter (fewer transitions)
// =====================================================================

describe('HintResolver — reduces chatter', () => {
  test('resolver ON produces fewer or equal hint transitions vs OFF', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps = buildStressSequence();

    // Run without resolver
    setAllFlagsNoResolver();
    const stepFnOff = buildStepFn(steps);
    const offResults = await runSequence(steps, { stepFn: stepFnOff });

    // Run with resolver
    setAllFlagsWithResolver();
    const stepFnOn = buildStepFn(steps);
    const onResults = await runSequence(steps, { stepFn: stepFnOn });

    const offActive = offResults.slice(2);
    const onActive = onResults.slice(2);

    function hintValues(results: CapturedStep[], key: string): (string | undefined)[] {
      return results.map((r) => r.payload[key] as string | undefined);
    }

    const offStepTransitions = countTransitions(hintValues(offActive, 'stepHint'));
    const onStepTransitions = countTransitions(hintValues(onActive, 'stepHint'));
    expect(onStepTransitions).toBeLessThanOrEqual(offStepTransitions);

    const offVITransitions = countTransitions(hintValues(offActive, 'validationIntensity'));
    const onVITransitions = countTransitions(hintValues(onActive, 'validationIntensity'));
    expect(onVITransitions).toBeLessThanOrEqual(offVITransitions);
  });
});

// =====================================================================
// 4) No forbidden combos reintroduced
// =====================================================================

describe('HintResolver — forbidden combos', () => {
  test('STABILIZE never shows stepHint; interrupt always clamps questionBudget to ZERO', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps = buildStressSequence();
    setAllFlagsWithResolver();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    for (const step of results.slice(2)) {
      const mode = step.payload.promptProfile?.guidanceMode;

      if (mode === 'STABILIZE') {
        expect(step.payload.stepHint).toBeUndefined();
        expect(step.prompt).not.toContain('[STEP_HINT:');
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
        expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
      }

      if (mode === 'DE_ESCALATE') {
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
      }

      if (step.payload.interruptHint !== undefined) {
        if (step.payload.questionBudgetHint !== undefined) {
          expect(step.payload.questionBudgetHint).toBe('ZERO');
        }
      }
    }
  });
});

// =====================================================================
// 5) No appraisal leakage
// =====================================================================

describe('HintResolver — no appraisal leakage', () => {
  test('builder args never contain forbidden keys with resolver ON', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(8, { collapseEvent: true, pressureScalar: 3.0, interruptionLevel: 2 }, HIGH_NEGATIVE),
      ...phase(8, { escalationLevel: 2, interruptionLevel: 2 }, HIGH_NEGATIVE),
      ...phase(6, { postClarityActive: true }, MEDIUM_NEGATIVE),
      ...phase(6, {}, LOW_NEUTRAL),
    ];

    setAllFlagsWithResolver();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn, captureBuilderArgs: true });

    for (const step of results) {
      if (step.builderArgs) {
        for (const key of APPRAISAL_FORBIDDEN_KEYS) {
          expect(step.builderArgs).not.toHaveProperty(key);
        }
      }
    }
  });
});

// =====================================================================
// 6) Double resolve maintains hard cap under stickiness
// =====================================================================

describe('HintResolver — double resolve with stickiness', () => {
  function setResolverAndStickiness(): void {
    setFullAdaptiveOn();
    process.env.LORA_HINT_RESOLVER = '1';
    process.env.LORA_HINT_STICKINESS = '1';
  }

  test('hard cap <= 5 maintained even when stickiness reintroduces a dropped hint', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Step 3: trigger many hints (escalation + interrupt + collapse → lots of overlays)
    // Step 4: raw signals drop some, but stickiness would re-add them
    // Assert final marker count never exceeds 5
    const steps: StepSpec[] = [
      ...warmUp(),
      // msg 3: heavy triggers → many hints
      {
        text: 'crisis',
        appraisalOverrides: {
          escalationLevel: 2,
          pressureScalar: 2.5,
          pressureVolatility: 1.5,
          interruptionLevel: 2,
          toneMode: 'FIRM_CONTAIN',
          pacingMode: 'SHORT_DIRECT',
          actionMode: 'INTERRUPT_LOOP',
          validationMode: 'BOUNDARIED',
        },
        emotionalOverride: HIGH_NEGATIVE,
      },
      // msg 4: most signals drop — stickiness would carry forward
      { text: 'okay', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 5: still neutral
      { text: 'fine', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 6: neutral
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    setResolverAndStickiness();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    // Horizon: steps 0–1 have 0 markers
    expect(countMarkers(results[0].prompt)).toBe(0);
    expect(countMarkers(results[1].prompt)).toBe(0);

    // Steps 2+ (active): hard cap <=5
    for (let i = 2; i < results.length; i++) {
      expect(countMarkers(results[i].prompt)).toBeLessThanOrEqual(5);
    }
  });

  test('resolver OFF + stickiness ON may exceed 5 (no double resolve)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // This test documents the expected behavior without the resolver:
    // stickiness alone has no density cap guarantee
    const steps: StepSpec[] = [
      ...warmUp(),
      {
        text: 'crisis',
        appraisalOverrides: {
          escalationLevel: 2,
          pressureScalar: 2.5,
          pressureVolatility: 1.5,
          interruptionLevel: 2,
          toneMode: 'FIRM_CONTAIN',
          pacingMode: 'SHORT_DIRECT',
          actionMode: 'INTERRUPT_LOOP',
          validationMode: 'BOUNDARIED',
        },
        emotionalOverride: HIGH_NEGATIVE,
      },
      { text: 'okay', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    setFullAdaptiveOn();
    process.env.LORA_HINT_STICKINESS = '1';
    delete process.env.LORA_HINT_RESOLVER;
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    // Without resolver, no hard cap — just verify test runs without error
    // and that at least one step has markers (sanity)
    const maxMarkers = Math.max(...results.slice(2).map((r) => countMarkers(r.prompt)));
    expect(maxMarkers).toBeGreaterThan(0);
  });
});
