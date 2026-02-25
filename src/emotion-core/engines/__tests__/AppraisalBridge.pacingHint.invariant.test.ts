export {};

// ── Mock result helpers ──────────────────────────────────────────────

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

const APPRAISAL_FORBIDDEN_KEYS = [
  'appraisal',
  'appraisalResult',
  'intervention',
  'policy',
  'appraisalHints',
];

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

function setupModules(opts: {
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

async function runOnce(EO: any, IP: any, text = 'I feel really stressed') {
  const engine = new EO(0.5, {}, () => ({
    generateResponse: async () => 'ok',
  }));
  const { analyzerOutputs, signalPacket } = IP.process(text);
  const result = await engine.processMessage(
    analyzerOutputs, undefined, false, {}, undefined, signalPacket,
  );
  return result;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AppraisalBridge pacingHint invariant', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // A) Flag off → no pacingHint passed to builder, prompts match baseline
  test('no pacingHint in builder args when LORA_APPRAISAL_PACING_HINT is off', async () => {
    const neutralResult = makeMockResult();
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } =
      setupModules({ bridge: true, mode: true, pacing: false, mockResult: neutralResult });

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    await runOnce(EngineOrchestrator, InputProcessor);

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const opts = buildSpy.mock.calls[0][2];
    expect(opts).not.toHaveProperty('pacingHint');
  });

  test('prompts match baseline when pacing flag is off', async () => {
    const neutralResult = makeMockResult();
    const text = 'I feel really stressed';

    // Run with all flags off (no bridge at all)
    delete process.env.LORA_APPRAISAL_BRIDGE;
    delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
    delete process.env.LORA_APPRAISAL_PACING_HINT;
    jest.resetModules();
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));
    const EO_off = require('../EngineOrchestrator').EngineOrchestrator;
    const IP_off = require('../../processors/InputProcessor').InputProcessor;
    const resultOff = await runOnce(EO_off, IP_off, text);

    // Run with bridge + mode ON but pacing OFF
    const { EngineOrchestrator, InputProcessor } =
      setupModules({ bridge: true, mode: true, pacing: false, mockResult: neutralResult });
    const resultOn = await runOnce(EngineOrchestrator, InputProcessor, text);

    expect(resultOn.prompt).toBe(resultOff.prompt);
  });

  // B) Flag on but neutral → prompt identity with baseline
  test('prompt identical to baseline when pacingHint is NORMAL', async () => {
    const neutralResult = makeMockResult();
    const text = 'I feel really stressed';

    // Baseline: no bridge
    delete process.env.LORA_APPRAISAL_BRIDGE;
    delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
    delete process.env.LORA_APPRAISAL_PACING_HINT;
    jest.resetModules();
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));
    const EO_base = require('../EngineOrchestrator').EngineOrchestrator;
    const IP_base = require('../../processors/InputProcessor').InputProcessor;
    const baselineResult = await runOnce(EO_base, IP_base, text);

    // All flags on, neutral appraisal → pacingHint='NORMAL' → no overlay
    const { EngineOrchestrator, InputProcessor } =
      setupModules({ bridge: true, mode: true, pacing: true, mockResult: neutralResult });
    const hintResult = await runOnce(EngineOrchestrator, InputProcessor, text);

    expect(hintResult.prompt).toBe(baselineResult.prompt);
  });

  test('decision payload omits pacingHint when flag on and neutral', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const neutralResult = makeMockResult();
    const { EngineOrchestrator, InputProcessor } =
      setupModules({ bridge: true, mode: true, pacing: true, mockResult: neutralResult });

    await runOnce(EngineOrchestrator, InputProcessor);

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    expect(call).toBeDefined();
    const payload = JSON.parse(call![1]);
    expect(payload.pacingHint).toBeUndefined();
  });

  // C) Flag on and SLOW → overlay present, no appraisal keys in builder
  test('collapse event produces SLOW hint with pacing overlay in prompt', async () => {
    const collapseResult = makeMockResult({ collapseEvent: true });
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } =
      setupModules({ bridge: true, mode: true, pacing: true, mockResult: collapseResult });

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const result = await runOnce(EngineOrchestrator, InputProcessor);

    // Overlay text present
    expect(result.prompt).toContain('Pacing: slow down');

    // pacingHint passed to builder
    const opts = buildSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.pacingHint).toBe('SLOW');

    // No appraisal objects leaked
    for (const arg of buildSpy.mock.calls[0]) {
      if (arg && typeof arg === 'object') {
        for (const key of APPRAISAL_FORBIDDEN_KEYS) {
          expect(arg).not.toHaveProperty(key);
        }
      }
    }
  });

  test('escalation level >= 2 produces SLOW hint', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const escalationResult = makeMockResult({ escalationLevel: 2 });
    const { EngineOrchestrator, InputProcessor } =
      setupModules({ bridge: true, mode: true, pacing: true, mockResult: escalationResult });

    const result = await runOnce(EngineOrchestrator, InputProcessor);

    expect(result.prompt).toContain('Pacing: slow down');

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.pacingHint).toBe('SLOW');
  });

  test('high pressure scalar produces SLOW hint', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const pressureResult = makeMockResult({ pressureScalar: 2.5 });
    const { EngineOrchestrator, InputProcessor } =
      setupModules({ bridge: true, mode: true, pacing: true, mockResult: pressureResult });

    const result = await runOnce(EngineOrchestrator, InputProcessor);

    expect(result.prompt).toContain('Pacing: slow down');

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.pacingHint).toBe('SLOW');
  });

  test('high pressure volatility produces SLOW hint', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const volResult = makeMockResult({ pressureVolatility: 1.5 });
    const { EngineOrchestrator, InputProcessor } =
      setupModules({ bridge: true, mode: true, pacing: true, mockResult: volResult });

    const result = await runOnce(EngineOrchestrator, InputProcessor);

    expect(result.prompt).toContain('Pacing: slow down');

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.pacingHint).toBe('SLOW');
  });

  // D) Golden replay hashes unaffected
  test('replay golden hashes are unaffected by pacing hint feature', () => {
    jest.resetModules();
    jest.unmock('../../../appraisal-bridge/AppraisalBridgeRunner');
    jest.unmock('../../../debug/sessionTrace');

    const path = require('path');
    const { runReplayFromFile } = require('../../../appraisal-bridge/replay/runReplay');

    const fixturesDir = path.join(
      __dirname, '..', '..', '..', 'appraisal-bridge', 'replay', 'fixtures',
    );

    const result = runReplayFromFile(path.join(fixturesDir, 'calm_baseline_50.json'));
    expect(result.hash).toBe('48225cb02b2b85c891ad515c5dfebe14363f27beaa472f853bd595413a4486ee');
    expect(result.outputsCount).toBe(50);
  });

  // E) layerD invariant: no appraisal keys even with all flags on
  test('builder args never contain appraisal keys even with all flags on', async () => {
    const slowResult = makeMockResult({ collapseEvent: true });
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } =
      setupModules({ bridge: true, mode: true, pacing: true, mockResult: slowResult });

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    await runOnce(EngineOrchestrator, InputProcessor);

    expect(buildSpy).toHaveBeenCalledTimes(1);
    for (const arg of buildSpy.mock.calls[0]) {
      if (arg && typeof arg === 'object') {
        for (const key of APPRAISAL_FORBIDDEN_KEYS) {
          expect(arg).not.toHaveProperty(key);
        }
      }
    }
  });
});
