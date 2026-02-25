export {};

import {
  makeAppraisalResult,
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  runSequence,
  extractMarkers,
  APPRAISAL_FORBIDDEN_KEYS,
  type StepSpec,
  type MockAppraisalOverrides,
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

const HIGH_NEGATIVE = {
  dominant: 'ANGER' as const,
  arousal: 'HIGH' as const,
  valence: 'NEGATIVE' as const,
  confidence: 0.9,
};

function warmUp(n = 2): StepSpec[] {
  return Array.from({ length: n }, () => ({
    text: 'hello',
    emotionalOverride: LOW_NEUTRAL,
  }));
}

function stepsOf(n: number, overrides: MockAppraisalOverrides, emotional = LOW_NEUTRAL): StepSpec[] {
  return Array.from({ length: n }, () => ({
    text: 'test',
    appraisalOverrides: overrides,
    emotionalOverride: emotional,
  }));
}

function buildStepFn(steps: StepSpec[]) {
  let idx = 0;
  return jest.fn(() => {
    const spec = steps[idx] ?? steps[steps.length - 1];
    idx++;
    return makeAppraisalResult(spec.appraisalOverrides);
  });
}

// ── T1: INTERRUPT dominates QUESTION_BUDGET ─────────────────────────

describe('T1 — INTERRUPT dominates QUESTION_BUDGET', () => {
  test('interruptHint FIRM forces questionBudgetHint to ZERO, never ONE', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      // interruptionLevel=2 → FIRM, and no collapse/stabilize so DE_ESCALATE won't fire;
      // but escalation.level < 2. The only questionBudget trigger would be interruptHint → ZERO.
      ...stepsOf(5, { interruptionLevel: 2 }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      expect(step.payload.interruptHint).toBe('FIRM');

      if (step.payload.questionBudgetHint !== undefined) {
        expect(step.payload.questionBudgetHint).toBe('ZERO');
      }

      expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
    }
  });

  test('interruptHint HARD_STOP also forces questionBudgetHint ZERO', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(3, { interruptionLevel: 3 }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      expect(step.payload.interruptHint).toBeDefined();

      if (step.payload.questionBudgetHint !== undefined) {
        expect(step.payload.questionBudgetHint).toBe('ZERO');
      }

      expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
    }
  });
});

// ── T2: STABILIZE forces QUESTION_BUDGET=ZERO ───────────────────────

describe('T2 — STABILIZE forces QUESTION_BUDGET=ZERO', () => {
  test('collapse → STABILIZE always has questionBudgetHint ZERO, never ONE', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(5, { collapseEvent: true, pressureScalar: 3.0 }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      const mode = step.payload.promptProfile?.guidanceMode;

      if (mode === 'STABILIZE') {
        if (step.payload.questionBudgetHint !== undefined) {
          expect(step.payload.questionBudgetHint).toBe('ZERO');
        }
        expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
      }
    }
  });
});

// ── T3: DE_ESCALATE never pairs with TONE_HINT:FIRM ────────────────

describe('T3 — DE_ESCALATE never pairs with TONE_HINT:FIRM', () => {
  test('escalation level >= 2 → DE_ESCALATE: toneHint is GENTLE or absent, never FIRM', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(20, { escalationLevel: 2 }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      const mode = step.payload.promptProfile?.guidanceMode;
      if (mode === 'DE_ESCALATE') {
        expect(step.payload.toneHint).not.toBe('FIRM');
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
      }
    }
  });
});

// ── T4: STEP_HINT suppressed under SLOW pacing OR interrupt ─────────

describe('T4 — STEP_HINT suppressed under SLOW pacing or interrupt', () => {
  test('pacingHint=SLOW suppresses stepHint', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(5, {
        pressureScalar: 3.0,
        pressureVolatility: 2.0,
        actionMode: 'SHIFT_TO_REFLECTION',
      }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      if (step.payload.pacingHint === 'SLOW') {
        expect(step.payload.stepHint).toBeUndefined();
        expect(step.prompt).not.toContain('[STEP_HINT:');
      }
    }
  });

  test('interruptHint presence suppresses stepHint', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(5, {
        interruptionLevel: 2,
        actionMode: 'SHIFT_TO_REFLECTION',
      }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      if (step.payload.interruptHint !== undefined) {
        expect(step.payload.stepHint).toBeUndefined();
        expect(step.prompt).not.toContain('[STEP_HINT:');
      }
    }
  });
});

// ── T5: ACTION_HINT safety: STABILIZE never allows ASK_ONE_QUESTION ──

describe('T5 — ACTION_HINT safety: STABILIZE blocks ASK_ONE_QUESTION', () => {
  test('collapse + SHIFT_TO_REFLECTION → actionHint must not be ASK_ONE_QUESTION in STABILIZE', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(5, {
        collapseEvent: true,
        pressureScalar: 3.0,
        actionMode: 'SHIFT_TO_REFLECTION',
      }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      const mode = step.payload.promptProfile?.guidanceMode;
      if (mode === 'STABILIZE') {
        expect(step.payload.actionHint).not.toBe('ASK_ONE_QUESTION');
        expect(step.payload.actionHint).not.toBe('OFFER_STEPS');
        expect(step.prompt).not.toContain('[ACTION_HINT:ASK_ONE_QUESTION]');
        expect(step.prompt).not.toContain('[ACTION_HINT:OFFER_STEPS]');
      }
    }
  });
});

// ── T6: "No contradictory stacking" on a single STABILIZE message ────

describe('T6 — No contradictory stacking under STABILIZE', () => {
  test('STABILIZE message must not contain stepHint, questionBudget=ONE, tone=FIRM, or interrupt=HARD_STOP', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(5, {
        collapseEvent: true,
        pressureScalar: 3.5,
        interruptionLevel: 3,
        actionMode: 'SHIFT_TO_REFLECTION',
      }),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const active = results.slice(2);
    for (const step of active) {
      const mode = step.payload.promptProfile?.guidanceMode;
      if (mode === 'STABILIZE') {
        expect(step.payload.stepHint).toBeUndefined();
        expect(step.payload.questionBudgetHint).not.toBe('ONE');
        expect(step.payload.toneHint).not.toBe('FIRM');
        expect(step.payload.interruptHint).not.toBe('HARD_STOP');

        expect(step.prompt).not.toContain('[STEP_HINT:');
        expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
      }
    }
  });
});

// ── T7: Long-run conflict scan (500 steps) ──────────────────────────

describe('T7 — Long-run conflict scan (500 steps)', () => {
  test('no cross-signal contradictions across 500-step lifecycle', async () => {
    const steps: StepSpec[] = [];

    // Phase 1 (0–99): calm baseline
    for (let i = 0; i < 100; i++) {
      steps.push({ text: 'fine', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL });
    }
    // Phase 2 (100–159): escalation burst (level toggles 1→2)
    for (let i = 0; i < 60; i++) {
      const lvl = i < 20 ? 1 : 2;
      steps.push({
        text: 'tense',
        appraisalOverrides: { escalationLevel: lvl, pressureScalar: 1.5 + i * 0.02, interruptionLevel: (lvl >= 2 ? 2 : 0) as 0 | 1 | 2 | 3 },
        emotionalOverride: HIGH_NEGATIVE,
      });
    }
    // Phase 3 (160–199): collapse events
    for (let i = 0; i < 40; i++) {
      steps.push({
        text: 'falling apart',
        appraisalOverrides: { collapseEvent: true, pressureScalar: 3.5, interruptionLevel: 3 },
        emotionalOverride: HIGH_NEGATIVE,
      });
    }
    // Phase 4 (200–299): postClarity recovery
    for (let i = 0; i < 100; i++) {
      steps.push({
        text: 'I understand now',
        appraisalOverrides: { postClarityActive: true },
        emotionalOverride: LOW_NEUTRAL,
      });
    }
    // Phase 5 (300–499): calm rebuild
    for (let i = 0; i < 200; i++) {
      steps.push({ text: 'rebuilding', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL });
    }

    setFullAdaptiveOn();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    for (const step of results) {
      const p = step.payload;
      const mode = p.promptProfile?.guidanceMode;

      // INV-1: FIRM tone never during STABILIZE/DE_ESCALATE
      if (mode === 'STABILIZE' || mode === 'DE_ESCALATE') {
        expect(p.toneHint).not.toBe('FIRM');
      }

      // INV-2: stepHint absent when pacingHint=SLOW or interruptHint present or escalation >= 2
      if (p.pacingHint === 'SLOW' || p.interruptHint !== undefined) {
        expect(p.stepHint).toBeUndefined();
      }
      if (p.stepHint !== undefined) {
        const esc = p.appraisal?.escalationLevel ?? 0;
        expect(esc).toBeLessThan(2);
      }

      // INV-3: questionBudgetHint=ONE never with interruptHint present
      if (p.interruptHint !== undefined) {
        expect(p.questionBudgetHint).not.toBe('ONE');
      }

      // INV-4: questionBudgetHint=ONE never during STABILIZE
      if (mode === 'STABILIZE') {
        expect(p.questionBudgetHint).not.toBe('ONE');
      }

      // INV-5: interruptHint HARD_STOP never during STABILIZE/DE_ESCALATE (downgraded to FIRM)
      if (mode === 'STABILIZE' || mode === 'DE_ESCALATE') {
        expect(p.interruptHint).not.toBe('HARD_STOP');
      }

      // INV-6: No forbidden prompt markers during STABILIZE
      if (mode === 'STABILIZE') {
        expect(step.prompt).not.toContain('[TONE_HINT:FIRM]');
        expect(step.prompt).not.toContain('[STEP_HINT:');
        expect(step.prompt).not.toContain('[QUESTION_BUDGET:ONE]');
        expect(step.prompt).not.toContain('[INTERRUPT_HINT:HARD_STOP]');
      }
    }
  }, 120000);
});

// ── T8: No appraisal leakage (global) ───────────────────────────────

describe('T8 — No appraisal leakage across full run', () => {
  test('builder args never contain forbidden keys across a 30-step mixed sequence', async () => {
    const specs: StepSpec[] = [
      ...warmUp(),
      ...stepsOf(5, { collapseEvent: true, pressureScalar: 3.0 }),
      ...stepsOf(5, { escalationLevel: 2, interruptionLevel: 2 }),
      ...stepsOf(5, { postClarityActive: true }),
      ...stepsOf(5, { actionMode: 'SHIFT_TO_REFLECTION' }),
      ...stepsOf(8, {}),
    ];

    setFullAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn, captureBuilderArgs: true });

    for (const step of results) {
      if (step.builderArgs) {
        for (const key of APPRAISAL_FORBIDDEN_KEYS) {
          expect(step.builderArgs).not.toHaveProperty(key);
        }
      }
    }
  });
});
