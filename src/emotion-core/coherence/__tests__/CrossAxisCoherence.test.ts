export {};

import {
  makeAppraisalResult,
  setBaseline,
  setAdaptiveOn,
  saveEnv,
  restoreEnv,
  runSequence,
  countTransitions,
  extractMarkers,
  type StepSpec,
  type MockAppraisalOverrides,
} from './coherenceHarness';

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

// ── Shared emotional overrides ──────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────

function neutralSteps(n: number): StepSpec[] {
  return Array.from({ length: n }, () => ({
    text: 'things are fine',
    emotionalOverride: LOW_NEUTRAL,
  }));
}

function stepsWithAppraisal(n: number, overrides: MockAppraisalOverrides, emotional?: StepSpec['emotionalOverride']): StepSpec[] {
  return Array.from({ length: n }, () => ({
    text: 'test',
    appraisalOverrides: overrides,
    emotionalOverride: emotional ?? LOW_NEUTRAL,
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

// ── T1: Flag-OFF Baseline Identity ──────────────────────────────────

describe('T1 — Flag-OFF baseline identity', () => {
  test('50 steps with baseline vs adaptive-on+neutral produce identical prompts and no adaptive keys', async () => {
    const specs = neutralSteps(50);

    setBaseline();
    const baselineResults = await runSequence(specs);

    setAdaptiveOn();
    const neutralResult = makeAppraisalResult();
    const stepFn = jest.fn().mockReturnValue(neutralResult);
    const adaptiveResults = await runSequence(specs, { stepFn });

    for (let i = 0; i < 50; i++) {
      expect(adaptiveResults[i].prompt).toBe(baselineResults[i].prompt);
      expect(extractMarkers(adaptiveResults[i].prompt)).toEqual([]);

      const p = adaptiveResults[i].payload;
      expect(p.pacingHint).toBeUndefined();
      expect(p.toneHint).toBeUndefined();
      expect(p.validationIntensity).toBeUndefined();
      expect(p.appraisalOverride).toBeUndefined();
      expect(p.overrideCooldownActive).toBeUndefined();
      expect(p.driftDetected).toBeUndefined();
    }
  });
});

// ── T2: No Contradictory Styling Under Collapse ─────────────────────

describe('T2 — No contradictory styling under collapse', () => {
  test('collapse at step 3 produces coherent STABILIZE + GENTLE + SLOW, then cooldown suppresses', async () => {
    const collapseOverrides: MockAppraisalOverrides = { collapseEvent: true, pressureScalar: 3.0 };
    const specs: StepSpec[] = [
      // Steps 0-1: warm-up (horizon)
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      { text: 'hello', emotionalOverride: LOW_NEUTRAL },
      // Step 2 (message 3): collapse
      { text: 'I feel lost', appraisalOverrides: collapseOverrides, emotionalOverride: LOW_NEUTRAL },
      // Steps 3-4: collapse continues (cooldown should suppress override)
      { text: 'still lost', appraisalOverrides: collapseOverrides, emotionalOverride: LOW_NEUTRAL },
      { text: 'very lost', appraisalOverrides: collapseOverrides, emotionalOverride: LOW_NEUTRAL },
      // Step 5: cooldown expired, override can fire again
      { text: 'completely lost', appraisalOverrides: collapseOverrides, emotionalOverride: LOW_NEUTRAL },
    ];

    setAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    // Steps 0-1: no adaptive features (horizon)
    expect(results[0].payload.appraisalOverride).toBeUndefined();
    expect(results[1].payload.appraisalOverride).toBeUndefined();

    // Step 2 (message 3): override fires
    expect(results[2].payload.promptProfile.guidanceMode).toBe('STABILIZE');
    expect(results[2].payload.appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(results[2].payload.toneHint).toBe('GENTLE');
    expect(results[2].payload.pacingHint).toBe('SLOW');
    expect(results[2].prompt).toContain('[TONE_HINT:GENTLE]');
    expect(results[2].prompt).toContain('[PACING_HINT:SLOW]');

    // Steps 3-4 (messages 4-5): cooldown suppresses override
    expect(results[3].payload.overrideCooldownActive).toBe(true);
    expect(results[3].payload.appraisalOverride).toBeUndefined();
    expect(results[4].payload.overrideCooldownActive).toBe(true);
    expect(results[4].payload.appraisalOverride).toBeUndefined();

    // During cooldown, pacingHint still operates (collapse pressure triggers SLOW)
    expect(results[3].payload.pacingHint).toBe('SLOW');

    // During cooldown, toneHint still fires because escalation/collapse conditions
    // are checked independently of override. collapse.event=true → escalation.level
    // check happens first in toneHint; then the appraisalResult.escalation.level >= 2
    // check doesn't apply (escalation.level=0), but guidanceMode may not be STABILIZE
    // during cooldown. However, the appraisalResult is still available, so at least
    // GENTLE should not appear as FIRM.
    if (results[3].payload.toneHint !== undefined) {
      expect(results[3].payload.toneHint).not.toBe('FIRM');
    }

    // Step 5 (message 6): cooldown expired, override fires again
    expect(results[5].payload.appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(results[5].payload.overrideCooldownActive).toBeUndefined();
  });
});

// ── T3: No Tone Whiplash Under Escalation ───────────────────────────

describe('T3 — No tone whiplash under escalation with cooldown', () => {
  test('escalation level=2 for 20 steps: toneHint stays GENTLE, cooldown pattern correct', async () => {
    const warmUp: StepSpec[] = neutralSteps(2);
    const escalated: StepSpec[] = stepsWithAppraisal(20, { escalationLevel: 2 });
    const calm: StepSpec[] = neutralSteps(5);
    const specs = [...warmUp, ...escalated, ...calm];

    setAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    // Escalation window: steps 2–21 (messages 3–22)
    const escalationWindow = results.slice(2, 22);

    // toneHint must be GENTLE throughout escalation (never FIRM)
    for (const step of escalationWindow) {
      if (step.payload.toneHint !== undefined) {
        expect(step.payload.toneHint).toBe('GENTLE');
      }
    }

    // FIRM must never appear while guidanceMode is STABILIZE or DE_ESCALATE
    for (const step of escalationWindow) {
      const mode = step.payload.promptProfile.guidanceMode;
      if (mode === 'STABILIZE' || mode === 'DE_ESCALATE') {
        expect(step.payload.toneHint).not.toBe('FIRM');
      }
    }

    // Cooldown pattern: override fires first, then suppressed 2 msgs, then fires again
    expect(escalationWindow[0].payload.appraisalOverride).toBe('ESCALATION_OVERRIDE');
    expect(escalationWindow[1].payload.overrideCooldownActive).toBe(true);
    expect(escalationWindow[2].payload.overrideCooldownActive).toBe(true);
    expect(escalationWindow[3].payload.appraisalOverride).toBe('ESCALATION_OVERRIDE');
  });
});

// ── T4: InterruptionLevel FIRM Only When Not Stabilizing ────────────

describe('T4 — InterruptionLevel FIRM only when not stabilizing', () => {
  test('interruptionLevel >= 2 produces FIRM only when not in STABILIZE/DE_ESCALATE', async () => {
    const warmUp: StepSpec[] = neutralSteps(2);
    const firmPhase: StepSpec[] = stepsWithAppraisal(30, { interruptionLevel: 2 });
    const specs = [...warmUp, ...firmPhase];

    setAdaptiveOn();
    const stepFn = buildStepFn(specs);
    const results = await runSequence(specs, { stepFn });

    const activeWindow = results.slice(2);

    for (const step of activeWindow) {
      const mode = step.payload.promptProfile.guidanceMode;
      const tone = step.payload.toneHint;

      if (mode === 'STABILIZE' || mode === 'DE_ESCALATE') {
        expect(tone).not.toBe('FIRM');
      }

      if (tone === 'FIRM') {
        expect(mode).not.toBe('STABILIZE');
        expect(mode).not.toBe('DE_ESCALATE');
        expect(step.prompt).toContain('[TONE_HINT:FIRM]');
      }
    }

    // FIRM must appear at least once
    const firmSteps = activeWindow.filter((s) => s.payload.toneHint === 'FIRM');
    expect(firmSteps.length).toBeGreaterThanOrEqual(1);
  });
});

// ── T5: Drift Monitor Independence + No Early Warnings ──────────────

describe('T5 — Drift monitor independence + stability horizon', () => {
  test('no drift in first 2 messages; drift fires after horizon under oscillation', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      return callIdx % 2 === 0
        ? makeAppraisalResult({ collapseEvent: true })
        : makeAppraisalResult();
    });

    const specs: StepSpec[] = Array.from({ length: 14 }, () => ({
      text: 'msg',
      emotionalOverride: LOW_NEUTRAL,
    }));

    setAdaptiveOn();
    const results = await runSequence(specs, { stepFn });

    // Messages 1-2 (index 0-1): no driftDetected
    expect(results[0].payload.driftDetected).toBeUndefined();
    expect(results[1].payload.driftDetected).toBeUndefined();

    // After horizon, drift may eventually fire (once per unstable window)
    const postHorizon = results.slice(2);
    const driftSteps = postHorizon.filter((s) => s.payload.driftDetected === true);
    expect(driftSteps.length).toBeGreaterThanOrEqual(1);
  });
});

// ── T6: Long-Session Coherence (500+ steps) ─────────────────────────

describe('T6 — Long-session coherence (500 steps)', () => {
  test('bounded transitions, no contradictions across lifecycle phases', async () => {
    const steps: StepSpec[] = [];

    // Phase 1 (1–100): calm baseline
    for (let i = 0; i < 100; i++) {
      steps.push({ text: 'all is well', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL });
    }
    // Phase 2 (101–160): rising escalation
    for (let i = 0; i < 60; i++) {
      const level = i < 30 ? 1 : 2;
      steps.push({
        text: 'things are getting tense',
        appraisalOverrides: { escalationLevel: level, pressureScalar: 1.5 + i * 0.02 },
        emotionalOverride: HIGH_NEGATIVE,
      });
    }
    // Phase 3 (161–180): collapse spike
    for (let i = 0; i < 20; i++) {
      steps.push({
        text: 'everything is falling apart',
        appraisalOverrides: { collapseEvent: true, pressureScalar: 3.5 },
        emotionalOverride: HIGH_NEGATIVE,
      });
    }
    // Phase 4 (181–260): postClarity recovery
    for (let i = 0; i < 80; i++) {
      steps.push({
        text: 'I think I understand now',
        appraisalOverrides: { postClarityActive: true },
        emotionalOverride: LOW_NEUTRAL,
      });
    }
    // Phase 5 (261–500): calm rebuild
    for (let i = 0; i < 240; i++) {
      steps.push({ text: 'rebuilding', appraisalOverrides: {}, emotionalOverride: LOW_NEUTRAL });
    }

    setAdaptiveOn();
    const stepFn = buildStepFn(steps);

    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await runSequence(steps, { stepFn });

    // Assertion 1: guidanceMode transitions bounded across 500 steps
    const allModes = results.map((s) => s.payload.promptProfile.guidanceMode);
    const transitions = countTransitions(allModes);
    expect(transitions).toBeLessThanOrEqual(120);

    // Assertion 2: pacingHint SLOW must not appear in calm rebuild (phase 5)
    const calmRebuild = results.slice(260);
    for (const step of calmRebuild) {
      expect(step.payload.pacingHint).toBeUndefined();
    }

    // Assertion 3: validationIntensity not present during calm phase 1 (LOW arousal, low EIV)
    const calmPhase1 = results.slice(2, 100);
    for (const step of calmPhase1) {
      expect(step.payload.validationIntensity).toBeUndefined();
    }

    // Assertion 4: toneHint FIRM must not appear during collapse/escalation/postClarity
    const collapseWindow = results.slice(160, 180);
    for (const step of collapseWindow) {
      expect(step.payload.toneHint).not.toBe('FIRM');
    }
    const postClarityWindow = results.slice(180, 260);
    for (const step of postClarityWindow) {
      expect(step.payload.toneHint).not.toBe('FIRM');
    }

    // Assertion 5: no raw appraisal data patterns leak into prompt text
    for (const step of results) {
      for (const key of ['escalationLevel', 'pressureScalar', 'interventionToneMode', 'AppraisalResult']) {
        expect(step.prompt).not.toContain(key);
      }
    }
  }, 60000);
});

// ── Phase 3D: Golden Replay Smoke ───────────────────────────────────

describe('Golden replay hashes unchanged', () => {
  test('all 4 fixtures produce original golden hashes', () => {
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
