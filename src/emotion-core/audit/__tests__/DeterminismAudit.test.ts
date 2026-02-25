export {};

/**
 * PHASE 2 — Determinism & Replay Audit
 *
 * Proves the emotional engine produces identical outputs for identical inputs
 * across multiple runs, and that golden replay hashes remain unchanged.
 */

import {
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  makeAppraisalResult,
  runSequence,
  extractMarkers,
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

function enableAllFlags(): void {
  setFullAdaptiveOn();
  process.env.LORA_HINT_RESOLVER = '1';
  process.env.LORA_HINT_STICKINESS = '1';
  process.env.LORA_HINT_SEMANTIC_GUARD = '1';
  process.env.LORA_GUIDANCE_DWELL_LOCK = '1';
}

function buildStepFn(steps: StepSpec[]) {
  let idx = 0;
  return jest.fn(() => {
    const spec = steps[idx] ?? steps[steps.length - 1];
    idx++;
    return makeAppraisalResult(spec.appraisalOverrides);
  });
}

function buildFixedSequence(): StepSpec[] {
  const steps: StepSpec[] = [];
  steps.push({ text: 'hello', emotionalOverride: LOW_NEUTRAL });
  steps.push({ text: 'hello', emotionalOverride: LOW_NEUTRAL });

  const phases: { n: number; o: MockAppraisalOverrides; e: StepSpec['emotionalOverride'] }[] = [
    { n: 50, o: {}, e: LOW_NEUTRAL },
    { n: 30, o: { escalationLevel: 2, interruptionLevel: 2, pressureScalar: 2.5 }, e: HIGH_NEGATIVE },
    { n: 20, o: { collapseEvent: true, pressureScalar: 3.0 }, e: HIGH_NEGATIVE },
    { n: 30, o: { postClarityActive: true }, e: LOW_NEUTRAL },
    { n: 20, o: { escalationLevel: 1, toneMode: 'FIRM_CONTAIN', pacingMode: 'SLOW', actionMode: 'INTERRUPT_LOOP' }, e: HIGH_NEGATIVE },
    { n: 50, o: {}, e: LOW_NEUTRAL },
  ];

  for (const { n, o, e } of phases) {
    for (let i = 0; i < n; i++) steps.push({ text: 'test', appraisalOverrides: o, emotionalOverride: e });
  }
  return steps;
}

describe('Phase 2 — Determinism Audit', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('identical inputs produce identical prompts across two runs', async () => {
    const steps = buildFixedSequence();

    enableAllFlags();
    const runA = await runSequence(steps, { stepFn: buildStepFn(steps) });

    enableAllFlags();
    const runB = await runSequence(steps, { stepFn: buildStepFn(steps) });

    expect(runA.length).toBe(runB.length);
    for (let i = 0; i < runA.length; i++) {
      expect(runB[i].prompt).toBe(runA[i].prompt);
    }
  });

  test('marker lists identical across two runs', async () => {
    const steps = buildFixedSequence();

    enableAllFlags();
    const runA = await runSequence(steps, { stepFn: buildStepFn(steps) });

    enableAllFlags();
    const runB = await runSequence(steps, { stepFn: buildStepFn(steps) });

    for (let i = 0; i < runA.length; i++) {
      expect(extractMarkers(runB[i].prompt)).toEqual(extractMarkers(runA[i].prompt));
    }
  });

  test('decision payload optional keys stable across runs', async () => {
    const steps = buildFixedSequence();
    const OPTIONAL_KEYS = [
      'pacingHint', 'toneHint', 'validationIntensity', 'validationHint',
      'actionHint', 'interruptHint', 'stepHint', 'questionBudgetHint',
      'appraisalOverride', 'overrideCooldownActive', 'driftDetected',
      'guidanceDwellActive', 'guidanceDwellMode',
    ];

    enableAllFlags();
    const runA = await runSequence(steps, { stepFn: buildStepFn(steps) });

    enableAllFlags();
    const runB = await runSequence(steps, { stepFn: buildStepFn(steps) });

    for (let i = 0; i < runA.length; i++) {
      for (const key of OPTIONAL_KEYS) {
        expect(runB[i].payload[key]).toEqual(runA[i].payload[key]);
      }
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
      const result = runReplayFromFile(path.join(dir, file));
      expect(result.hash).toBe(hash);
    }
  });
});
