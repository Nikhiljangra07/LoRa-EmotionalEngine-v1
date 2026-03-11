export {};

/**
 * InterventionPolicy ToneMode values (from appraisal-lab/intervention-policy-engine/types.ts):
 *   "NEUTRAL"            → undefined (absent)
 *   "DE_ESCALATE"        → GENTLE
 *   "STABILIZE"          → GENTLE
 *   "REFLECTIVE"         → GENTLE
 *   "AFFIRM_BOUNDARIED"  → GENTLE
 *   "FIRM_CONTAIN"       → FIRM (never during STABILIZE/DE_ESCALATE guidanceMode)
 */

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
  const base: Record<string, any> = { ...MOCK_NEUTRAL, intervention };
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

async function warmUpAndSend(engine: any, IP: any, text = 'test message') {
  for (let i = 0; i < 2; i++) {
    const w = IP.process('hello');
    await engine.processMessage(w.analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, w.signalPacket);
  }
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, LOW_NEUTRAL, false, {}, undefined, signalPacket);
}

function setAllFlags() {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_APPRAISAL_TONE_HINT = '1';
  process.env.LORA_INTERVENTION_TONE_HINT = '1';
}

describe('Intervention.toneHint contract', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // A) Flag off → prompt identity
  test('prompt is byte-identical when LORA_INTERVENTION_TONE_HINT is off', async () => {
    const stepFn = jest.fn().mockReturnValue(MOCK_NEUTRAL);

    clearFlags();
    const baseModules = loadModules(stepFn);
    const baseEngine = new baseModules.EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const baseResult = await warmUpAndSend(baseEngine, baseModules.InputProcessor);

    clearFlags();
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    process.env.LORA_APPRAISAL_TONE_HINT = '1';
    // LORA_INTERVENTION_TONE_HINT deliberately NOT set
    const onModules = loadModules(stepFn);
    const onEngine = new onModules.EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const onResult = await warmUpAndSend(onEngine, onModules.InputProcessor);

    expect(onResult.prompt).toBe(baseResult.prompt);
  });

  // B) Neutral policy → absent
  test('neutral toneMode (NEUTRAL) produces no toneHint key', async () => {
    clearFlags();
    setAllFlags();

    const stepFn = jest.fn().mockReturnValue(MOCK_NEUTRAL);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    await warmUpAndSend(engine, InputProcessor);

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.toneHint).toBeUndefined();

    const payloadCall = [...logSpy.mock.calls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    expect(payloadCall).toBeDefined();
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.toneHint).toBeUndefined();

    logSpy.mockRestore();
  });

  // C) Gentle policy → GENTLE
  test('STABILIZE toneMode → toneHint GENTLE and marker present', async () => {
    clearFlags();
    setAllFlags();

    const gentleResult = makeMock({ intervention: { toneMode: 'STABILIZE' } });
    const stepFn = jest.fn().mockReturnValue(gentleResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const result = await warmUpAndSend(engine, InputProcessor);

    expect(result.prompt).toContain('[TONE_HINT:GENTLE]');

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.toneHint).toBe('GENTLE');

    const payloadCall = [...logSpy.mock.calls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.toneHint).toBe('GENTLE');

    logSpy.mockRestore();
  });

  // C2) REFLECTIVE → GENTLE
  test('REFLECTIVE toneMode → toneHint GENTLE', async () => {
    clearFlags();
    setAllFlags();

    const reflective = makeMock({ intervention: { toneMode: 'REFLECTIVE' } });
    const stepFn = jest.fn().mockReturnValue(reflective);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    await warmUpAndSend(engine, InputProcessor);

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.toneHint).toBe('GENTLE');
  });

  // D) Firm policy → FIRM (only when not stabilizing)
  test('FIRM_CONTAIN toneMode → toneHint FIRM when not stabilizing', async () => {
    clearFlags();
    setAllFlags();

    const firmResult = makeMock({ intervention: { toneMode: 'FIRM_CONTAIN' } });
    const stepFn = jest.fn().mockReturnValue(firmResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);

    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const result = await warmUpAndSend(engine, InputProcessor);

    expect(result.prompt).toContain('[TONE_HINT:FIRM]');
    expect(result.prompt).not.toContain('[TONE_HINT:GENTLE]');

    const lastArgs = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastArgs.toneHint).toBe('FIRM');

    const payloadCall = [...logSpy.mock.calls].reverse().find(
      (c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'),
    );
    const payload = JSON.parse(payloadCall![1]);
    expect(payload.toneHint).toBe('FIRM');

    logSpy.mockRestore();
  });

  // E) Safety lock: STABILIZE overrides firm policy
  test('collapse event forces GENTLE even when toneMode is FIRM_CONTAIN', async () => {
    clearFlags();
    setAllFlags();

    const collapseWithFirm = makeMock({
      collapse: { event: true },
      intervention: { toneMode: 'FIRM_CONTAIN' },
    });
    const stepFn = jest.fn().mockReturnValue(collapseWithFirm);
    const { EngineOrchestrator, InputProcessor } = loadModules(stepFn);

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    const result = await warmUpAndSend(engine, InputProcessor);

    expect(result.prompt).toContain('[TONE_HINT:GENTLE]');
    expect(result.prompt).not.toContain('[TONE_HINT:FIRM]');
  });

  // F) No appraisal leakage
  test('builder args contain no appraisal-related keys', async () => {
    clearFlags();
    setAllFlags();

    const gentleResult = makeMock({ intervention: { toneMode: 'REFLECTIVE' } });
    const stepFn = jest.fn().mockReturnValue(gentleResult);
    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = loadModules(stepFn);
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));
    await warmUpAndSend(engine, InputProcessor);

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

  // G) Golden replay unchanged smoke
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
