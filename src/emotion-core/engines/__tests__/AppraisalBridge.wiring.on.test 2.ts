export {};

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

describe('AppraisalBridge wiring — flag ON', () => {
  let mockStep: jest.Mock;
  let mockReset: jest.Mock;
  let MockRunner: jest.Mock;

  beforeEach(() => {
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    jest.resetModules();

    mockStep = jest.fn().mockReturnValue(MOCK_APPRAISAL_RESULT);
    mockReset = jest.fn();
    MockRunner = jest.fn().mockImplementation(() => ({
      step: mockStep,
      reset: mockReset,
    }));

    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: MockRunner,
    }));
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.LORA_APPRAISAL_BRIDGE;
    } else {
      process.env.LORA_APPRAISAL_BRIDGE = originalFlag;
    }
    jest.restoreAllMocks();
  });

  test('AppraisalBridgeRunner IS constructed when flag is on', () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    expect(MockRunner).toHaveBeenCalledTimes(1);
  });

  test('bridge.step() is called exactly once per processMessage', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process('I feel really overwhelmed');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

    expect(mockStep).toHaveBeenCalledTimes(1);

    const snapshot = mockStep.mock.calls[0][0];
    expect(snapshot).toHaveProperty('messageIndex');
    expect(snapshot).toHaveProperty('eivValue');
    expect(snapshot).toHaveProperty('deltaMessageSeconds');
    expect(snapshot).toHaveProperty('emotionalState');
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  test('bridge.step() called once per message across multiple messages', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    for (let i = 0; i < 3; i++) {
      const { analyzerOutputs, signalPacket } =
        InputProcessor.process(`message ${i}`);
      await engine.processMessage(
        analyzerOutputs,
        undefined,
        false,
        {},
        undefined,
        signalPacket
      );
    }

    expect(mockStep).toHaveBeenCalledTimes(3);
  });

  test('endSession() calls bridge.reset()', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process('test');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

    engine.endSession();
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  test('decision log includes appraisal field when bridge is on', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process('hello');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

    const decisionCall = logSpy.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]')
    );
    expect(decisionCall).toBeDefined();
    const payload = JSON.parse(decisionCall![1]);
    expect(payload.appraisal).toBeDefined();
    expect(payload.appraisal.escalationLevel).toBe(0);
    expect(payload.appraisal.moodCategory).toBe('NEUTRAL');
    expect(payload.appraisal.interventionToneMode).toBe('NEUTRAL');
  });

  test('EIV still computed exactly once when bridge is on', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');
    const { EIVScorer } = require('../../scorers/EIVScorer');

    const calculateSpy = jest.spyOn(EIVScorer, 'calculate');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process('test message');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

    expect(calculateSpy).toHaveBeenCalledTimes(1);
    calculateSpy.mockRestore();
  });
});
