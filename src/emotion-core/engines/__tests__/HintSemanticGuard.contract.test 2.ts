export {};

import { enforceHintSemanticCoherence } from '../hintSemanticGuard';
import type { ResolvableHints } from '../hintResolver';
import {
  makeAppraisalResult,
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  runSequence,
  countMarkers,
  APPRAISAL_FORBIDDEN_KEYS,
  type StepSpec,
  type MockAppraisalOverrides,
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

function setGuardOn(): void {
  setFullAdaptiveOn();
  process.env.LORA_HINT_SEMANTIC_GUARD = '1';
}

function setAdaptiveNoGuard(): void {
  setFullAdaptiveOn();
  delete process.env.LORA_HINT_SEMANTIC_GUARD;
}

// =====================================================================
// A) Flag OFF → prompt identity
// =====================================================================

describe('HintSemanticGuard — flag OFF identity', () => {
  test('prompts byte-identical when guard flag is OFF', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(3, { escalationLevel: 2, pressureScalar: 2.5, interruptionLevel: 2 }, HIGH_NEGATIVE),
      ...phase(3, { collapseEvent: true, pressureScalar: 3.0 }, HIGH_NEGATIVE),
      ...phase(4, {}, LOW_NEUTRAL),
    ];

    setAdaptiveNoGuard();
    const resultsA = await runSequence(steps, { stepFn: buildStepFn(steps) });

    setAdaptiveNoGuard();
    const resultsB = await runSequence(steps, { stepFn: buildStepFn(steps) });

    for (let i = 0; i < resultsA.length; i++) {
      expect(resultsB[i].prompt).toBe(resultsA[i].prompt);
    }
  });
});

// =====================================================================
// B) Interrupt dominance enforced (pure unit)
// =====================================================================

describe('HintSemanticGuard — Rule 1: Interrupt Dominance', () => {
  test('interrupt forces questionBudget ZERO and drops stepHint', () => {
    const result = enforceHintSemanticCoherence({
      interruptHint: 'FIRM',
      questionBudgetHint: 'ONE',
      stepHint: 'TWO_STEPS',
    });
    expect(result.questionBudgetHint).toBe('ZERO');
    expect(result.stepHint).toBeUndefined();
  });
});

// =====================================================================
// C) STABILIZE removes FIRM + stepHint
// =====================================================================

describe('HintSemanticGuard — Rule 2: STABILIZE Consistency', () => {
  test('STABILIZE removes FIRM toneHint, forces questionBudget ZERO, drops stepHint', () => {
    const result = enforceHintSemanticCoherence({
      guidanceMode: 'STABILIZE',
      toneHint: 'FIRM',
      questionBudgetHint: 'ONE',
      stepHint: 'ONE_STEP',
    });
    expect(result.toneHint).toBeUndefined();
    expect(result.questionBudgetHint).toBe('ZERO');
    expect(result.stepHint).toBeUndefined();
  });
});

// =====================================================================
// D) DE_ESCALATE removes HARD_STOP
// =====================================================================

describe('HintSemanticGuard — Rule 3: DE_ESCALATE Consistency', () => {
  test('DE_ESCALATE removes FIRM toneHint and HARD_STOP interruptHint', () => {
    const result = enforceHintSemanticCoherence({
      guidanceMode: 'DE_ESCALATE',
      toneHint: 'FIRM',
      interruptHint: 'HARD_STOP',
    });
    expect(result.toneHint).toBeUndefined();
    expect(result.interruptHint).toBeUndefined();
  });

  test('DE_ESCALATE preserves GENTLE toneHint and SOFT interruptHint', () => {
    const result = enforceHintSemanticCoherence({
      guidanceMode: 'DE_ESCALATE',
      toneHint: 'GENTLE',
      interruptHint: 'SOFT',
    });
    expect(result.toneHint).toBe('GENTLE');
    expect(result.interruptHint).toBe('SOFT');
  });
});

// =====================================================================
// E) SLOW pacing suppresses stepHint
// =====================================================================

describe('HintSemanticGuard — Rule 4: Slow Pacing', () => {
  test('SLOW pacing drops stepHint', () => {
    const result = enforceHintSemanticCoherence({
      pacingHint: 'SLOW',
      stepHint: 'ONE_STEP',
    });
    expect(result.stepHint).toBeUndefined();
    expect(result.pacingHint).toBe('SLOW');
  });
});

// =====================================================================
// F) HIGH validation + FIRM downgrades to GENTLE
// =====================================================================

describe('HintSemanticGuard — Rule 5: Validation+Firm Conflict', () => {
  test('HIGH validationIntensity + FIRM toneHint downgrades to GENTLE', () => {
    const result = enforceHintSemanticCoherence({
      validationIntensity: 'HIGH',
      toneHint: 'FIRM',
    });
    expect(result.toneHint).toBe('GENTLE');
    expect(result.validationIntensity).toBe('HIGH');
  });

  test('MEDIUM validationIntensity + FIRM toneHint stays FIRM', () => {
    const result = enforceHintSemanticCoherence({
      validationIntensity: 'MEDIUM',
      toneHint: 'FIRM',
    });
    expect(result.toneHint).toBe('FIRM');
  });
});

// =====================================================================
// G) Action SUGGEST_BREAK forces questionBudget ZERO
// =====================================================================

describe('HintSemanticGuard — Rule 6: Action vs Question', () => {
  test('SUGGEST_BREAK forces questionBudgetHint ZERO', () => {
    const result = enforceHintSemanticCoherence({
      actionHint: 'SUGGEST_BREAK',
      questionBudgetHint: 'ONE',
    });
    expect(result.questionBudgetHint).toBe('ZERO');
    expect(result.actionHint).toBe('SUGGEST_BREAK');
  });
});

// =====================================================================
// H) No appraisal leakage (integration)
// =====================================================================

describe('HintSemanticGuard — no appraisal leakage', () => {
  test('builder args contain no forbidden keys with guard ON', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(3, { collapseEvent: true, pressureScalar: 3.0, interruptionLevel: 2 }, HIGH_NEGATIVE),
      ...phase(3, { escalationLevel: 2, interruptionLevel: 2 }, HIGH_NEGATIVE),
      ...phase(4, {}, LOW_NEUTRAL),
    ];

    setGuardOn();
    const results = await runSequence(steps, { stepFn: buildStepFn(steps), captureBuilderArgs: true });

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
// I) Density never increases
// =====================================================================

describe('HintSemanticGuard — density never increases', () => {
  test('guard ON produces equal or fewer markers vs guard OFF', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(5, {
        escalationLevel: 2,
        pressureScalar: 2.5,
        pressureVolatility: 1.5,
        interruptionLevel: 2,
        toneMode: 'FIRM_CONTAIN',
        pacingMode: 'SHORT_DIRECT',
        actionMode: 'INTERRUPT_LOOP',
        validationMode: 'BOUNDARIED',
      }, HIGH_NEGATIVE),
      ...phase(3, { collapseEvent: true, pressureScalar: 3.0, interruptionLevel: 3 }, HIGH_NEGATIVE),
      ...phase(4, {}, LOW_NEUTRAL),
    ];

    setAdaptiveNoGuard();
    const offResults = await runSequence(steps, { stepFn: buildStepFn(steps) });

    setGuardOn();
    const onResults = await runSequence(steps, { stepFn: buildStepFn(steps) });

    for (let i = 0; i < offResults.length; i++) {
      expect(countMarkers(onResults[i].prompt)).toBeLessThanOrEqual(
        countMarkers(offResults[i].prompt),
      );
    }
  });

  test('golden replay hashes unchanged', () => {
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
