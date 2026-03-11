export {};

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
  const base = { ...MOCK_NEUTRAL, ...overrides, intervention };
  if (overrides.collapse) base.collapse = Object.freeze({ ...MOCK_NEUTRAL.collapse, ...overrides.collapse });
  if (overrides.escalation) base.escalation = Object.freeze({ ...MOCK_NEUTRAL.escalation, ...overrides.escalation });
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

async function warmUpAndSend(
  engine: any,
  IP: any,
  stepResult: any,
  text = 'test message',
) {
  for (let i = 0; i < 2; i++) {
    const w = IP.process('hello');
    await engine.processMessage(w.analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, w.signalPacket);
  }
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, signalPacket);
}

describe('Intervention.validationHint contract', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // 1) Flag off → prompt identity
  test('prompt is byte-identical when LORA_INTERVENTION_VALIDATION_HINT is off', async () => {
    const stepFn = jest.fn().mockReturnValue(MOCK_NEUTRAL);

    clearFlags();
    const baseModules = loadModules(stepFn);
    const baseEngine = new baseModules.EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const baseResult = await warmUpAndSend(baseEngine, baseModules.InputProcessor, MOCK_NEUTRAL);

    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    // LORA_INTERVENTION_VALIDATION_HINT deliberately NOT set
    const onModules = loadModules(stepFn);
    const onEngine = new onModules.EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const onResult = await warmUpAndSend(onEngine, onModules.InputProcessor, MOCK_NEUTRAL);

    expect(onResult.prompt).toBe(baseResult.prompt);
  });

  // 2) Neutral policy → key absent
  test('neutral validationMode (STANDARD) produces no validationHint key', async () => {
    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';

    const stepFn = jest.fn().mockReturnValue(MOCK_NEUTRAL);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    await warmUpAndSend(engine, InputProcessor, MOCK_NEUTRAL);

    const lastBuildArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastBuildArgs.validationHint).toBeUndefined();

    const logCalls = logSpy.mock.calls;
    const payloadCall = [...logCalls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    expect(payloadCall).toBeDefined();
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.validationHint).toBeUndefined();

    logSpy.mockRestore();
  });

  // 3) STABILIZE forces STRONG
  test('collapse → STABILIZE produces STRONG marker and payload', async () => {
    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';

    const collapseResult = makeMock({ collapse: { event: true } });
    const stepFn = jest.fn().mockReturnValue(collapseResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const result = await warmUpAndSend(engine, InputProcessor, collapseResult);

    expect(result.prompt).toContain('[VALIDATION_HINT:STRONG]');

    const lastBuildArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastBuildArgs.validationHint).toBe('STRONG');

    const logCalls = logSpy.mock.calls;
    const payloadCall = [...logCalls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.validationHint).toBe('STRONG');

    logSpy.mockRestore();
  });

  // 4) Non-stabilizing LIGHT mapping (LIMITED validationMode)
  test('LIMITED validationMode → LIGHT marker and payload', async () => {
    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';

    const limitedResult = makeMock({
      escalation: { level: 1, score: 0.3 },
      intervention: { validationMode: 'LIMITED' },
    });
    const stepFn = jest.fn().mockReturnValue(limitedResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const result = await warmUpAndSend(engine, InputProcessor, limitedResult);

    expect(result.prompt).toContain('[VALIDATION_HINT:LIGHT]');

    const lastBuildArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastBuildArgs.validationHint).toBe('LIGHT');

    const logCalls = logSpy.mock.calls;
    const payloadCall = [...logCalls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.validationHint).toBe('LIGHT');

    logSpy.mockRestore();
  });

  // 5) No appraisal leakage
  test('builder args contain no appraisal-related keys', async () => {
    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';

    const collapseResult = makeMock({ collapse: { event: true } });
    const stepFn = jest.fn().mockReturnValue(collapseResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    await warmUpAndSend(engine, InputProcessor, collapseResult);

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

  // 6) Golden replay unchanged smoke
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
