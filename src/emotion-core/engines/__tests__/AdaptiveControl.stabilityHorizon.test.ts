export {};

function makeMockResult(overrides: {
  collapseEvent?: boolean;
  escalationLevel?: number;
  pressureScalar?: number;
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
    postClarity: Object.freeze({ active: false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
    intervention: Object.freeze({ toneMode: 'NEUTRAL', pacingMode: 'NORMAL', validationMode: 'STANDARD', actionMode: 'NONE', interruptionLevel: 0 as const, guardrails: Object.freeze([]) }),
  });
}

const ENV_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_APPRAISAL_PACING_HINT',
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

function setupAll(stepFn: jest.Mock) {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_APPRAISAL_PACING_HINT = '1';
  process.env.LORA_DRIFT_MONITOR = '1';

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

function makeEngine(EO: any) {
  return new EO(0.5, {}, () => ({
    generateResponse: async () => 'ok',
  }));
}

async function send(engine: any, IP: any, text = 'test') {
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, undefined, false, {}, undefined, signalPacket);
}

describe('Adaptive control — minimum stability horizon', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // A) First two messages: no adaptive features activate
  test('first two messages produce no override, no pacingHint, no drift tracking', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const collapseResult = makeMockResult({ collapseEvent: true, escalationLevel: 3 });
    const stepFn = jest.fn().mockReturnValue(collapseResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupAll(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = makeEngine(EngineOrchestrator);

    // Message 1
    await send(engine, InputProcessor);
    // Message 2
    await send(engine, InputProcessor);

    // Check builder calls — no pacingHint in options
    for (const call of buildSpy.mock.calls) {
      const opts = call[2] as Record<string, unknown> | undefined;
      expect(opts).not.toHaveProperty('pacingHint');
    }

    // Check decision payloads — no override, no pacingHint, no driftDetected
    const payloads = logSpy.mock.calls
      .filter((c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
      .map((c) => JSON.parse(c[1]));

    expect(payloads).toHaveLength(2);
    for (const p of payloads) {
      expect(p.appraisalOverride).toBeUndefined();
      expect(p.pacingHint).toBeUndefined();
      expect(p.driftDetected).toBeUndefined();
      expect(p.promptProfile.guidanceMode).not.toBe('STABILIZE');
    }

    // No drift warning
    const driftWarns = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    expect(driftWarns).toHaveLength(0);
  });

  // B) Third message: adaptive logic activates normally
  test('third message activates override, pacingHint, and drift tracking', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const collapseResult = makeMockResult({ collapseEvent: true });
    const stepFn = jest.fn().mockReturnValue(collapseResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupAll(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = makeEngine(EngineOrchestrator);

    // Messages 1–2: warm up
    await send(engine, InputProcessor);
    await send(engine, InputProcessor);
    // Message 3: should activate
    await send(engine, InputProcessor);

    // Third call to build should have pacingHint
    const thirdOpts = buildSpy.mock.calls[2][2] as Record<string, unknown>;
    expect(thirdOpts.pacingHint).toBe('SLOW');

    // Third payload should have override
    const payloads = logSpy.mock.calls
      .filter((c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
      .map((c) => JSON.parse(c[1]));

    expect(payloads[2].appraisalOverride).toBe('COLLAPSE_OVERRIDE');
    expect(payloads[2].promptProfile.guidanceMode).toBe('STABILIZE');
    expect(payloads[2].pacingHint).toBe('SLOW');
  });

  // C) Collapse event on first message does NOT override guidanceMode
  test('collapse on first message does not override guidanceMode', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const collapseResult = makeMockResult({ collapseEvent: true });
    const stepFn = jest.fn().mockReturnValue(collapseResult);
    const { EngineOrchestrator, InputProcessor } = setupAll(stepFn);

    const engine = makeEngine(EngineOrchestrator);
    await send(engine, InputProcessor);

    const payloads = logSpy.mock.calls
      .filter((c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
      .map((c) => JSON.parse(c[1]));

    expect(payloads[0].promptProfile.guidanceMode).not.toBe('STABILIZE');
    expect(payloads[0].appraisalOverride).toBeUndefined();
  });

  // D) Escalation on second message does NOT trigger pacingHint
  test('escalation on second message does not produce pacingHint', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const escalationResult = makeMockResult({ escalationLevel: 3 });
    const stepFn = jest.fn().mockReturnValue(escalationResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupAll(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = makeEngine(EngineOrchestrator);
    await send(engine, InputProcessor); // msg 1
    await send(engine, InputProcessor); // msg 2

    for (const call of buildSpy.mock.calls) {
      const opts = call[2] as Record<string, unknown> | undefined;
      expect(opts).not.toHaveProperty('pacingHint');
    }

    const payloads = logSpy.mock.calls
      .filter((c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
      .map((c) => JSON.parse(c[1]));

    for (const p of payloads) {
      expect(p.pacingHint).toBeUndefined();
    }
  });

  // E) Drift oscillation in first two messages does NOT log warning
  test('oscillation in first two messages does not trigger drift warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      return callIdx % 2 === 0
        ? makeMockResult({ collapseEvent: true })
        : makeMockResult();
    });

    const { EngineOrchestrator, InputProcessor } = setupAll(stepFn);
    const engine = makeEngine(EngineOrchestrator);

    // Only send 2 messages
    await send(engine, InputProcessor);
    await send(engine, InputProcessor);

    const driftWarns = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    expect(driftWarns).toHaveLength(0);
  });
});
