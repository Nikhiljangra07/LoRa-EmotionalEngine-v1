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
  'LORA_INTERVENTION_PACING_HINT',
  'LORA_INTERVENTION_TONE_HINT',
  'LORA_INTERVENTION_ACTION_HINT',
  'LORA_TEST_VERBOSE',
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

const MOCK_WITH_ACTION = Object.freeze({
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
    actionMode: 'ENCOURAGE_PAUSE',
    interruptionLevel: 0 as const,
    guardrails: Object.freeze([]),
  }),
});

const LOW_NEUTRAL = { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.5 };

describe('InterventionActionHorizon', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  test('actionHint from intervention.actionMode only activates after msg 3', async () => {
    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_INTERVENTION_ACTION_HINT = '1';

    jest.resetModules();
    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: jest.fn().mockReturnValue(MOCK_WITH_ACTION),
        reset: jest.fn(),
      })),
    }));
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));

    const { EngineOrchestrator } = require('../../engines/EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const ip = InputProcessor;

    const prompts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { analyzerOutputs, signalPacket } = ip.process('hello');
      const res = await engine.processMessage(analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, signalPacket);
      prompts.push(res.prompt);
    }

    expect(prompts[0]).not.toContain('[ACTION_HINT:');
    expect(prompts[1]).not.toContain('[ACTION_HINT:');
    expect(prompts[2]).toContain('[ACTION_HINT:ENCOURAGE_BREATH]');
  });

  test('INTERRUPT_LOOP actionMode produces SUGGEST_BREAK after horizon', async () => {
    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_INTERVENTION_ACTION_HINT = '1';

    const mockWithInterrupt = Object.freeze({
      ...MOCK_WITH_ACTION,
      intervention: Object.freeze({
        ...MOCK_WITH_ACTION.intervention,
        actionMode: 'INTERRUPT_LOOP',
      }),
    });

    jest.resetModules();
    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step: jest.fn().mockReturnValue(mockWithInterrupt),
        reset: jest.fn(),
      })),
    }));
    jest.doMock('../../../debug/sessionTrace', () => ({
      writeSessionTrace: jest.fn(),
    }));

    const { EngineOrchestrator } = require('../../engines/EngineOrchestrator');
    const { InputProcessor } = require('../../processors/InputProcessor');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const prompts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { analyzerOutputs, signalPacket } = InputProcessor.process('hello');
      const res = await engine.processMessage(analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, signalPacket);
      prompts.push(res.prompt);
    }

    expect(prompts[0]).not.toContain('[ACTION_HINT:');
    expect(prompts[1]).not.toContain('[ACTION_HINT:');
    expect(prompts[2]).toContain('[ACTION_HINT:SUGGEST_BREAK]');
  });
});
