const originalFlag = process.env.LORA_APPRAISAL_BRIDGE;

describe('AppraisalBridge wiring — flag OFF', () => {
  let mockStep: jest.Mock;
  let mockReset: jest.Mock;
  let MockRunner: jest.Mock;

  beforeEach(() => {
    delete process.env.LORA_APPRAISAL_BRIDGE;
    jest.resetModules();

    mockStep = jest.fn();
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

  test('AppraisalBridgeRunner is NOT constructed when flag is off', () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    expect(MockRunner).not.toHaveBeenCalled();
  });

  test('bridge.step() is never called during processMessage', async () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process('hello world');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

    expect(mockStep).not.toHaveBeenCalled();
  });

  test('decision log has no appraisal field when bridge is off', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process('hello world');
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
    expect(payload.appraisal).toBeUndefined();
  });
});
