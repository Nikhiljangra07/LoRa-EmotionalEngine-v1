export {};

const APPRAISAL_FORBIDDEN_KEYS = [
  'appraisal',
  'appraisalResult',
  'intervention',
  'policy',
  'appraisalHints',
];

function makeMockResult(overrides: {
  collapseEvent?: boolean;
  escalationLevel?: number;
  pressureScalar?: number;
  postClarityActive?: boolean;
} = {}) {
  return Object.freeze({
    timestamp: 1_000_000,
    family: Object.freeze({
      dominantFamily: 'SADNESS',
      weights: Object.freeze({ JOY: 0.1, ANGER: 0.1, FEAR: 0.1, SADNESS: 0.4, SURPRISE: 0.1, DISGUST: 0.2 }),
      confidence: 0.7,
    }),
    pressure: Object.freeze({
      scalar: overrides.pressureScalar ?? 0.3,
      slope: 0.01,
      volatility: 0.05,
      isShock: false,
      byFamily: Object.freeze({}),
    }),
    mood: Object.freeze({ category: 'NEUTRAL', dominance: 0.5, confidence: 0.6 }),
    escalation: Object.freeze({
      level: overrides.escalationLevel ?? 0,
      score: 0.1,
      flags: Object.freeze({ warmedUp: false, isFlapping: false, enteredCritical: false }),
    }),
    collapse: Object.freeze({ event: overrides.collapseEvent ?? false, severity: 0, direction: 'NONE' }),
    postClarity: Object.freeze({ active: overrides.postClarityActive ?? false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
    intervention: Object.freeze({ toneMode: 'NEUTRAL', pacingMode: 'NORMAL', validationMode: 'STANDARD', actionMode: 'NONE', interruptionLevel: 0 as const, guardrails: Object.freeze([]) }),
  });
}

const ENV_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_APPRAISAL_PACING_HINT',
  'LORA_VALIDATION_INTENSITY',
  'LORA_ADAPTIVE_OVERRIDE_COOLDOWN',
  'LORA_DRIFT_MONITOR',
] as const;
const origEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) origEnv[k] = process.env[k];

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

function setupModules(opts: {
  cooldown: boolean;
  pacing?: boolean;
  validation?: boolean;
  stepFn: jest.Mock;
}) {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  if (opts.cooldown) process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
  else delete process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN;
  if (opts.pacing) process.env.LORA_APPRAISAL_PACING_HINT = '1';
  else delete process.env.LORA_APPRAISAL_PACING_HINT;
  if (opts.validation) process.env.LORA_VALIDATION_INTENSITY = '1';
  else delete process.env.LORA_VALIDATION_INTENSITY;

  jest.resetModules();

  jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
    AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
      step: opts.stepFn,
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

function makeEngine(EO: any) {
  return new EO(0.5, {}, () => ({ generateResponse: async () => 'ok' }));
}

async function send(engine: any, IP: any, text = 'test') {
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, undefined, false, {}, undefined, signalPacket);
}

function getPayloads(logSpy: jest.SpyInstance) {
  return logSpy.mock.calls
    .filter((c: any[]) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
    .map((c: any[]) => JSON.parse(c[1]));
}

describe('AdaptiveOverrideCooldown', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // 1) Flag OFF → existing override behavior unchanged
  test('override fires normally when cooldown flag is off', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const collapseResult = makeMockResult({ collapseEvent: true });
    const stepFn = jest.fn().mockReturnValue(collapseResult);

    const { EngineOrchestrator, InputProcessor } = setupModules({ cooldown: false, stepFn });
    const engine = makeEngine(EngineOrchestrator);

    // Warm up
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    // Message 3: collapse → override
    await send(engine, InputProcessor, 'I feel lost');
    // Message 4: collapse → override again (no cooldown)
    await send(engine, InputProcessor, 'still lost');

    const payloads = getPayloads(logSpy);
    expect(payloads[2].appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(payloads[3].appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(payloads[2].overrideCooldownActive).toBeUndefined();
    expect(payloads[3].overrideCooldownActive).toBeUndefined();
  });

  // 2) Flag ON → override fires once, then cooldown suppresses for 2 messages
  test('override fires once then cooldown suppresses for 2 messages', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const collapseResult = makeMockResult({ collapseEvent: true });
    const stepFn = jest.fn().mockReturnValue(collapseResult);

    const { EngineOrchestrator, InputProcessor } = setupModules({ cooldown: true, stepFn });
    const engine = makeEngine(EngineOrchestrator);

    // Warm up (messages 1-2)
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');

    // Message 3: collapse → override fires, sets cooldown=2
    await send(engine, InputProcessor, 'I feel lost');
    // Message 4: collapse → suppressed (cooldown=2→1)
    await send(engine, InputProcessor, 'still lost');
    // Message 5: collapse → suppressed (cooldown=1→0)
    await send(engine, InputProcessor, 'very lost');
    // Message 6: cooldown expired → override fires again
    await send(engine, InputProcessor, 'completely lost');

    const payloads = getPayloads(logSpy);

    // Message 3 (index 2): override applied
    expect(payloads[2].appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(payloads[2].promptProfile.guidanceMode).toBe('STABILIZE');
    expect(payloads[2].overrideCooldownActive).toBeUndefined();

    // Message 4 (index 3): suppressed
    expect(payloads[3].appraisalOverride).toBeUndefined();
    expect(payloads[3].promptProfile.guidanceMode).not.toBe('STABILIZE');
    expect(payloads[3].overrideCooldownActive).toBe(true);

    // Message 5 (index 4): still suppressed
    expect(payloads[4].appraisalOverride).toBeUndefined();
    expect(payloads[4].overrideCooldownActive).toBe(true);

    // Message 6 (index 5): cooldown ended, override fires again
    expect(payloads[5].appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(payloads[5].promptProfile.guidanceMode).toBe('STABILIZE');
    expect(payloads[5].overrideCooldownActive).toBeUndefined();
  });

  // 3) Cooldown does not affect pacingHint or validationIntensity
  test('pacingHint and validationIntensity still computed during cooldown', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const collapseResult = makeMockResult({ collapseEvent: true, pressureScalar: 3.0 });
    const stepFn = jest.fn().mockReturnValue(collapseResult);

    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupModules({
      cooldown: true,
      pacing: true,
      validation: true,
      stepFn,
    });
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const engine = makeEngine(EngineOrchestrator);

    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    // Message 3: override fires
    await send(engine, InputProcessor, 'I AM SO ANGRY 😤😤😤');
    // Message 4: cooldown active, but pacing/validation should still compute
    await send(engine, InputProcessor, 'I AM STILL ANGRY 😤😤😤');

    const payloads = getPayloads(logSpy);

    // Message 4 (index 3): cooldown active
    expect(payloads[3].overrideCooldownActive).toBe(true);

    // pacingHint should still be computed (collapse → SLOW)
    // The appraisal result still has collapse=true, and pacingHint is independent
    expect(payloads[3].pacingHint).toBe('SLOW');

    // validationIntensity should still be computed from eiv/arousal
    // (may or may not be present depending on eiv, but shouldn't be blocked)
    // Just verify builder received no forbidden keys
    const lastCall = buildSpy.mock.calls[buildSpy.mock.calls.length - 1];
    for (const arg of lastCall) {
      if (arg && typeof arg === 'object') {
        for (const key of APPRAISAL_FORBIDDEN_KEYS) {
          expect(arg).not.toHaveProperty(key);
        }
      }
    }
  });

  // 4) Reset correctness: endSession clears cooldown
  test('endSession resets cooldown so next session override fires at message 3', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const collapseResult = makeMockResult({ collapseEvent: true });
    const stepFn = jest.fn().mockReturnValue(collapseResult);

    const { EngineOrchestrator, InputProcessor } = setupModules({ cooldown: true, stepFn });
    const engine = makeEngine(EngineOrchestrator);

    // Session 1: trigger override + cooldown
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'I feel lost'); // override fires
    await send(engine, InputProcessor, 'still lost');  // cooldown active

    engine.endSession();
    logSpy.mockClear();

    // Session 2: cooldown should be cleared
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'I feel lost'); // override should fire again

    const payloads = getPayloads(logSpy);
    expect(payloads[2].appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(payloads[2].overrideCooldownActive).toBeUndefined();
  });

  // 5) No prompt leakage
  test('builder args contain no appraisal keys during cooldown', async () => {
    const collapseResult = makeMockResult({ collapseEvent: true });
    const stepFn = jest.fn().mockReturnValue(collapseResult);

    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupModules({
      cooldown: true,
      stepFn,
    });
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const engine = makeEngine(EngineOrchestrator);

    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'I feel lost');
    await send(engine, InputProcessor, 'still lost'); // cooldown active

    // Check ALL build calls
    for (const call of buildSpy.mock.calls) {
      for (const arg of call) {
        if (arg && typeof arg === 'object') {
          for (const key of APPRAISAL_FORBIDDEN_KEYS) {
            expect(arg).not.toHaveProperty(key);
          }
        }
      }
    }
  });

  // E) Cooldown cannot activate without bridge mode
  test('cooldown flag alone without bridge mode produces no override or cooldown payload', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const collapseResult = makeMockResult({ collapseEvent: true });
    const stepFn = jest.fn().mockReturnValue(collapseResult);

    // Bridge ON, mode OFF, cooldown ON
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
    delete process.env.LORA_APPRAISAL_PACING_HINT;
    delete process.env.LORA_VALIDATION_INTENSITY;

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

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'I feel lost');
    await send(engine, InputProcessor, 'still lost');

    const payloads = getPayloads(logSpy);

    for (const p of payloads) {
      expect(p.appraisalOverride).toBeUndefined();
      expect(p.overrideCooldownActive).toBeUndefined();
    }
  });

  // F) Cooldown does not block driftDetected
  test('driftDetected can fire while overrideCooldownActive is true', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      // Messages 1-3: collapse (triggers override on msg 3, cooldown starts)
      // Messages 4+: alternate collapse/neutral to induce guidance oscillation
      if (callIdx <= 3) return makeMockResult({ collapseEvent: true });
      return callIdx % 2 === 0
        ? makeMockResult({ collapseEvent: true })
        : makeMockResult();
    });

    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
    process.env.LORA_DRIFT_MONITOR = '1';
    delete process.env.LORA_APPRAISAL_PACING_HINT;
    delete process.env.LORA_VALIDATION_INTENSITY;

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

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // Warm up
    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    // Message 3: override fires, cooldown = 2
    await send(engine, InputProcessor, 'help');
    // Messages 4-12: oscillation during and after cooldown
    for (let i = 0; i < 9; i++) {
      await send(engine, InputProcessor, 'message');
    }

    const payloads = getPayloads(logSpy);

    // Verify cooldown was active on messages 4-5
    expect(payloads[3].overrideCooldownActive).toBe(true);
    expect(payloads[4].overrideCooldownActive).toBe(true);

    // Verify driftDetected appeared at some point
    const driftPayloads = payloads.filter((p: any) => p.driftDetected === true);
    expect(driftPayloads.length).toBeGreaterThanOrEqual(1);
  });
});
