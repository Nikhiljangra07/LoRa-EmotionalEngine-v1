export {};

/**
 * 50,000-step seeded chaos fuzzer for LoRa emotion-core.
 *
 * Gated behind LORA_CHAOS_FUZZER_50K=1. Deterministic via mulberry32 PRNG.
 * Checks invariants incrementally — does NOT store the full result array.
 * Zero runtime file changes.
 */

import {
  setFullAdaptiveOn,
  saveEnv,
  restoreEnv,
  makeAppraisalResult,
  countTransitions,
  loadModules,
  APPRAISAL_FORBIDDEN_KEYS,
  type StepSpec,
  type MockAppraisalOverrides,
} from './coherenceHarness';

const ENABLED = process.env.LORA_CHAOS_FUZZER_50K === '1';

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

// ── Emotional presets ────────────────────────────────────────────────

const LOW_NEUTRAL = { dominant: 'NEUTRAL' as const, arousal: 'LOW' as const, valence: 'NEUTRAL' as const, confidence: 0.5 };
const HIGH_NEGATIVE = { dominant: 'ANGER' as const, arousal: 'HIGH' as const, valence: 'NEGATIVE' as const, confidence: 0.9 };

// ── Intervention policy pools ────────────────────────────────────────

const TONE_MODES = ['NEUTRAL', 'STABILIZE', 'DE_ESCALATE', 'REFLECTIVE', 'AFFIRM_BOUNDARIED', 'FIRM_CONTAIN'];
const PACING_MODES = ['NORMAL', 'SLOW', 'DELAYED_RESPONSE', 'SHORT_DIRECT'];
const VALIDATION_MODES = ['STANDARD', 'SUPPORTIVE', 'BOUNDARIED', 'LIMITED'];
const ACTION_MODES = ['NONE', 'INTERRUPT_LOOP', 'SHIFT_TO_REFLECTION', 'ENCOURAGE_PAUSE'];

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ── Step generator (lazy, yields one at a time) ──────────────────────

function generateStep(rand: () => number): { overrides: MockAppraisalOverrides; emotional: StepSpec['emotionalOverride'] } {
  const r = rand();

  // Escalation: 70% 0-1, 25% 2, 5% 3
  const escRoll = rand();
  const escalationLevel = escRoll < 0.70 ? (rand() < 0.5 ? 0 : 1) : escRoll < 0.95 ? 2 : 3;

  // Interruption: 60% 0, 30% 1-2, 10% 3
  const intRoll = rand();
  const interruptionLevel = (intRoll < 0.60 ? 0 : intRoll < 0.90 ? (rand() < 0.5 ? 1 : 2) : 3) as 0 | 1 | 2 | 3;

  const collapseEvent = r < 0.02;
  const postClarityActive = !collapseEvent && rand() < 0.05;

  const overrides: MockAppraisalOverrides = {
    collapseEvent,
    collapseSeverity: collapseEvent ? 0.5 + rand() * 0.5 : 0,
    escalationLevel,
    pressureScalar: rand() * 3,
    pressureVolatility: rand() * 2,
    interruptionLevel,
    postClarityActive,
    toneMode: pick(TONE_MODES, rand),
    pacingMode: pick(PACING_MODES, rand),
    validationMode: pick(VALIDATION_MODES, rand),
    actionMode: pick(ACTION_MODES, rand),
  };

  const emotional = rand() < 0.65 ? LOW_NEUTRAL : HIGH_NEGATIVE;

  return { overrides, emotional };
}

// ── Marker helpers ───────────────────────────────────────────────────

const MARKER_RE = /\[([A-Z_]+):([A-Z_]+)\]/g;

function extractMarkers(prompt: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(prompt)) !== null) out.push(m[0]);
  return out;
}

function has(markers: string[], prefix: string, value: string): boolean {
  return markers.includes(`[${prefix}:${value}]`);
}

function hasPrefix(markers: string[], prefix: string): boolean {
  return markers.some((m) => m.startsWith(`[${prefix}:`));
}

// ── Test ─────────────────────────────────────────────────────────────

const saved = saveEnv();

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

(ENABLED ? describe : describe.skip)('ChaosFuzzer50K — 50k seeded chaos', () => {
  it('50k-step seeded chaos maintains invariants', async () => {
    jest.setTimeout(120_000);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    setFullAdaptiveOn();
    process.env.LORA_HINT_RESOLVER = '1';
    process.env.LORA_HINT_STICKINESS = '1';
    process.env.LORA_HINT_SEMANTIC_GUARD = '1';
    process.env.LORA_GUIDANCE_DWELL_LOCK = '1';
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';

    const seed = parseInt(process.env.LORA_CHAOS_SEED ?? '1337', 10) || 1337;
    const rand = mulberry32(seed);

    const TOTAL = 50_000;
    const WARMUP = 2;
    const HORIZON = 3;
    const BUILDER_CHECK_LIMIT = 200;

    // Build step function that generates appraisal results lazily
    let stepIdx = 0;
    const stepOverrides: MockAppraisalOverrides[] = [];

    // Pre-generate overrides + emotional states for determinism
    const emotionals: StepSpec['emotionalOverride'][] = [];
    for (let i = 0; i < WARMUP; i++) {
      stepOverrides.push({});
      emotionals.push(LOW_NEUTRAL);
    }
    for (let i = 0; i < TOTAL; i++) {
      const { overrides, emotional } = generateStep(rand);
      stepOverrides.push(overrides);
      emotionals.push(emotional);
    }

    const stepFn = jest.fn(() => {
      const o = stepOverrides[stepIdx] ?? {};
      stepIdx++;
      return makeAppraisalResult(o);
    });

    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // Incremental metrics
    let maxMarkerCount = 0;
    let driftCount = 0;
    let violationMsg = '';
    const guidanceModes: string[] = [];
    const totalSteps = WARMUP + TOTAL;

    for (let i = 0; i < totalSteps; i++) {
      const { analyzerOutputs, signalPacket } = InputProcessor.process('fuzz');
      const result = await engine.processMessage(
        analyzerOutputs,
        emotionals[i],
        false,
        {},
        undefined,
        signalPacket,
      );

      // Extract payload
      const calls = logSpy.mock.calls;
      let payload: Record<string, any> = {};
      for (let j = calls.length - 1; j >= 0; j--) {
        if (typeof calls[j][0] === 'string' && calls[j][0].includes('[LoRa::MessageDecision]')) {
          payload = JSON.parse(calls[j][1]);
          break;
        }
      }

      const gm: string = payload.promptProfile?.guidanceMode ?? 'UNKNOWN';
      guidanceModes.push(gm);
      if (payload.driftDetected) driftCount++;

      const markers = extractMarkers(result.prompt);
      const mc = markers.length;
      if (mc > maxMarkerCount) maxMarkerCount = mc;

      // Skip invariant checks before horizon
      if (i < HORIZON) continue;

      // A) Density cap
      if (mc > 5 && !violationMsg) {
        violationMsg = `step=${i} DENSITY_CAP: ${mc} > 5 markers=[${markers}]`;
      }

      // B) STABILIZE forbidden
      if (gm === 'STABILIZE') {
        if (has(markers, 'TONE_HINT', 'FIRM') && !violationMsg)
          violationMsg = `step=${i} STABILIZE+TONE_HINT:FIRM`;
        if (has(markers, 'INTERRUPT_HINT', 'HARD_STOP') && !violationMsg)
          violationMsg = `step=${i} STABILIZE+INTERRUPT_HINT:HARD_STOP`;
        if (has(markers, 'QUESTION_BUDGET', 'ONE') && !violationMsg)
          violationMsg = `step=${i} STABILIZE+QUESTION_BUDGET:ONE`;
        if (hasPrefix(markers, 'STEP_HINT') && !violationMsg)
          violationMsg = `step=${i} STABILIZE+STEP_HINT`;
      }

      // C) DE_ESCALATE forbidden
      if (gm === 'DE_ESCALATE') {
        if (has(markers, 'TONE_HINT', 'FIRM') && !violationMsg)
          violationMsg = `step=${i} DE_ESCALATE+TONE_HINT:FIRM`;
        if (has(markers, 'INTERRUPT_HINT', 'HARD_STOP') && !violationMsg)
          violationMsg = `step=${i} DE_ESCALATE+INTERRUPT_HINT:HARD_STOP`;
      }

      // D) Interrupt dominance
      if (hasPrefix(markers, 'INTERRUPT_HINT') && has(markers, 'QUESTION_BUDGET', 'ONE') && !violationMsg)
        violationMsg = `step=${i} INTERRUPT+QUESTION_BUDGET:ONE`;

      // E) SLOW pacing blocks STEP_HINT
      if (has(markers, 'PACING_HINT', 'SLOW') && hasPrefix(markers, 'STEP_HINT') && !violationMsg)
        violationMsg = `step=${i} SLOW_PACING+STEP_HINT`;

      // F) Builder args leakage (sample first N)
      if (i < BUILDER_CHECK_LIMIT) {
        const args = buildSpy.mock.calls[i]?.[2] as Record<string, unknown> | undefined;
        if (args) {
          for (const key of APPRAISAL_FORBIDDEN_KEYS) {
            if (key in args && !violationMsg) {
              violationMsg = `step=${i} LEAKAGE:${key}`;
            }
          }
        }
      }

      // Early exit on first violation
      if (violationMsg) break;
    }

    logSpy.mockRestore();

    // G+H) Global assertions
    const postHorizon = Math.max(1, totalSteps - HORIZON);
    const driftPct = driftCount / postHorizon;
    const gmTransitions = countTransitions(guidanceModes.slice(HORIZON));
    const transitionBound = Math.floor(0.7 * TOTAL);

    if (violationMsg) {
      process.stdout.write(`\n[ChaosFuzzer50K] VIOLATION: ${violationMsg}\n`);
    }

    expect(violationMsg).toBe('');
    expect(maxMarkerCount).toBeLessThanOrEqual(5);
    expect(driftPct).toBeLessThanOrEqual(0.20);
    expect(gmTransitions).toBeLessThanOrEqual(transitionBound);

    process.stdout.write(
      `\n[ChaosFuzzer50K] PASS — ${totalSteps} steps, seed=${seed}, ` +
      `maxMarkers=${maxMarkerCount}, gmTransitions=${gmTransitions}/${transitionBound}, ` +
      `driftRate=${(driftPct * 100).toFixed(1)}%\n`,
    );
  });
});
