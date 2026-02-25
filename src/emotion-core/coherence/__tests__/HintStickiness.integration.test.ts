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
  type MockAppraisalOverrides,
} from './coherenceHarness';

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

function setAllFlagsWithStickiness(): void {
  setFullAdaptiveOn();
  process.env.LORA_HINT_STICKINESS = '1';
}

function setAllFlagsNoStickiness(): void {
  setFullAdaptiveOn();
  delete process.env.LORA_HINT_STICKINESS;
}

function setAllFlagsWithBothResolverAndStickiness(): void {
  setFullAdaptiveOn();
  process.env.LORA_HINT_RESOLVER = '1';
  process.env.LORA_HINT_STICKINESS = '1';
}

// =====================================================================
// 1) Prompt identity when stickiness flag OFF
// =====================================================================

describe('HintStickiness — flag OFF identity', () => {
  test('prompts are byte-identical when stickiness flag is OFF', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(4, { escalationLevel: 2, interruptionLevel: 2, pressureScalar: 2.5 }, HIGH_NEGATIVE),
      ...phase(3, { collapseEvent: true, pressureScalar: 3.0 }, HIGH_NEGATIVE),
      ...phase(3, { postClarityActive: true }, LOW_NEUTRAL),
      ...phase(5, {}, LOW_NEUTRAL),
    ];

    // Run A: all adaptive flags ON, stickiness OFF
    setAllFlagsNoStickiness();
    const stepFnA = buildStepFn(steps);
    const resultsA = await runSequence(steps, { stepFn: stepFnA });

    // Run B: same
    setAllFlagsNoStickiness();
    const stepFnB = buildStepFn(steps);
    const resultsB = await runSequence(steps, { stepFn: stepFnB });

    for (let i = 0; i < resultsA.length; i++) {
      expect(resultsB[i].prompt).toBe(resultsA[i].prompt);
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

// =====================================================================
// 2) Stickiness preserves pacingHint for 2 extra messages
// =====================================================================

describe('HintStickiness — pacingHint hysteresis', () => {
  test('pacingHint SLOW persists for 2 messages after signal drops', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // 2 warm-up + alternating: SLOW trigger on, off, off, on, off, off, off, off, off, off
    // With hold=2, after SLOW appears it should stick for 2 extra messages
    const steps: StepSpec[] = [
      ...warmUp(),
      // msg 3: escalation → SLOW
      { text: 'angry', appraisalOverrides: { escalationLevel: 2, pressureScalar: 2.5 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 4: neutral (no trigger) → sticky SLOW (hold 2→1)
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 5: neutral → sticky SLOW (hold 1→0)
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 6: neutral → hold expired, SLOW should disappear
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 7: neutral → still no SLOW
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    setAllFlagsWithStickiness();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    // msg 3 (index 2): SLOW active from escalation
    expect(results[2].prompt).toContain('[PACING_HINT:SLOW]');
    expect(results[2].payload.pacingHint).toBe('SLOW');

    // msg 4 (index 3): sticky — still SLOW
    expect(results[3].prompt).toContain('[PACING_HINT:SLOW]');
    expect(results[3].payload.pacingHint).toBe('SLOW');

    // msg 5 (index 4): sticky — still SLOW
    expect(results[4].prompt).toContain('[PACING_HINT:SLOW]');
    expect(results[4].payload.pacingHint).toBe('SLOW');

    // msg 6 (index 5): hold expired
    expect(results[5].prompt).not.toContain('[PACING_HINT:SLOW]');
    expect(results[5].payload.pacingHint).toBeUndefined();

    // msg 7 (index 6): still gone
    expect(results[6].prompt).not.toContain('[PACING_HINT:SLOW]');
    expect(results[6].payload.pacingHint).toBeUndefined();
  });
});

// =====================================================================
// 3) Marker density still capped when resolver + stickiness both enabled
// =====================================================================

describe('HintStickiness — density cap with resolver', () => {
  test('resolver cap <= 5 still respected when stickiness enabled', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(10, {
        escalationLevel: 2,
        pressureScalar: 2.5,
        pressureVolatility: 1.5,
        interruptionLevel: 2,
        toneMode: 'FIRM_CONTAIN',
        pacingMode: 'SHORT_DIRECT',
        actionMode: 'INTERRUPT_LOOP',
        validationMode: 'BOUNDARIED',
      }, HIGH_NEGATIVE),
      ...phase(5, { collapseEvent: true, pressureScalar: 3.0, interruptionLevel: 3 }, HIGH_NEGATIVE),
      ...phase(5, {}, LOW_NEUTRAL),
    ];

    setAllFlagsWithBothResolverAndStickiness();
    const stepFn = buildStepFn(steps);
    const results = await runSequence(steps, { stepFn });

    for (let i = 2; i < results.length; i++) {
      // Double-resolve pattern: resolver runs again after stickiness → hard cap <=5
      expect(countMarkers(results[i].prompt)).toBeLessThanOrEqual(5);
    }
  });
});

// =====================================================================
// 4) No forbidden appraisal keys in builder args
// =====================================================================

describe('HintStickiness — no appraisal leakage', () => {
  test('builder args never contain forbidden keys with stickiness ON', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(5, { collapseEvent: true, pressureScalar: 3.0, interruptionLevel: 2 }, HIGH_NEGATIVE),
      ...phase(5, { escalationLevel: 2, interruptionLevel: 2 }, HIGH_NEGATIVE),
      ...phase(5, {}, LOW_NEUTRAL),
    ];

    setAllFlagsWithStickiness();
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
// 5) Session reset clears sticky state
// =====================================================================

describe('HintStickiness — session reset', () => {
  test('sticky hints do not leak across sessions', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    setAllFlagsWithStickiness();

    const allSteps: StepSpec[] = [
      // Session 1: warm-up + 1 escalation trigger
      ...warmUp(),
      { text: 'angry', appraisalOverrides: { escalationLevel: 2, pressureScalar: 2.5 }, emotionalOverride: HIGH_NEGATIVE },
      // Session 2 (after endSession): warm-up + 1 neutral
      ...warmUp(),
      { text: 'hello', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    let callIdx = 0;
    const stepFn = jest.fn(() => {
      const spec = allSteps[callIdx] ?? allSteps[allSteps.length - 1];
      callIdx++;
      return makeAppraisalResult(spec.appraisalOverrides);
    });

    const { loadModules } = require('./coherenceHarness') as typeof import('./coherenceHarness');
    const { EngineOrchestrator, InputProcessor } = loadModules(stepFn);
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // --- Session 1 (3 messages) ---
    for (let i = 0; i < 3; i++) {
      const spec = allSteps[i];
      const { analyzerOutputs, signalPacket } = InputProcessor.process(spec.text);
      await engine.processMessage(
        analyzerOutputs,
        spec.emotionalOverride,
        false,
        {},
        undefined,
        signalPacket,
      );
    }

    // Session 1 msg 3 should have SLOW
    const s1Calls = logSpy.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]')
    );
    const s1LastPayload = s1Calls.length > 0 ? JSON.parse(s1Calls[s1Calls.length - 1][1]) : {};
    expect(s1LastPayload.pacingHint).toBe('SLOW');

    engine.endSession();
    logSpy.mockClear();

    // --- Session 2 (3 messages, all neutral) ---
    for (let i = 3; i < 6; i++) {
      const spec = allSteps[i];
      const { analyzerOutputs, signalPacket } = InputProcessor.process(spec.text);
      await engine.processMessage(
        analyzerOutputs,
        spec.emotionalOverride,
        false,
        {},
        undefined,
        signalPacket,
      );
    }

    // Session 2 msg 3 — no SLOW should persist
    const s2Calls = logSpy.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]')
    );
    const s2LastPayload = s2Calls.length > 0 ? JSON.parse(s2Calls[s2Calls.length - 1][1]) : {};
    expect(s2LastPayload.pacingHint).toBeUndefined();

    logSpy.mockRestore();
  });
});
