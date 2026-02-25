export {};

/**
 * ChaosFuzzer — 10,000-step seeded chaos fuzz for LoRa emotion-core.
 *
 * Gated behind LORA_CHAOS_FUZZER=1. Deterministic via mulberry32 PRNG
 * seeded from LORA_CHAOS_SEED (default "1337"). Asserts cross-signal
 * stability invariants without modifying any runtime code.
 */

import {
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  makeAppraisalResult,
  countTransitions,
  APPRAISAL_FORBIDDEN_KEYS,
  type StepSpec,
  type CapturedStep,
  type MockAppraisalOverrides,
} from './coherenceHarness';

// ── Gate ─────────────────────────────────────────────────────────────

const FUZZ_ENABLED = process.env.LORA_CHAOS_FUZZER === '1';

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Emotional state presets ──────────────────────────────────────────

const EMOTIONAL_PRESETS: StepSpec['emotionalOverride'][] = [
  { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.5 },
  { dominant: 'SADNESS', arousal: 'MEDIUM', valence: 'NEGATIVE', confidence: 0.7 },
  { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
  { dominant: 'FEAR', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.8 },
  { dominant: 'JOY', arousal: 'MEDIUM', valence: 'POSITIVE', confidence: 0.6 },
];

// ── Intervention policy value pools ──────────────────────────────────

const TONE_MODES = ['NEUTRAL', 'STABILIZE', 'DE_ESCALATE', 'REFLECTIVE', 'AFFIRM_BOUNDARIED', 'FIRM_CONTAIN'];
const PACING_MODES = ['NORMAL', 'SLOW', 'DELAYED_RESPONSE', 'SHORT_DIRECT'];
const VALIDATION_MODES = ['STANDARD', 'SUPPORTIVE', 'BOUNDARIED', 'LIMITED'];
const ACTION_MODES = ['NONE', 'INTERRUPT_LOOP', 'SHIFT_TO_REFLECTION', 'ENCOURAGE_PAUSE'];

// ── Step generator ───────────────────────────────────────────────────

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function generateSteps(count: number, rand: () => number): StepSpec[] {
  const steps: StepSpec[] = [];

  // 2 warm-up neutral steps
  for (let i = 0; i < 2; i++) {
    steps.push({ text: 'hello', emotionalOverride: EMOTIONAL_PRESETS[0] });
  }

  for (let i = 0; i < count; i++) {
    const r = rand();

    let overrides: MockAppraisalOverrides;

    if (r < 0.03) {
      // ~3% collapse events
      overrides = {
        collapseEvent: true,
        collapseSeverity: 0.5 + rand() * 0.5,
        escalationLevel: pick([0, 1, 2], rand),
        pressureScalar: 2.0 + rand() * 1.5,
        pressureVolatility: 0.5 + rand() * 1.5,
        interruptionLevel: pick([0, 1, 2, 3] as const, rand),
        postClarityActive: false,
        toneMode: pick(TONE_MODES, rand),
        pacingMode: pick(PACING_MODES, rand),
        validationMode: pick(VALIDATION_MODES, rand),
        actionMode: pick(ACTION_MODES, rand),
      };
    } else if (r < 0.18) {
      // ~15% escalation
      overrides = {
        collapseEvent: false,
        escalationLevel: pick([2, 3], rand),
        escalationScore: 0.5 + rand() * 0.5,
        pressureScalar: 1.0 + rand() * 2.0,
        pressureVolatility: 0.3 + rand() * 1.2,
        interruptionLevel: pick([1, 2, 3] as const, rand),
        postClarityActive: false,
        toneMode: pick(TONE_MODES, rand),
        pacingMode: pick(PACING_MODES, rand),
        validationMode: pick(VALIDATION_MODES, rand),
        actionMode: pick(ACTION_MODES, rand),
      };
    } else if (r < 0.25) {
      // ~7% post-clarity
      overrides = {
        collapseEvent: false,
        escalationLevel: pick([0, 1], rand),
        pressureScalar: 0.2 + rand() * 0.8,
        pressureVolatility: rand() * 0.3,
        interruptionLevel: pick([0, 1] as const, rand),
        postClarityActive: true,
        toneMode: pick(['NEUTRAL', 'REFLECTIVE'], rand),
        pacingMode: pick(['NORMAL', 'SLOW'], rand),
        validationMode: pick(['STANDARD', 'SUPPORTIVE'], rand),
        actionMode: pick(['NONE', 'SHIFT_TO_REFLECTION'], rand),
      };
    } else if (r < 0.45) {
      // ~20% moderate stress
      overrides = {
        collapseEvent: false,
        escalationLevel: pick([0, 1], rand),
        pressureScalar: 0.5 + rand() * 1.5,
        pressureVolatility: 0.1 + rand() * 0.8,
        interruptionLevel: pick([0, 1, 2] as const, rand),
        postClarityActive: false,
        toneMode: pick(TONE_MODES, rand),
        pacingMode: pick(PACING_MODES, rand),
        validationMode: pick(VALIDATION_MODES, rand),
        actionMode: pick(ACTION_MODES, rand),
      };
    } else {
      // ~55% calm baseline
      overrides = {
        collapseEvent: false,
        escalationLevel: 0,
        pressureScalar: rand() * 0.5,
        pressureVolatility: rand() * 0.1,
        interruptionLevel: 0,
        postClarityActive: false,
        toneMode: 'NEUTRAL',
        pacingMode: 'NORMAL',
        validationMode: 'STANDARD',
        actionMode: 'NONE',
      };
    }

    steps.push({
      text: 'fuzz',
      emotionalOverride: pick(EMOTIONAL_PRESETS, rand),
      appraisalOverrides: overrides,
    });
  }

  return steps;
}

// ── Build step function (mirrors harness pattern) ────────────────────

function buildFuzzStepFn(steps: StepSpec[]) {
  let idx = 0;
  return jest.fn(() => {
    const spec = steps[idx] ?? steps[steps.length - 1];
    idx++;
    return makeAppraisalResult(spec.appraisalOverrides);
  });
}

// ── Invariant helpers ────────────────────────────────────────────────

interface Violation {
  step: number;
  guidanceMode: string;
  markers: string[];
  rule: string;
}

function hasMarker(markers: string[], prefix: string, value: string): boolean {
  return markers.includes(`[${prefix}:${value}]`);
}

function hasAnyMarkerPrefix(markers: string[], prefix: string): boolean {
  return markers.some((m) => m.startsWith(`[${prefix}:`));
}

// ── Main test ────────────────────────────────────────────────────────

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

(FUZZ_ENABLED ? describe : describe.skip)('ChaosFuzzer — 10k seeded chaos', () => {
  it('10k-step seeded chaos fuzz maintains invariants', async () => {
    jest.setTimeout(120_000);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Setup all flags
    setFullAdaptiveOn();
    process.env.LORA_HINT_RESOLVER = '1';
    process.env.LORA_HINT_STICKINESS = '1';
    process.env.LORA_HINT_SEMANTIC_GUARD = '1';
    process.env.LORA_GUIDANCE_DWELL_LOCK = '1';

    // Deterministic step generation
    const seedStr = process.env.LORA_CHAOS_SEED ?? '1337';
    const seed = parseInt(seedStr, 10) || 1337;
    const rand = mulberry32(seed);

    const STEP_COUNT = 10_000;
    const HORIZON = 3;

    const steps = generateSteps(STEP_COUNT, rand);

    // Run sequence — capture builder args for first 200 steps only (perf)
    const stepFn = buildFuzzStepFn(steps);

    // Use loadModules + manual loop to avoid capturing 10k builder args
    jest.resetModules();
    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: stepFn,
        reset: jest.fn(),
      })),
    }));
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));

    const { EngineOrchestrator } = require('../../engines/EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');
    const { PromptTemplateBuilder } = require('../../prompt/PromptTemplateBuilder');

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const MARKER_PATTERN = /\[([A-Z_]+):([A-Z_]+)\]/g;
    function extractMarkersLocal(prompt: string): string[] {
      const markers: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = MARKER_PATTERN.exec(prompt)) !== null) {
        markers.push(m[0]);
      }
      return markers;
    }

    const violations: Violation[] = [];
    const guidanceModes: string[] = [];
    let driftCount = 0;
    let maxMarkerCount = 0;
    const BUILDER_ARGS_CHECK_LIMIT = 200;

    for (let i = 0; i < steps.length; i++) {
      const spec = steps[i];
      const { analyzerOutputs, signalPacket } = InputProcessor.process(spec.text ?? 'fuzz');
      const result = await engine.processMessage(
        analyzerOutputs,
        spec.emotionalOverride,
        false,
        {},
        undefined,
        signalPacket,
      );

      // Extract payload from log spy
      const logCalls = logSpy.mock.calls;
      let payload: Record<string, any> = {};
      for (let j = logCalls.length - 1; j >= 0; j--) {
        if (typeof logCalls[j][0] === 'string' && logCalls[j][0].includes('[LoRa::MessageDecision]')) {
          payload = JSON.parse(logCalls[j][1]);
          break;
        }
      }

      const gm: string = payload.promptProfile?.guidanceMode ?? 'UNKNOWN';
      guidanceModes.push(gm);

      if (payload.driftDetected) driftCount++;

      const markers = extractMarkersLocal(result.prompt);
      const mc = markers.length;
      if (mc > maxMarkerCount) maxMarkerCount = mc;

      // Skip warm-up + horizon for invariant checks
      if (i < HORIZON) continue;

      // ── Invariant: marker density hard cap ──
      if (mc > 5) {
        violations.push({ step: i, guidanceMode: gm, markers, rule: `DENSITY_CAP: ${mc} > 5` });
      }

      // ── Invariant: STABILIZE forbidden combos ──
      if (gm === 'STABILIZE') {
        if (hasMarker(markers, 'TONE_HINT', 'FIRM'))
          violations.push({ step: i, guidanceMode: gm, markers, rule: 'STABILIZE+TONE_HINT:FIRM' });
        if (hasMarker(markers, 'INTERRUPT_HINT', 'HARD_STOP'))
          violations.push({ step: i, guidanceMode: gm, markers, rule: 'STABILIZE+INTERRUPT_HINT:HARD_STOP' });
        if (hasMarker(markers, 'QUESTION_BUDGET', 'ONE'))
          violations.push({ step: i, guidanceMode: gm, markers, rule: 'STABILIZE+QUESTION_BUDGET:ONE' });
        if (hasAnyMarkerPrefix(markers, 'STEP_HINT'))
          violations.push({ step: i, guidanceMode: gm, markers, rule: 'STABILIZE+STEP_HINT' });
      }

      // ── Invariant: DE_ESCALATE forbidden combos ──
      if (gm === 'DE_ESCALATE') {
        if (hasMarker(markers, 'TONE_HINT', 'FIRM'))
          violations.push({ step: i, guidanceMode: gm, markers, rule: 'DE_ESCALATE+TONE_HINT:FIRM' });
        if (hasMarker(markers, 'INTERRUPT_HINT', 'HARD_STOP'))
          violations.push({ step: i, guidanceMode: gm, markers, rule: 'DE_ESCALATE+INTERRUPT_HINT:HARD_STOP' });
      }

      // ── Invariant: interrupt dominance ──
      if (hasAnyMarkerPrefix(markers, 'INTERRUPT_HINT')) {
        if (hasMarker(markers, 'QUESTION_BUDGET', 'ONE'))
          violations.push({ step: i, guidanceMode: gm, markers, rule: 'INTERRUPT+QUESTION_BUDGET:ONE' });
      }

      // ── Invariant: SLOW pacing blocks STEP_HINT ──
      if (hasMarker(markers, 'PACING_HINT', 'SLOW') && hasAnyMarkerPrefix(markers, 'STEP_HINT'))
        violations.push({ step: i, guidanceMode: gm, markers, rule: 'SLOW_PACING+STEP_HINT' });

      // ── Invariant: SUGGEST_BREAK blocks QUESTION_BUDGET:ONE ──
      if (hasMarker(markers, 'ACTION_HINT', 'SUGGEST_BREAK') && hasMarker(markers, 'QUESTION_BUDGET', 'ONE'))
        violations.push({ step: i, guidanceMode: gm, markers, rule: 'SUGGEST_BREAK+QUESTION_BUDGET:ONE' });

      // ── Invariant: appraisal leakage (first N steps only) ──
      if (i < BUILDER_ARGS_CHECK_LIMIT) {
        const args = buildSpy.mock.calls[i]?.[2] as Record<string, unknown> | undefined;
        if (args) {
          for (const key of APPRAISAL_FORBIDDEN_KEYS) {
            if (key in args) {
              violations.push({ step: i, guidanceMode: gm, markers, rule: `LEAKAGE:${key}` });
            }
          }
        }
      }

      // Cap violation collection to avoid memory blowup
      if (violations.length > 50) break;
    }

    logSpy.mockRestore();

    // ── Global assertions ──

    // Transition sanity
    const activeGuidance = guidanceModes.slice(HORIZON);
    const gmTransitions = countTransitions(activeGuidance);
    // Under fully chaotic input, ~62% transition rate is observed with
    // dwell lock + cooldown active. 0.65 is a loose alarm ceiling.
    const transitionBound = Math.floor(0.65 * STEP_COUNT);

    // Drift sanity
    const postHorizonCount = Math.max(1, steps.length - HORIZON);
    const driftPct = driftCount / postHorizonCount;

    // Failure report (concise)
    if (violations.length > 0) {
      const summary = violations.slice(0, 10).map(
        (v) => `  step=${v.step} gm=${v.guidanceMode} markers=[${v.markers.join(',')}] RULE=${v.rule}`,
      );
      process.stdout.write(
        `\n[ChaosFuzzer] ${violations.length} violation(s) found (showing first 10):\n${summary.join('\n')}\n`,
      );
    }

    expect(violations).toHaveLength(0);
    expect(gmTransitions).toBeLessThanOrEqual(transitionBound);
    expect(driftPct).toBeLessThanOrEqual(0.20);
    expect(maxMarkerCount).toBeLessThanOrEqual(5);

    // Brief success summary
    process.stdout.write(
      `\n[ChaosFuzzer] PASS — ${steps.length} steps, seed=${seed}, gmTransitions=${gmTransitions}, driftPct=${(driftPct * 100).toFixed(1)}%, maxMarkers=${maxMarkerCount}\n`,
    );
  });
});
