export {};

function makeMockResult(overrides: {
  collapseEvent?: boolean;
  postClarityActive?: boolean;
}) {
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
      level: 0,
      score: 0.1,
      flags: Object.freeze({ warmedUp: false, isFlapping: false, enteredCritical: false }),
    }),
    collapse: Object.freeze({ event: overrides.collapseEvent ?? false, severity: 0, direction: 'NONE' }),
    postClarity: Object.freeze({
      active: overrides.postClarityActive ?? false,
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

const APPRAISAL_FORBIDDEN_KEYS = ['appraisal', 'appraisalResult', 'intervention', 'policy', 'appraisalHints'];

const origBridge = process.env.LORA_APPRAISAL_BRIDGE;
const origMode = process.env.LORA_APPRAISAL_BRIDGE_MODE;

function setupEnv(mockResult: ReturnType<typeof makeMockResult>) {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';

  jest.resetModules();

  jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
    AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
      step: jest.fn().mockReturnValue(mockResult),
      reset: jest.fn(),
    })),
  }));
  jest.doMock('../../../debug/sessionTrace', () => ({
    writeSessionTrace: jest.fn(),
  }));

  const { EngineOrchestrator } = require('../EngineOrchestrator');
  const { InputProcessor } = require('../../processors/InputProcessor');
  return { EngineOrchestrator, InputProcessor };
}

describe('AppraisalBridge new modes — prompt smoke', () => {
  afterEach(() => {
    if (origBridge === undefined) delete process.env.LORA_APPRAISAL_BRIDGE;
    else process.env.LORA_APPRAISAL_BRIDGE = origBridge;
    if (origMode === undefined) delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
    else process.env.LORA_APPRAISAL_BRIDGE_MODE = origMode;
    jest.restoreAllMocks();
  });

  test('collapse.event=true → STABILIZE mode, non-empty prompt', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setupEnv(
      makeMockResult({ collapseEvent: true }),
    );

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const { analyzerOutputs, signalPacket } = InputProcessor.process('I feel lost');
    const result = await engine.processMessage(
      analyzerOutputs, undefined, false, {}, undefined, signalPacket,
    );

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    expect(call).toBeDefined();
    const payload = JSON.parse(call![1]);

    expect(payload.promptProfile.guidanceMode).toBe('STABILIZE');
    expect(payload.appraisalOverride).toBe('COLLAPSE_OVERRIDE');

    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.prompt).toMatch(/grounding/i);
  });

  test('postClarity.active=true → SUPPORTIVE_REFLECTION mode, non-empty prompt', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setupEnv(
      makeMockResult({ postClarityActive: true }),
    );

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const { analyzerOutputs, signalPacket } = InputProcessor.process('I think I understand now');
    const result = await engine.processMessage(
      analyzerOutputs, undefined, false, {}, undefined, signalPacket,
    );

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    expect(call).toBeDefined();
    const payload = JSON.parse(call![1]);

    expect(payload.promptProfile.guidanceMode).toBe('SUPPORTIVE_REFLECTION');
    expect(payload.appraisalOverride).toBe('POST_CLARITY_OVERRIDE');

    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.prompt).toMatch(/reflect/i);
  });

  test('prompt args contain no appraisal-related keys in either new mode', async () => {
    const { EngineOrchestrator, InputProcessor } = setupEnv(
      makeMockResult({ collapseEvent: true }),
    );
    const { PromptTemplateBuilder } = require('../../prompt/PromptTemplateBuilder');
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const { analyzerOutputs, signalPacket } = InputProcessor.process('help');
    await engine.processMessage(analyzerOutputs, undefined, false, {}, undefined, signalPacket);

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
