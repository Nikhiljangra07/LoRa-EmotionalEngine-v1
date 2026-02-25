export {};

import {
  makeAppraisalResult,
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  runSequence,
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

function setDwellOn(): void {
  setFullAdaptiveOn();
  process.env.LORA_GUIDANCE_DWELL_LOCK = '1';
}

function setAdaptiveNoDwell(): void {
  setFullAdaptiveOn();
  delete process.env.LORA_GUIDANCE_DWELL_LOCK;
}

// =====================================================================
// A) Flag OFF → prompt identity
// =====================================================================

describe('GuidanceDwellLock — flag OFF identity', () => {
  test('prompts byte-identical when dwell lock OFF', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(3, { escalationLevel: 2, pressureScalar: 2.5 }, HIGH_NEGATIVE),
      ...phase(3, { collapseEvent: true, pressureScalar: 3.0 }, HIGH_NEGATIVE),
      ...phase(4, {}, LOW_NEUTRAL),
    ];

    setAdaptiveNoDwell();
    const resultsA = await runSequence(steps, { stepFn: buildStepFn(steps) });

    setAdaptiveNoDwell();
    const resultsB = await runSequence(steps, { stepFn: buildStepFn(steps) });

    for (let i = 0; i < resultsA.length; i++) {
      expect(resultsB[i].prompt).toBe(resultsA[i].prompt);
    }

    // No dwell keys in payloads
    for (const step of resultsA) {
      expect(step.payload.guidanceDwellActive).toBeUndefined();
      expect(step.payload.guidanceDwellMode).toBeUndefined();
    }
  });
});

// =====================================================================
// B) Horizon gate — messages 1–2 never show dwell
// =====================================================================

describe('GuidanceDwellLock — horizon gate', () => {
  test('messages 1–2 never have dwell keys even with triggers', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      // msg 1: collapse trigger (before horizon)
      { text: 'crisis', appraisalOverrides: { collapseEvent: true, pressureScalar: 3.0 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 2: escalation trigger (before horizon)
      { text: 'angry', appraisalOverrides: { escalationLevel: 2, pressureScalar: 2.5 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 3: neutral
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    setDwellOn();
    const results = await runSequence(steps, { stepFn: buildStepFn(steps) });

    expect(results[0].payload.guidanceDwellActive).toBeUndefined();
    expect(results[0].payload.guidanceDwellMode).toBeUndefined();
    expect(results[1].payload.guidanceDwellActive).toBeUndefined();
    expect(results[1].payload.guidanceDwellMode).toBeUndefined();
  });
});

// =====================================================================
// C) Lock engages — DE_ESCALATE holds for next message
// =====================================================================

describe('GuidanceDwellLock — lock engages', () => {
  test('DE_ESCALATE lock holds mode against neutral proposal', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      // msg 3: escalation → DE_ESCALATE (starts dwell, remaining=1)
      { text: 'angry', appraisalOverrides: { escalationLevel: 2, pressureScalar: 2.5 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 4: neutral, but dwell forces DE_ESCALATE (remaining 1→0, dwellActive=true)
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 5: neutral, dwell expired → normal mode
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    setDwellOn();
    const results = await runSequence(steps, { stepFn: buildStepFn(steps) });

    // msg 3 (index 2): DE_ESCALATE starts, dwell begins but not forcing (proposed === locked)
    expect(results[2].payload.promptProfile?.guidanceMode).toBe('DE_ESCALATE');
    expect(results[2].payload.guidanceDwellActive).toBeUndefined();

    // msg 4 (index 3): neutral would change mode, but dwell forces DE_ESCALATE
    expect(results[3].payload.promptProfile?.guidanceMode).toBe('DE_ESCALATE');
    expect(results[3].payload.guidanceDwellActive).toBe(true);
    expect(results[3].payload.guidanceDwellMode).toBe('DE_ESCALATE');

    // msg 5 (index 4): dwell expired — mode is whatever baseline selects
    expect(results[4].payload.guidanceDwellActive).toBeUndefined();
  });
});

// =====================================================================
// D) STABILIZE supersedes DE_ESCALATE
// =====================================================================

describe('GuidanceDwellLock — emergency escalation', () => {
  test('collapse during DE_ESCALATE dwell upgrades to STABILIZE', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      // msg 3: escalation → DE_ESCALATE (starts dwell)
      { text: 'angry', appraisalOverrides: { escalationLevel: 2, pressureScalar: 2.5 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 4: collapse event while locked in DE_ESCALATE → STABILIZE emergency
      { text: 'crash', appraisalOverrides: { collapseEvent: true, pressureScalar: 3.0 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 5: STABILIZE dwell should hold (remaining was set to 2)
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 6: still locked in STABILIZE
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
      // msg 7: dwell expired
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    setDwellOn();
    const results = await runSequence(steps, { stepFn: buildStepFn(steps) });

    // msg 3 (index 2): DE_ESCALATE starts dwell
    expect(results[2].payload.promptProfile?.guidanceMode).toBe('DE_ESCALATE');

    // msg 4 (index 3): collapse triggers emergency → STABILIZE
    expect(results[3].payload.promptProfile?.guidanceMode).toBe('STABILIZE');
    expect(results[3].payload.guidanceDwellActive).toBe(true);
    expect(results[3].payload.guidanceDwellMode).toBe('STABILIZE');

    // msg 5 (index 4): STABILIZE dwell holds
    expect(results[4].payload.promptProfile?.guidanceMode).toBe('STABILIZE');
    expect(results[4].payload.guidanceDwellActive).toBe(true);
    expect(results[4].payload.guidanceDwellMode).toBe('STABILIZE');

    // msg 6 (index 5): still STABILIZE (remaining was 2, now 0)
    expect(results[5].payload.promptProfile?.guidanceMode).toBe('STABILIZE');

    // msg 7 (index 6): dwell expired
    expect(results[6].payload.guidanceDwellActive).toBeUndefined();
  });
});

// =====================================================================
// E) STABILIZE does not downgrade early
// =====================================================================

describe('GuidanceDwellLock — STABILIZE holds', () => {
  test('STABILIZE dwell prevents early downgrade to DE_ESCALATE', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      // msg 3: collapse → STABILIZE (starts dwell, remaining=2)
      { text: 'crash', appraisalOverrides: { collapseEvent: true, pressureScalar: 3.0 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 4: escalation only (no collapse) → would propose DE_ESCALATE, but dwell forces STABILIZE
      { text: 'angry', appraisalOverrides: { escalationLevel: 2, pressureScalar: 2.5 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 5: still in dwell → STABILIZE
      { text: 'upset', appraisalOverrides: { escalationLevel: 2, pressureScalar: 2.0 }, emotionalOverride: HIGH_NEGATIVE },
      // msg 6: dwell expired
      { text: 'calm', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL },
    ];

    setDwellOn();
    const results = await runSequence(steps, { stepFn: buildStepFn(steps) });

    // msg 3 (index 2): STABILIZE starts dwell
    expect(results[2].payload.promptProfile?.guidanceMode).toBe('STABILIZE');
    expect(results[2].payload.guidanceDwellActive).toBeUndefined();

    // msg 4 (index 3): dwell forces STABILIZE against DE_ESCALATE
    expect(results[3].payload.promptProfile?.guidanceMode).toBe('STABILIZE');
    expect(results[3].payload.guidanceDwellActive).toBe(true);
    expect(results[3].payload.guidanceDwellMode).toBe('STABILIZE');

    // msg 5 (index 4): still STABILIZE
    expect(results[4].payload.promptProfile?.guidanceMode).toBe('STABILIZE');

    // msg 6 (index 5): dwell expired
    expect(results[5].payload.guidanceDwellActive).toBeUndefined();
  });
});

// =====================================================================
// F) No appraisal leakage
// =====================================================================

describe('GuidanceDwellLock — no appraisal leakage', () => {
  test('builder args contain no forbidden keys with dwell ON', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const steps: StepSpec[] = [
      ...warmUp(),
      ...phase(3, { collapseEvent: true, pressureScalar: 3.0 }, HIGH_NEGATIVE),
      ...phase(3, { escalationLevel: 2, pressureScalar: 2.5 }, HIGH_NEGATIVE),
      ...phase(4, {}, LOW_NEUTRAL),
    ];

    setDwellOn();
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
// G) Golden replay hashes unchanged
// =====================================================================

describe('GuidanceDwellLock — golden replay unchanged', () => {
  test('golden replay hashes remain stable', () => {
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
