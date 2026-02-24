/**
 * Layer D non-consumption invariant:
 * PromptTemplateBuilder.build() must never receive appraisal-derived keys,
 * and prompt output must be identical whether the bridge is ON or OFF.
 */

const originalFlag = process.env.LORA_APPRAISAL_BRIDGE;

const MOCK_APPRAISAL_RESULT = Object.freeze({
  timestamp: 1_000_000,
  family: Object.freeze({
    dominantFamily: 'SADNESS',
    weights: Object.freeze({ JOY: 0.1, ANGER: 0.1, FEAR: 0.1, SADNESS: 0.4, SURPRISE: 0.1, DISGUST: 0.2 }),
    confidence: 0.7,
  }),
  pressure: Object.freeze({ scalar: 0.3, slope: 0.01, volatility: 0.05, isShock: false, byFamily: Object.freeze({}) }),
  mood: Object.freeze({ category: 'NEUTRAL', dominance: 0.5, confidence: 0.6 }),
  escalation: Object.freeze({ level: 0, score: 0.1, flags: Object.freeze({ warmedUp: false, isFlapping: false, enteredCritical: false }) }),
  collapse: Object.freeze({ event: false, severity: 0, direction: 'NONE' }),
  postClarity: Object.freeze({ active: false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
  intervention: Object.freeze({ toneMode: 'NEUTRAL', pacingMode: 'NORMAL', validationMode: 'STANDARD', actionMode: 'NONE', interruptionLevel: 0 as const, guardrails: Object.freeze([]) }),
});

const FORBIDDEN_KEYS = [
  'appraisal',
  'appraisalResult',
  'intervention',
  'policy',
  'appraisalHints',
];

describe('Layer D non-consumption invariant', () => {
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.LORA_APPRAISAL_BRIDGE;
    } else {
      process.env.LORA_APPRAISAL_BRIDGE = originalFlag;
    }
    jest.restoreAllMocks();
  });

  test('PromptTemplateBuilder.build() receives no appraisal-related keys when bridge is ON', async () => {
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    jest.resetModules();

    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: jest.fn().mockReturnValue(MOCK_APPRAISAL_RESULT),
        reset: jest.fn(),
      })),
    }));
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));

    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { PromptTemplateBuilder } = require('../../prompt/PromptTemplateBuilder');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process('I feel stressed and overwhelmed');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket,
    );

    expect(buildSpy).toHaveBeenCalledTimes(1);

    const callArgs = buildSpy.mock.calls[0];
    for (const arg of callArgs) {
      if (arg && typeof arg === 'object') {
        for (const key of FORBIDDEN_KEYS) {
          expect(arg).not.toHaveProperty(key);
        }
      }
    }
  });

  test('prompt output is identical with bridge ON vs OFF for the same input', async () => {
    // ── Run 1: bridge OFF ───────────────────────────────────────────
    delete process.env.LORA_APPRAISAL_BRIDGE;
    jest.resetModules();
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));

    let EO = require('../EngineOrchestrator').EngineOrchestrator;
    let IP = require('../../processors/InputProcessor').InputProcessor;

    let engine = new EO(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    let parsed = IP.process('I feel stressed and overwhelmed');
    const resultOff = await engine.processMessage(
      parsed.analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      parsed.signalPacket,
    );

    // ── Run 2: bridge ON ────────────────────────────────────────────
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    jest.resetModules();
    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: jest.fn().mockReturnValue(MOCK_APPRAISAL_RESULT),
        reset: jest.fn(),
      })),
    }));
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));

    EO = require('../EngineOrchestrator').EngineOrchestrator;
    IP = require('../../processors/InputProcessor').InputProcessor;

    engine = new EO(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    parsed = IP.process('I feel stressed and overwhelmed');
    const resultOn = await engine.processMessage(
      parsed.analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      parsed.signalPacket,
    );

    expect(resultOn.prompt).toBe(resultOff.prompt);
  });
});
