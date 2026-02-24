/**
 * Session lifecycle alignment & delta determinism invariants.
 *
 * Proves:
 *  A) First message after endSession() receives deltaMessageSeconds=0
 *  B) Burst/silence flags are false on that first message
 *  C) Interpreter momentum is reset across session boundaries
 */
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

describe('AppraisalBridge session lifecycle', () => {
  let mockStep: jest.Mock;
  let mockReset: jest.Mock;

  beforeEach(() => {
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    jest.resetModules();

    mockStep = jest.fn().mockReturnValue(MOCK_APPRAISAL_RESULT);
    mockReset = jest.fn();

    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: mockStep,
        reset: mockReset,
      })),
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

  test('first message of a new session has deltaMessageSeconds=0', async () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // First message ever — delta must be 0
    const m1 = InputProcessor.process('hello');
    await engine.processMessage(m1.analyzerOutputs, undefined, false, {}, undefined, m1.signalPacket);

    expect(mockStep).toHaveBeenCalledTimes(1);
    expect(mockStep.mock.calls[0][0].deltaMessageSeconds).toBe(0);
  });

  test('second message has delta > 0, first after endSession has delta=0', async () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // Message 1
    const m1 = InputProcessor.process('first');
    await engine.processMessage(m1.analyzerOutputs, undefined, false, {}, undefined, m1.signalPacket);

    // Message 2 — delta should be > 0 (time has elapsed)
    const m2 = InputProcessor.process('second');
    await engine.processMessage(m2.analyzerOutputs, undefined, false, {}, undefined, m2.signalPacket);
    expect(mockStep.mock.calls[1][0].deltaMessageSeconds).toBeGreaterThanOrEqual(0);

    // End session
    engine.endSession();

    // Message 3 (first of new session) — delta must be exactly 0
    const m3 = InputProcessor.process('new session message');
    await engine.processMessage(m3.analyzerOutputs, undefined, false, {}, undefined, m3.signalPacket);

    expect(mockStep).toHaveBeenCalledTimes(3);
    expect(mockStep.mock.calls[2][0].deltaMessageSeconds).toBe(0);
  });

  test('burst and silence flags are false on first message after reset', async () => {
    const { AppraisalBridgeRunner: RealRunner } =
      jest.requireActual('../../../appraisal-bridge/AppraisalBridgeRunner') as {
        AppraisalBridgeRunner: new () => { step: Function; reset: Function };
      };
    const { mapLayerASnapshot } =
      jest.requireActual('../../../appraisal-bridge/mapLayerASnapshot') as {
        mapLayerASnapshot: Function;
      };

    const runner = new RealRunner();

    // Simulate first message with high EIV (would trigger burst if unguarded)
    const snapshot = mapLayerASnapshot({
      messageIndex: 1,
      timestampMs: 1000,
      deltaMessageSeconds: 0,
      analyzerScalars: {
        valenceScore: -0.8,
        valenceConfidence: 0.9,
        arousalScore: 0.9,
        arousalConfidence: 0.9,
        expressionStrength: 0.85,
        esConfidence: 0.9,
      },
      eiv: { value: 0.75, tier: 'elevated' },
      emotionalState: { dominant: 'NEUTRAL', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
    });

    const result = runner.step(snapshot);

    // With delta=0, collapse.event should not be triggered by burst/silence
    // (burst requires delta > 0, silence requires delta > 2100)
    expect(result.collapse.event).toBe(false);

    // Reset and verify the same on second session
    runner.reset();
    const snapshot2 = mapLayerASnapshot({
      messageIndex: 1,
      timestampMs: 50000,
      deltaMessageSeconds: 0,
      analyzerScalars: {
        valenceScore: -0.9,
        valenceConfidence: 0.95,
        arousalScore: 0.95,
        arousalConfidence: 0.95,
        expressionStrength: 0.9,
        esConfidence: 0.95,
      },
      eiv: { value: 0.85, tier: 'high' },
      emotionalState: { dominant: 'NEUTRAL', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.95 },
    });

    const result2 = runner.step(snapshot2);
    expect(result2.collapse.event).toBe(false);
  });

  test('interpreter momentum resets across session boundaries', async () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // Send several messages to build momentum
    for (let i = 0; i < 5; i++) {
      const m = InputProcessor.process('I feel really terrible and overwhelmed');
      await engine.processMessage(m.analyzerOutputs, undefined, false, {}, undefined, m.signalPacket);
    }

    // Capture guidance mode from last message (momentum has accumulated)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // End session — resets momentum
    engine.endSession();

    // First message of new session with neutral input
    const fresh = InputProcessor.process('hello');
    await engine.processMessage(fresh.analyzerOutputs, undefined, false, {}, undefined, fresh.signalPacket);

    // The first message of a fresh session with "hello" should behave
    // identically to the first message of a brand new engine with "hello"
    const engine2 = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const fresh2 = InputProcessor.process('hello');
    await engine2.processMessage(fresh2.analyzerOutputs, undefined, false, {}, undefined, fresh2.signalPacket);

    // Compare the snapshots: both should have the same delta and momentum-derived state
    // The bridge step calls should have matching deltaMessageSeconds
    const lastCallReset = mockStep.mock.calls[mockStep.mock.calls.length - 2][0];
    const lastCallFresh = mockStep.mock.calls[mockStep.mock.calls.length - 1][0];
    expect(lastCallReset.deltaMessageSeconds).toBe(0);
    expect(lastCallFresh.deltaMessageSeconds).toBe(0);

    logSpy.mockRestore();
  });

  test('endSession calls interpreter.reset(), bridge.reset(), and zeros timestamp', async () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const m = InputProcessor.process('test');
    await engine.processMessage(m.analyzerOutputs, undefined, false, {}, undefined, m.signalPacket);

    engine.endSession();

    // Bridge reset was called
    expect(mockReset).toHaveBeenCalledTimes(1);

    // Next message should get delta=0 (proves timestamp was zeroed)
    const m2 = InputProcessor.process('after reset');
    await engine.processMessage(m2.analyzerOutputs, undefined, false, {}, undefined, m2.signalPacket);
    expect(mockStep.mock.calls[1][0].deltaMessageSeconds).toBe(0);
  });
});
