export {};

import {
  saveEnv,
  restoreEnv,
  runSequence,
  countMarkers,
  APPRAISAL_FORBIDDEN_KEYS,
} from './scenarioHarness';

import {
  setScenarioAdaptiveOn,
  warmUp,
  phase,
  buildStepFn,
  LOW_NEUTRAL,
  HIGH_NEGATIVE,
  MEDIUM_NEGATIVE,
} from './scenarioHarness';

import type { StepSpec } from './scenarioHarness';

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

// =====================================================================
// R1 — No ramping density under repeated escalation
// =====================================================================

describe('R1 — No ramping density under repeated escalation', () => {
  test('marker density does not monotonically ramp across 60-step escalation', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      // Steps 3–60: sustained high-escalation negative pattern
      ...phase(
        58,
        { escalationLevel: 2, pressureScalar: 2.0, pressureVolatility: 1.0, interruptionLevel: 1 },
        HIGH_NEGATIVE,
        'I demand you listen to me right now',
      ),
    ];

    setScenarioAdaptiveOn();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    // Horizon: first 2 messages must have 0 markers
    expect(countMarkers(results[0].prompt)).toBe(0);
    expect(countMarkers(results[1].prompt)).toBe(0);

    // Max marker density never exceeds 7
    for (const step of results) {
      expect(countMarkers(step.prompt)).toBeLessThanOrEqual(7);
    }

    // No "runaway ramp": in steps 10–59, no 8 consecutive steps with strictly increasing density
    const densities = results.slice(10, 60).map((s) => countMarkers(s.prompt));
    let consecutiveIncreases = 0;
    for (let i = 1; i < densities.length; i++) {
      if (densities[i] > densities[i - 1]) {
        consecutiveIncreases++;
        expect(consecutiveIncreases).toBeLessThan(8);
      } else {
        consecutiveIncreases = 0;
      }
    }
  });
});

// =====================================================================
// R2 — DE_ESCALATE engages; tone never FIRM during DE_ESCALATE
// =====================================================================

describe('R2 — DE_ESCALATE engages; tone never FIRM during DE_ESCALATE', () => {
  test('escalation >= 2 produces DE_ESCALATE; no FIRM tone in that mode', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(
        25,
        { escalationLevel: 2, escalationScore: 0.8, pressureScalar: 2.0, toneMode: 'FIRM_CONTAIN' },
        HIGH_NEGATIVE,
        'you must comply',
      ),
    ];

    setScenarioAdaptiveOn();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    const active = results.slice(2);

    // DE_ESCALATE must appear at least once
    const deEscalateSteps = active.filter(
      (s) => s.payload.promptProfile?.guidanceMode === 'DE_ESCALATE',
    );
    expect(deEscalateSteps.length).toBeGreaterThanOrEqual(1);

    // For every DE_ESCALATE step: tone must not be FIRM
    for (const step of active) {
      if (step.payload.promptProfile?.guidanceMode === 'DE_ESCALATE') {
        expect(step.payload.toneHint).not.toBe('FIRM');
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
      }
    }
  });
});

// =====================================================================
// R3 — Interrupt does not escalate into HARD_STOP under de-escalation/stabilize
// =====================================================================

describe('R3 — Interrupt does not escalate into HARD_STOP under DE_ESCALATE/STABILIZE', () => {
  test('interruptionLevel=3 is downgraded to FIRM under DE_ESCALATE', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(
        15,
        { escalationLevel: 2, interruptionLevel: 3, pressureScalar: 2.5 },
        HIGH_NEGATIVE,
        'do it now',
      ),
    ];

    setScenarioAdaptiveOn();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      const mode = step.payload.promptProfile?.guidanceMode;
      if (mode === 'DE_ESCALATE' || mode === 'STABILIZE') {
        expect(step.payload.interruptHint).not.toBe('HARD_STOP');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
      }
    }
  });

  test('interruptionLevel=3 is downgraded to FIRM under STABILIZE (collapse path)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(
        10,
        { collapseEvent: true, interruptionLevel: 3, pressureScalar: 3.5 },
        HIGH_NEGATIVE,
        'everything is gone',
      ),
    ];

    setScenarioAdaptiveOn();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      const mode = step.payload.promptProfile?.guidanceMode;
      if (mode === 'STABILIZE') {
        expect(step.payload.interruptHint).not.toBe('HARD_STOP');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
      }
    }
  });
});

// =====================================================================
// R4 — Question budget clamps under interrupt
// =====================================================================

describe('R4 — Question budget clamps under interrupt', () => {
  test('when interruptHint exists, questionBudgetHint is ZERO and never ONE', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      // interruptionLevel=1 → SOFT, interruptionLevel=2 → FIRM
      ...phase(10, { interruptionLevel: 1 }, MEDIUM_NEGATIVE, 'msg'),
      ...phase(10, { interruptionLevel: 2, escalationLevel: 1 }, HIGH_NEGATIVE, 'msg'),
    ];

    setScenarioAdaptiveOn();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      if (step.payload.interruptHint !== undefined) {
        // questionBudgetHint must be ZERO if present, never ONE
        if (step.payload.questionBudgetHint !== undefined) {
          expect(step.payload.questionBudgetHint).toBe('ZERO');
        }
        expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
      }
    }
  });
});

// =====================================================================
// R5 — Action hints stay stabilize-safe
// =====================================================================

describe('R5 — Action hints stay stabilize-safe during STABILIZE', () => {
  test('only ENCOURAGE_BREATH or SUGGEST_BREAK (or absent) during STABILIZE', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      // Collapse with action suggestions that would normally map to ASK_ONE_QUESTION
      ...phase(
        15,
        {
          collapseEvent: true,
          pressureScalar: 3.5,
          actionMode: 'SHIFT_TO_REFLECTION',
        },
        HIGH_NEGATIVE,
        'I cant handle this',
      ),
    ];

    setScenarioAdaptiveOn();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      if (step.payload.promptProfile?.guidanceMode === 'STABILIZE') {
        // Forbidden action hints during STABILIZE
        expect(step.prompt).not.toContain('[ACTION_HINT:ASK_ONE_QUESTION]');
        expect(step.prompt).not.toContain('[ACTION_HINT:OFFER_STEPS]');

        if (step.payload.actionHint !== undefined) {
          expect(['ENCOURAGE_BREATH', 'SUGGEST_BREAK']).toContain(step.payload.actionHint);
        }
      }
    }
  });
});

// =====================================================================
// R6 — No appraisal leakage into builder args
// =====================================================================

describe('R6 — No appraisal leakage into builder args', () => {
  test('forbidden keys absent from all builder calls across 30-step mixed escalation', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(8, { escalationLevel: 2, interruptionLevel: 2, pressureScalar: 2.5 }, HIGH_NEGATIVE),
      ...phase(5, { collapseEvent: true, pressureScalar: 3.5 }, HIGH_NEGATIVE),
      ...phase(5, { postClarityActive: true }, MEDIUM_NEGATIVE),
      ...phase(10, {}, LOW_NEUTRAL),
    ];

    setScenarioAdaptiveOn();
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
