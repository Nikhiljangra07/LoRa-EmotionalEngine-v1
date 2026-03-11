export {};

/**
 * QuestionBudgetHint priority rules:
 *   A) STABILIZE             → 'ZERO'
 *   B) interruptHint defined → 'ZERO'
 *   C) DE_ESCALATE           → 'ONE'
 *   D) pacingHint === 'SLOW' → 'ONE'
 *   E) escalation.level >= 2 → 'ZERO'
 *   F) else                  → undefined (absent)
 */

const ENV_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_APPRAISAL_PACING_HINT',
  'LORA_VALIDATION_INTENSITY',
  'LORA_APPRAISAL_TONE_HINT',
  'LORA_ADAPTIVE_OVERRIDE_COOLDOWN',
  'LORA_DRIFT_MONITOR',
  'LORA_STRICT_GUIDANCE_MODE',
  'LORA_INTERVENTION_VALIDATION_HINT',
  'LORA_INTERVENTION_PACING_HINT',
  'LORA_INTERVENTION_TONE_HINT',
  'LORA_INTERVENTION_ACTION_HINT',
  'LORA_INTERVENTION_INTERRUPT_HINT',
  'LORA_INTERVENTION_STEP_HINT',
  'LORA_INTERVENTION_QUESTION_BUDGET',
] as const;

const origEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) origEnv[k] = process.env[k];

function clearFlags() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

const MOCK_NEUTRAL = Object.freeze({
  timestamp: 1_000_000,
  family: Object.freeze({ dominantFamily: 'SADNESS', weights: Object.freeze({}), confidence: 0.5 }),
  pressure: Object.freeze({ scalar: 0.3, slope: 0, volatility: 0.05, isShock: false, byFamily: Object.freeze({}) }),
  mood: Object.freeze({ category: 'NEUTRAL', dominance: 0.5, confidence: 0.5 }),
  escalation: Object.freeze({ level: 0, score: 0.1, flags: Object.freeze({ warmedUp: false, isFlapping: false, enteredCritical: false }) }),
  collapse: Object.freeze({ event: false, severity: 0, direction: 'NONE' }),
  postClarity: Object.freeze({ active: false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
  intervention: Object.freeze({
    toneMode: 'NEUTRAL',
    pacingMode: 'NORMAL',
    validationMode: 'STANDARD',
    actionMode: 'NONE',
    interruptionLevel: 0 as const,
    guardrails: Object.freeze([]),
  }),
});

function makeMock(overrides: Record<string, any> = {}) {
  const intervention = overrides.intervention
    ? Object.freeze({ ...MOCK_NEUTRAL.intervention, ...overrides.intervention })
    : MOCK_NEUTRAL.intervention;
  const base: Record<string, any> = { ...MOCK_NEUTRAL, intervention };
  if (overrides.collapse) base.collapse = Object.freeze({ ...MOCK_NEUTRAL.collapse, ...overrides.collapse });
  if (overrides.escalation) base.escalation = Object.freeze({ ...MOCK_NEUTRAL.escalation, ...overrides.escalation });
  if (overrides.pressure) base.pressure = Object.freeze({ ...MOCK_NEUTRAL.pressure, ...overrides.pressure });
  return Object.freeze(base);
}

function loadModules(stepFn: jest.Mock) {
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
  const { EngineOrchestrator } = require('../EngineOrchestrator');
  const { InputProcessor } = require('../../processors/InputProcessor');
  const { PromptTemplateBuilder } = require('../../prompt/PromptTemplateBuilder');
  return { EngineOrchestrator, InputProcessor, PromptTemplateBuilder };
}

const LOW_NEUTRAL = { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.5 };

async function warmUpAndSend(engine: any, IP: any, text = 'test message') {
  for (let i = 0; i < 2; i++) {
    const w = IP.process('hello');
    await engine.processMessage(w.analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, w.signalPacket);
  }
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, signalPacket);
}

function setCoreFlags() {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_INTERVENTION_QUESTION_BUDGET = '1';
}

describe('Intervention.questionBudgetHint contract', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // 1) Flag off → prompt identity
  test('prompt is byte-identical when LORA_INTERVENTION_QUESTION_BUDGET is off', async () => {
    const stepFn = jest.fn().mockReturnValue(MOCK_NEUTRAL);

    clearFlags();
    const baseModules = loadModules(stepFn);
    const baseEngine = new baseModules.EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const baseResult = await warmUpAndSend(baseEngine, baseModules.InputProcessor);

    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    const onModules = loadModules(stepFn);
    const onEngine = new onModules.EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const onResult = await warmUpAndSend(onEngine, onModules.InputProcessor);

    expect(onResult.prompt).toBe(baseResult.prompt);
  });

  // 2) Neutral conditions → absent
  test('neutral conditions produce no questionBudgetHint key', async () => {
    clearFlags();
    setCoreFlags();

    const stepFn = jest.fn().mockReturnValue(MOCK_NEUTRAL);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    await warmUpAndSend(engine, InputProcessor);

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.questionBudgetHint).toBeUndefined();

    const payloadCall = [...logSpy.mock.calls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    expect(payloadCall).toBeDefined();
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.questionBudgetHint).toBeUndefined();

    logSpy.mockRestore();
  });

  // 3) STABILIZE → ZERO
  test('STABILIZE forces questionBudgetHint ZERO', async () => {
    clearFlags();
    setCoreFlags();

    const collapseResult = makeMock({ collapse: { event: true } });
    const stepFn = jest.fn().mockReturnValue(collapseResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const res = await warmUpAndSend(engine, InputProcessor);

    expect(res.prompt).toContain('[QUESTION_BUDGET:ZERO]');

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.questionBudgetHint).toBe('ZERO');

    const payloadCall = [...logSpy.mock.calls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.questionBudgetHint).toBe('ZERO');

    logSpy.mockRestore();
  });

  // 4) DE_ESCALATE → ONE
  test('DE_ESCALATE forces questionBudgetHint ONE', async () => {
    clearFlags();
    setCoreFlags();

    const escalated = makeMock({ escalation: { level: 2, score: 0.8 } });
    const stepFn = jest.fn().mockReturnValue(escalated);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const res = await warmUpAndSend(engine, InputProcessor);

    // escalation.level >= 2 triggers DE_ESCALATE guidanceMode AND escalation gate.
    // Priority: A) STABILIZE? no. B) interruptHint? no. C) DE_ESCALATE? yes → ONE
    // BUT E) escalation.level >= 2 → ZERO wins if it's evaluated. However priority order
    // says DE_ESCALATE (rule C) is checked before escalation rule (E).
    // guidanceMode with escalation.level >= 2 yields DE_ESCALATE, so rule C fires first → ONE

    // Wait — re-check: the spec says priority order is A > B > C > D > E > F.
    // DE_ESCALATE (rule C) is before escalation.level >= 2 (rule E).
    // So when guidanceMode is DE_ESCALATE, we get ONE (rule C hits first).
    expect(res.prompt).toContain('[QUESTION_BUDGET:ONE]');

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.questionBudgetHint).toBe('ONE');

    const payloadCall = [...logSpy.mock.calls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.questionBudgetHint).toBe('ONE');

    logSpy.mockRestore();
  });

  // 5) interruptHint present → ZERO overrides DE_ESCALATE
  test('interruptHint present forces ZERO even during DE_ESCALATE', async () => {
    clearFlags();
    setCoreFlags();
    process.env.LORA_INTERVENTION_INTERRUPT_HINT = '1';

    const escalatedWithInterrupt = makeMock({
      escalation: { level: 2, score: 0.8 },
      intervention: { interruptionLevel: 2 },
    });
    const stepFn = jest.fn().mockReturnValue(escalatedWithInterrupt);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const res = await warmUpAndSend(engine, InputProcessor);

    expect(res.prompt).toContain('[QUESTION_BUDGET:ZERO]');
    expect(res.prompt).not.toContain('[QUESTION_BUDGET:ONE]');

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.questionBudgetHint).toBe('ZERO');
  });

  // 6) pacingHint=SLOW → ONE (unless higher-priority ZERO condition)
  test('pacingHint SLOW forces questionBudgetHint ONE', async () => {
    clearFlags();
    setCoreFlags();
    process.env.LORA_APPRAISAL_PACING_HINT = '1';

    const pressured = makeMock({
      pressure: { scalar: 3.0, volatility: 2.0 },
    });
    const stepFn = jest.fn().mockReturnValue(pressured);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const res = await warmUpAndSend(engine, InputProcessor);

    expect(res.prompt).toContain('[PACING_HINT:SLOW]');
    expect(res.prompt).toContain('[QUESTION_BUDGET:ONE]');

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.questionBudgetHint).toBe('ONE');
  });

  // 7) escalation >= 2 → ZERO (when not DE_ESCALATE — impossible with current logic since
  //    escalation >= 2 always triggers DE_ESCALATE override. So verify DE_ESCALATE path → ONE
  //    takes precedence per priority, and add separate test with direct escalation signal only)
  test('escalation level >= 2 without guidance override produces ZERO', async () => {
    clearFlags();
    setCoreFlags();
    // Do NOT enable LORA_APPRAISAL_BRIDGE_MODE in flags so guidanceMode override doesn't fire
    // Actually we need bridge mode for questionBudgetHint to activate. In that case,
    // escalation.level >= 2 triggers DE_ESCALATE override (rule C) before rule E.
    // So with all flags on, escalation >= 2 → DE_ESCALATE → ONE (rule C).
    // To test rule E in isolation, we'd need escalation level >= 2 without mode override.
    // But the feature requires appraisalBridgeModeEnabled. Let's test the combined behavior:
    // with cooldown active, the override doesn't fire and baseline mode is used.
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';

    const escalated = makeMock({ escalation: { level: 2, score: 0.8 } });
    const collapseFirst = makeMock({ collapse: { event: true } });
    const stepFn = jest.fn()
      .mockReturnValueOnce(MOCK_NEUTRAL) // warmup 1
      .mockReturnValueOnce(MOCK_NEUTRAL) // warmup 2
      .mockReturnValueOnce(collapseFirst) // msg 3: triggers override → cooldown starts
      .mockReturnValueOnce(escalated)     // msg 4: cooldown active, no override. baseline mode.
      .mockReturnValue(MOCK_NEUTRAL);

    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // warmup 1 & 2
    for (let i = 0; i < 2; i++) {
      const w = InputProcessor.process('hello');
      await engine.processMessage(w.analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, w.signalPacket);
    }
    // msg 3: collapse → override → cooldown starts
    const w3 = InputProcessor.process('msg3');
    await engine.processMessage(w3.analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, w3.signalPacket);
    // msg 4: cooldown active, escalation >= 2 but no DE_ESCALATE override
    const w4 = InputProcessor.process('msg4');
    await engine.processMessage(w4.analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, w4.signalPacket);

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    // Without DE_ESCALATE mode (cooldown suppressed it), escalation.level >= 2 fires rule E → ZERO
    expect(lastArgs.questionBudgetHint).toBe('ZERO');
  });

  // 8) No appraisal leakage
  test('builder args contain no appraisal-related keys', async () => {
    clearFlags();
    setCoreFlags();

    const collapseResult = makeMock({ collapse: { event: true } });
    const stepFn = jest.fn().mockReturnValue(collapseResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    await warmUpAndSend(engine, InputProcessor);

    const forbidden = ['appraisal', 'appraisalResult', 'intervention', 'policy', 'appraisalHints'];
    for (const call of buildSpy.mock.calls) {
      const opts = call[2] as Record<string, unknown> | undefined;
      if (opts) {
        for (const key of forbidden) {
          expect(opts).not.toHaveProperty(key);
        }
      }
    }
  });

  // 9) Golden replay hashes unchanged
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
