export {};

// ── Helpers ──────────────────────────────────────────────────────────

function makeMockResult(overrides: {
  escalationLevel?: number;
  collapseEvent?: boolean;
  postClarityActive?: boolean;
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

const FORBIDDEN_KEYS = ['appraisal', 'appraisalResult', 'intervention', 'policy', 'appraisalHints'];

// ── Env snapshot ─────────────────────────────────────────────────────

const origBridge = process.env.LORA_APPRAISAL_BRIDGE;
const origMode = process.env.LORA_APPRAISAL_BRIDGE_MODE;

// ── Tests ────────────────────────────────────────────────────────────

describe('AppraisalBridge guidanceMode override', () => {
  afterEach(() => {
    // Restore env
    if (origBridge === undefined) delete process.env.LORA_APPRAISAL_BRIDGE;
    else process.env.LORA_APPRAISAL_BRIDGE = origBridge;
    if (origMode === undefined) delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
    else process.env.LORA_APPRAISAL_BRIDGE_MODE = origMode;
    jest.restoreAllMocks();
  });

  function setup(opts: { bridgeOn: boolean; modeOn: boolean; mockResult: ReturnType<typeof makeMockResult> }) {
    process.env.LORA_APPRAISAL_BRIDGE = opts.bridgeOn ? '1' : undefined as any;
    if (!opts.bridgeOn) delete process.env.LORA_APPRAISAL_BRIDGE;
    process.env.LORA_APPRAISAL_BRIDGE_MODE = opts.modeOn ? '1' : undefined as any;
    if (!opts.modeOn) delete process.env.LORA_APPRAISAL_BRIDGE_MODE;

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
    return { EngineOrchestrator, InputProcessor };
  }

  async function runOne(EO: any, IP: any, text = 'I feel really terrible') {
    const engine = new EO(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const { analyzerOutputs, signalPacket } = IP.process(text);
    await engine.processMessage(analyzerOutputs, undefined, false, {}, undefined, signalPacket);
    return engine;
  }

  // A) Flag off → no override
  test('no override when LORA_APPRAISAL_BRIDGE_MODE is off', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setup({
      bridgeOn: true,
      modeOn: false,
      mockResult: makeMockResult({ escalationLevel: 3 }),
    });

    await runOne(EngineOrchestrator, InputProcessor);

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    expect(call).toBeDefined();
    const payload = JSON.parse(call![1]);
    expect(payload.promptProfile.guidanceMode).not.toBe('STABILIZE');
    expect(payload.appraisalOverride).toBeUndefined();
  });

  // B) Escalation level 2 → DE_ESCALATE
  test('escalation level >= 2 forces DE_ESCALATE', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setup({
      bridgeOn: true,
      modeOn: true,
      mockResult: makeMockResult({ escalationLevel: 2 }),
    });

    await runOne(EngineOrchestrator, InputProcessor);

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.promptProfile.guidanceMode).toBe('DE_ESCALATE');
    expect(payload.appraisalOverride).toBe('ESCALATION_OVERRIDE');
  });

  // C) Collapse event → STABILIZE
  test('collapse event forces STABILIZE', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setup({
      bridgeOn: true,
      modeOn: true,
      mockResult: makeMockResult({ collapseEvent: true }),
    });

    await runOne(EngineOrchestrator, InputProcessor);

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.promptProfile.guidanceMode).toBe('STABILIZE');
    expect(payload.appraisalOverride).toBe('COLLAPSE_OVERRIDE');
  });

  // D) PostClarity active → SUPPORTIVE_REFLECTION
  test('postClarity active forces SUPPORTIVE_REFLECTION', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setup({
      bridgeOn: true,
      modeOn: true,
      mockResult: makeMockResult({ postClarityActive: true }),
    });

    await runOne(EngineOrchestrator, InputProcessor);

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.promptProfile.guidanceMode).toBe('SUPPORTIVE_REFLECTION');
    expect(payload.appraisalOverride).toBe('POST_CLARITY_OVERRIDE');
  });

  // E) Priority order: collapse > escalation > postClarity
  test('collapse takes priority over escalation and postClarity', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setup({
      bridgeOn: true,
      modeOn: true,
      mockResult: makeMockResult({
        collapseEvent: true,
        escalationLevel: 3,
        postClarityActive: true,
      }),
    });

    await runOne(EngineOrchestrator, InputProcessor);

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.promptProfile.guidanceMode).toBe('STABILIZE');
    expect(payload.appraisalOverride).toBe('COLLAPSE_OVERRIDE');
  });

  test('escalation takes priority over postClarity', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { EngineOrchestrator, InputProcessor } = setup({
      bridgeOn: true,
      modeOn: true,
      mockResult: makeMockResult({
        escalationLevel: 2,
        postClarityActive: true,
      }),
    });

    await runOne(EngineOrchestrator, InputProcessor);

    const call = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(call![1]);
    expect(payload.promptProfile.guidanceMode).toBe('DE_ESCALATE');
    expect(payload.appraisalOverride).toBe('ESCALATION_OVERRIDE');
  });

  // F) PromptTemplateBuilder still receives no appraisal keys
  test('PromptTemplateBuilder args contain no appraisal keys when override active', async () => {
    const { EngineOrchestrator, InputProcessor } = setup({
      bridgeOn: true,
      modeOn: true,
      mockResult: makeMockResult({ collapseEvent: true }),
    });

    const { PromptTemplateBuilder } = require('../../prompt/PromptTemplateBuilder');
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    await runOne(EngineOrchestrator, InputProcessor);

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

  // G) Golden replay hashes remain identical (bridge runner not affected)
  test('replay golden hashes are unaffected by mode flag', () => {
    // Fully clear mocks so the REAL AppraisalBridgeRunner is loaded.
    jest.resetModules();
    jest.unmock('../../../appraisal-bridge/AppraisalBridgeRunner');
    jest.unmock('../../../debug/sessionTrace');

    const path = require('path');
    const { runReplayFromFile } = require('../../../appraisal-bridge/replay/runReplay');

    const fixturesDir = path.join(__dirname, '..', '..', '..', 'appraisal-bridge', 'replay', 'fixtures');

    const result = runReplayFromFile(path.join(fixturesDir, 'calm_baseline_50.json'));
    expect(result.hash).toBe('48225cb02b2b85c891ad515c5dfebe14363f27beaa472f853bd595413a4486ee');
    expect(result.outputsCount).toBe(50);
  });
});
