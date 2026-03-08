export {};

// ── Mock result helper ───────────────────────────────────────────────

function makeMockResult(overrides: {
  collapseEvent?: boolean;
  escalationLevel?: number;
  pressureScalar?: number;
  pressureVolatility?: number;
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
      volatility: overrides.pressureVolatility ?? 0.05,
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
    postClarity: Object.freeze({
      active: false,
      agencyDeficit: 0,
      isRelapse: false,
      recoveryPath: 'UNKNOWN' as const,
    }),
    intervention: Object.freeze({
      toneMode: 'NEUTRAL',
      pacingMode: 'NORMAL',
      validationMode: 'STANDARD',
      actionMode: 'NONE',
      interruptionLevel: 0 as const,
      guardrails: Object.freeze([]),
    }),
  });
}

// ── Env snapshot ─────────────────────────────────────────────────────

const origBridge = process.env.LORA_APPRAISAL_BRIDGE;
const origMode = process.env.LORA_APPRAISAL_BRIDGE_MODE;
const origPacing = process.env.LORA_APPRAISAL_PACING_HINT;

function restoreEnv() {
  for (const [key, orig] of [
    ['LORA_APPRAISAL_BRIDGE', origBridge],
    ['LORA_APPRAISAL_BRIDGE_MODE', origMode],
    ['LORA_APPRAISAL_PACING_HINT', origPacing],
  ] as const) {
    if (orig === undefined) delete process.env[key];
    else process.env[key] = orig;
  }
}

function setup(opts: {
  bridge: boolean;
  mode: boolean;
  pacing: boolean;
  mockResult: ReturnType<typeof makeMockResult>;
}) {
  if (opts.bridge) process.env.LORA_APPRAISAL_BRIDGE = '1';
  else delete process.env.LORA_APPRAISAL_BRIDGE;
  if (opts.mode) process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  else delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
  if (opts.pacing) process.env.LORA_APPRAISAL_PACING_HINT = '1';
  else delete process.env.LORA_APPRAISAL_PACING_HINT;

  jest.resetModules();

  jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
    AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
      step: jest.fn().mockReturnValue(opts.mockResult),
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

async function runOnce(EO: any, IP: any, text = 'I feel terrible') {
  const engine = new EO(0.5, {}, () => ({
    generateResponse: async () => 'ok',
  }));
  // Warm-up: 2 messages to satisfy minimum stability horizon (3)
  for (let i = 0; i < 2; i++) {
    const w = IP.process('hello');
    await engine.processMessage(w.analyzerOutputs, undefined, false, {}, undefined, w.signalPacket);
  }
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(
    analyzerOutputs, undefined, false, {}, undefined, signalPacket,
  );
}

// ── Tests ────────────────────────────────────────────────────────────

describe('pacingHint contract', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // A) pacingHint NOT passed when flag off
  test('pacingHint absent in builder args when pacing flag is off', async () => {
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } =
      setup({ bridge: true, mode: true, pacing: false, mockResult: makeMockResult({ collapseEvent: true }) });

    const spy = jest.spyOn(PromptTemplateBuilder, 'build');
    await runOnce(EngineOrchestrator, InputProcessor);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const opts = lastCall[2] as Record<string, unknown> | undefined;
    expect(opts).toBeDefined();
    expect(opts).not.toHaveProperty('pacingHint');
  });

  // B) pacingHint NOT passed when computed === NORMAL
  test('pacingHint absent in builder args when computed result is neutral', async () => {
    const neutralResult = makeMockResult(); // all neutral: no collapse, escalation 0, low pressure
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } =
      setup({ bridge: true, mode: true, pacing: true, mockResult: neutralResult });

    const spy = jest.spyOn(PromptTemplateBuilder, 'build');
    await runOnce(EngineOrchestrator, InputProcessor);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const opts = lastCall[2] as Record<string, unknown> | undefined;
    expect(opts).toBeDefined();
    expect(opts).not.toHaveProperty('pacingHint');
  });

  // C) pacingHint passed when SLOW (collapse)
  test('pacingHint=SLOW passed in builder args on collapse', async () => {
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } =
      setup({ bridge: true, mode: true, pacing: true, mockResult: makeMockResult({ collapseEvent: true }) });

    const spy = jest.spyOn(PromptTemplateBuilder, 'build');
    await runOnce(EngineOrchestrator, InputProcessor);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const opts = lastCall[2] as Record<string, unknown>;
    expect(opts.pacingHint).toBe('SLOW');
  });

  // D) overlay marker present when SLOW
  test('prompt contains [PACING_HINT:SLOW] marker when hint is SLOW', async () => {
    const { EngineOrchestrator, InputProcessor } =
      setup({ bridge: true, mode: true, pacing: true, mockResult: makeMockResult({ collapseEvent: true }) });

    const result = await runOnce(EngineOrchestrator, InputProcessor);
    expect(result.prompt).toContain('[PACING_HINT:SLOW]');
  });

  // E) overlay marker absent when NORMAL
  test('prompt does NOT contain [PACING_HINT marker when neutral', async () => {
    const { EngineOrchestrator, InputProcessor } =
      setup({ bridge: true, mode: true, pacing: true, mockResult: makeMockResult() });

    const result = await runOnce(EngineOrchestrator, InputProcessor);
    expect(result.prompt).not.toContain('[PACING_HINT');
  });

  // F) overlay marker absent when feature disabled (even with collapse)
  test('prompt does NOT contain [PACING_HINT marker when pacing flag is off', async () => {
    const { EngineOrchestrator, InputProcessor } =
      setup({ bridge: true, mode: true, pacing: false, mockResult: makeMockResult({ collapseEvent: true }) });

    const result = await runOnce(EngineOrchestrator, InputProcessor);
    expect(result.prompt).not.toContain('[PACING_HINT');
  });
});
