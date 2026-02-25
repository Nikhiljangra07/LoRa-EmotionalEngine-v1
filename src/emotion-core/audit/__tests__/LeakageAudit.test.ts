export {};

/**
 * PHASE 1 — Leak & Boundary Enforcement Audit
 *
 * Proves no appraisal/policy objects leak into PromptTemplateBuilder.build()
 * args across baseline, escalation, collapse, post-clarity, intervention-heavy,
 * and long-run scenarios.
 */

import {
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  makeAppraisalResult,
  runSequence,
  APPRAISAL_FORBIDDEN_KEYS,
  type StepSpec,
  type MockAppraisalOverrides,
  type CapturedStep,
} from '../../coherence/__tests__/coherenceHarness';

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

const LOW_NEUTRAL = { dominant: 'NEUTRAL' as const, arousal: 'LOW' as const, valence: 'NEUTRAL' as const, confidence: 0.5 };
const HIGH_NEGATIVE = { dominant: 'ANGER' as const, arousal: 'HIGH' as const, valence: 'NEGATIVE' as const, confidence: 0.9 };

function warmUp(n = 2): StepSpec[] {
  return Array.from({ length: n }, () => ({ text: 'hello', emotionalOverride: LOW_NEUTRAL }));
}

function phase(n: number, overrides: MockAppraisalOverrides, emotional: StepSpec['emotionalOverride'] = LOW_NEUTRAL): StepSpec[] {
  return Array.from({ length: n }, () => ({ text: 'test', appraisalOverrides: overrides, emotionalOverride: emotional }));
}

function buildStepFn(steps: StepSpec[]) {
  let idx = 0;
  return jest.fn(() => {
    const spec = steps[idx] ?? steps[steps.length - 1];
    idx++;
    return makeAppraisalResult(spec.appraisalOverrides);
  });
}

function enableAllFlags(): void {
  setFullAdaptiveOn();
  process.env.LORA_HINT_RESOLVER = '1';
  process.env.LORA_HINT_STICKINESS = '1';
  process.env.LORA_HINT_SEMANTIC_GUARD = '1';
  process.env.LORA_GUIDANCE_DWELL_LOCK = '1';
}

function assertNoLeakage(results: CapturedStep[], label: string): void {
  for (const step of results) {
    if (!step.builderArgs) continue;
    for (const key of APPRAISAL_FORBIDDEN_KEYS) {
      if (key in step.builderArgs) {
        throw new Error(
          `[LeakageAudit:${label}] Forbidden key "${key}" found in builder args at step ${step.index}`,
        );
      }
    }
    for (const k of Object.keys(step.builderArgs)) {
      if (k.toLowerCase().includes('appraisal') || k.toLowerCase().includes('bridge')) {
        throw new Error(
          `[LeakageAudit:${label}] Suspicious key "${k}" found in builder args at step ${step.index}`,
        );
      }
    }
  }
}

function assertPayloadClean(results: CapturedStep[], label: string): void {
  for (const step of results) {
    const p = step.payload;
    if (p.appraisalResult && typeof p.appraisalResult === 'object' && 'pressure' in p.appraisalResult) {
      throw new Error(
        `[LeakageAudit:${label}] Raw appraisalResult object found in decision payload at step ${step.index}`,
      );
    }
    if (p.intervention && typeof p.intervention === 'object' && 'toneMode' in p.intervention) {
      throw new Error(
        `[LeakageAudit:${label}] Raw intervention object found in decision payload at step ${step.index}`,
      );
    }
  }
}

describe('Phase 1 — Leakage Audit', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('baseline neutral — no leakage', async () => {
    enableAllFlags();
    const steps = [...warmUp(), ...phase(10, {})];
    const results = await runSequence(steps, { stepFn: buildStepFn(steps), captureBuilderArgs: true });
    assertNoLeakage(results, 'baseline');
    assertPayloadClean(results, 'baseline');
  });

  test('escalation — no leakage', async () => {
    enableAllFlags();
    const steps = [...warmUp(), ...phase(10, { escalationLevel: 3, interruptionLevel: 3, pressureScalar: 3.0 }, HIGH_NEGATIVE)];
    const results = await runSequence(steps, { stepFn: buildStepFn(steps), captureBuilderArgs: true });
    assertNoLeakage(results, 'escalation');
    assertPayloadClean(results, 'escalation');
  });

  test('collapse — no leakage', async () => {
    enableAllFlags();
    const steps = [...warmUp(), ...phase(10, { collapseEvent: true, pressureScalar: 3.0, interruptionLevel: 2 }, HIGH_NEGATIVE)];
    const results = await runSequence(steps, { stepFn: buildStepFn(steps), captureBuilderArgs: true });
    assertNoLeakage(results, 'collapse');
    assertPayloadClean(results, 'collapse');
  });

  test('post-clarity — no leakage', async () => {
    enableAllFlags();
    const steps = [...warmUp(), ...phase(10, { postClarityActive: true })];
    const results = await runSequence(steps, { stepFn: buildStepFn(steps), captureBuilderArgs: true });
    assertNoLeakage(results, 'postClarity');
    assertPayloadClean(results, 'postClarity');
  });

  test('intervention-heavy — no leakage', async () => {
    enableAllFlags();
    const steps = [...warmUp(), ...phase(10, {
      escalationLevel: 2, interruptionLevel: 3, pressureScalar: 2.5,
      toneMode: 'FIRM_CONTAIN', pacingMode: 'SHORT_DIRECT',
      validationMode: 'BOUNDARIED', actionMode: 'INTERRUPT_LOOP',
    }, HIGH_NEGATIVE)];
    const results = await runSequence(steps, { stepFn: buildStepFn(steps), captureBuilderArgs: true });
    assertNoLeakage(results, 'interventionHeavy');
    assertPayloadClean(results, 'interventionHeavy');
  });

  test('long-run 300 steps — no leakage', async () => {
    enableAllFlags();
    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(100, {}),
      ...phase(50, { escalationLevel: 2, interruptionLevel: 2, pressureScalar: 2.5 }, HIGH_NEGATIVE),
      ...phase(30, { collapseEvent: true, pressureScalar: 3.0 }, HIGH_NEGATIVE),
      ...phase(50, { postClarityActive: true }),
      ...phase(70, {}),
    ];
    const results = await runSequence(steps, { stepFn: buildStepFn(steps), captureBuilderArgs: true });
    assertNoLeakage(results, 'longRun300');
    assertPayloadClean(results, 'longRun300');
  });
});
