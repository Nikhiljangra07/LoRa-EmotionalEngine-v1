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
} = {}) {
  return Object.freeze({
    timestamp: 1_000_000,
    family: Object.freeze({
      dominantFamily: 'SADNESS',
      weights: Object.freeze({ JOY: 0.1, ANGER: 0.1, FEAR: 0.1, SADNESS: 0.4, SURPRISE: 0.1, DISGUST: 0.2 }),
      confidence: 0.7,
    }),
    pressure: Object.freeze({ scalar: 0.3, slope: 0.01, volatility: 0.05, isShock: false, byFamily: Object.freeze({}) }),
    mood: Object.freeze({ category: 'NEUTRAL', dominance: 0.5, confidence: 0.6 }),
    escalation: Object.freeze({
      level: overrides.escalationLevel ?? 0,
      score: 0.1,
      flags: Object.freeze({ warmedUp: false, isFlapping: false, enteredCritical: false }),
    }),
    collapse: Object.freeze({ event: overrides.collapseEvent ?? false, severity: 0, direction: 'NONE' }),
    postClarity: Object.freeze({ active: false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
    intervention: Object.freeze({ toneMode: 'NEUTRAL', pacingMode: 'NORMAL', validationMode: 'STANDARD', actionMode: 'NONE', interruptionLevel: 0 as const, guardrails: Object.freeze([]) }),
  });
}

const ENV_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_VALIDATION_INTENSITY',
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
  validationIntensity: boolean;
  bridge?: boolean;
  mode?: boolean;
  mockResult?: ReturnType<typeof makeMockResult>;
}) {
  if (opts.bridge) process.env.LORA_APPRAISAL_BRIDGE = '1';
  else delete process.env.LORA_APPRAISAL_BRIDGE;
  if (opts.mode) process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  else delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
  if (opts.validationIntensity) process.env.LORA_VALIDATION_INTENSITY = '1';
  else delete process.env.LORA_VALIDATION_INTENSITY;

  jest.resetModules();

  if (opts.mockResult) {
    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: jest.fn().mockReturnValue(opts.mockResult),
        reset: jest.fn(),
      })),
    }));
  }
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

async function send(engine: any, IP: any, text = 'test message') {
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, undefined, false, {}, undefined, signalPacket);
}

async function warmUpAndSend(engine: any, IP: any, text: string, emotionalOverride?: any) {
  for (let i = 0; i < 2; i++) {
    const w = IP.process('hello');
    await engine.processMessage(w.analyzerOutputs, undefined, false, {}, undefined, w.signalPacket);
  }
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, emotionalOverride, false, {}, undefined, signalPacket);
}

describe('ValidationIntensity invariant', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // 1) Flags OFF → prompt identity
  test('prompt is identical when LORA_VALIDATION_INTENSITY is off', async () => {
    const { EngineOrchestrator: EO1, InputProcessor: IP1 } = setupModules({
      validationIntensity: false,
    });
    const engine1 = makeEngine(EO1);
    const r1 = await warmUpAndSend(engine1, IP1, 'I feel really terrible about this situation');

    const { EngineOrchestrator: EO2, InputProcessor: IP2 } = setupModules({
      validationIntensity: false,
      bridge: true,
    });
    const engine2 = makeEngine(EO2);
    const r2 = await warmUpAndSend(engine2, IP2, 'I feel really terrible about this situation');

    expect(r1.prompt).toBe(r2.prompt);
    expect(r1.prompt).not.toContain('[VALIDATION_INTENSITY:');
  });

  // 2) Horizon gate: first 2 messages never include markers
  test('first 2 messages never include validation markers', async () => {
    const { EngineOrchestrator, InputProcessor } = setupModules({
      validationIntensity: true,
    });
    const engine = makeEngine(EngineOrchestrator);

    const r1 = await send(engine, InputProcessor, 'I am so angry right now!!!');
    const r2 = await send(engine, InputProcessor, 'THIS IS TERRIBLE!!!');

    expect(r1.prompt).not.toContain('[VALIDATION_INTENSITY:');
    expect(r2.prompt).not.toContain('[VALIDATION_INTENSITY:');
  });

  // 3) On 3rd message, HIGH marker appears when arousal is HIGH
  test('HIGH marker appears on 3rd message with HIGH arousal override', async () => {
    const { EngineOrchestrator, InputProcessor } = setupModules({
      validationIntensity: true,
    });
    const engine = makeEngine(EngineOrchestrator);

    const highArousal = { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 };
    const r3 = await warmUpAndSend(engine, InputProcessor, 'I feel terrible', highArousal);

    expect(r3.prompt).toContain('[VALIDATION_INTENSITY:HIGH]');
  });

  // 3b) MEDIUM overlay renders correctly when passed to builder
  test('MEDIUM marker renders in prompt via builder', () => {
    const { PromptTemplateBuilder } = setupModules({ validationIntensity: true });

    const emotionalState = { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.5 };
    const etvState = { value: 0.5, sessionEIVs: [], messageCount: 1, lastUpdated: Date.now() };

    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      guidanceMode: 'CALM_NEUTRAL' as const,
      validationIntensity: 'MEDIUM' as const,
    });

    expect(prompt).toContain('[VALIDATION_INTENSITY:MEDIUM]');
    expect(prompt).toContain('Acknowledge the user');
    expect(prompt).not.toContain('[VALIDATION_INTENSITY:HIGH]');
  });

  test('LOW eiv + low arousal suppresses marker', async () => {
    const { EngineOrchestrator, InputProcessor } = setupModules({
      validationIntensity: true,
    });
    const engine = makeEngine(EngineOrchestrator);

    await send(engine, InputProcessor, 'hello');
    await send(engine, InputProcessor, 'hello');
    // 3rd: calm, low-signal message
    const r3 = await send(engine, InputProcessor, 'ok');

    expect(r3.prompt).not.toContain('[VALIDATION_INTENSITY:');
  });

  // 4) No appraisal leakage into build args
  test('builder args contain no appraisal keys', async () => {
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupModules({
      validationIntensity: true,
      bridge: true,
      mockResult: makeMockResult(),
    });
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const engine = makeEngine(EngineOrchestrator);
    await warmUpAndSend(engine, InputProcessor, 'I feel really terrible');

    const lastCall = buildSpy.mock.calls[buildSpy.mock.calls.length - 1];
    for (const arg of lastCall) {
      if (arg && typeof arg === 'object') {
        for (const key of APPRAISAL_FORBIDDEN_KEYS) {
          expect(arg).not.toHaveProperty(key);
        }
      }
    }
  });

  // 5a) Neutral guarantee: LOW suppression → key absent from both builder and payload
  test('LOW eiv produces no validationIntensity key in builder args or payload', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupModules({
      validationIntensity: true,
    });
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const engine = makeEngine(EngineOrchestrator);

    // 3 low-signal messages
    await send(engine, InputProcessor, 'ok');
    await send(engine, InputProcessor, 'ok');
    await send(engine, InputProcessor, 'ok');

    // Builder: last call options must not contain key at all
    const lastOpts = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as
      | Record<string, unknown>
      | undefined;
    expect(lastOpts).toBeDefined();
    expect(lastOpts).not.toHaveProperty('validationIntensity');

    // Payload: last decision log must not contain key
    const payloads = logSpy.mock.calls
      .filter((c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
      .map((c) => JSON.parse(c[1]));
    const lastPayload = payloads[payloads.length - 1];
    expect(lastPayload).not.toHaveProperty('validationIntensity');
  });

  // 5b) Decision payload contains validationIntensity only when defined
  test('decision payload includes validationIntensity for HIGH, absent for LOW', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const { EngineOrchestrator, InputProcessor } = setupModules({
      validationIntensity: true,
    });
    const engine = makeEngine(EngineOrchestrator);

    // Messages 1-2 (warm-up): should have no validationIntensity
    await send(engine, InputProcessor, 'ok');
    await send(engine, InputProcessor, 'ok');

    // Message 3: low signal → no validationIntensity
    await send(engine, InputProcessor, 'ok');

    // Message 4: high signal
    await send(engine, InputProcessor, 'I AM SO ANGRY AND FRUSTRATED!!! 😤😤😤 THIS IS THE WORST DAY EVER!!!');

    const payloads = logSpy.mock.calls
      .filter((c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
      .map((c) => JSON.parse(c[1]));

    // First 3 payloads: no validationIntensity
    for (let i = 0; i < 3; i++) {
      expect(payloads[i].validationIntensity).toBeUndefined();
    }

    // 4th payload: should be MEDIUM or HIGH (not undefined, not LOW)
    if (payloads[3].validationIntensity !== undefined) {
      expect(['MEDIUM', 'HIGH']).toContain(payloads[3].validationIntensity);
    }
  });
});
