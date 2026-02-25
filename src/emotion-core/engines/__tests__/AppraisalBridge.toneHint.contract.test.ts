export {};

const APPRAISAL_FORBIDDEN_KEYS = [
  'appraisal',
  'appraisalResult',
  'intervention',
  'policy',
  'appraisalHints',
];

function makeMockResult(overrides: {
  collapseEvent?: boolean;
  escalationLevel?: number;
  interruptionLevel?: 0 | 1 | 2 | 3;
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
    postClarity: Object.freeze({ active: overrides.postClarityActive ?? false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
    intervention: Object.freeze({
      toneMode: 'NEUTRAL',
      pacingMode: 'NORMAL',
      validationMode: 'STANDARD',
      actionMode: 'NONE',
      interruptionLevel: (overrides.interruptionLevel ?? 0) as 0 | 1 | 2 | 3,
      guardrails: Object.freeze([]),
    }),
  });
}

const ENV_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_APPRAISAL_TONE_HINT',
] as const;
const origEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) origEnv[k] = process.env[k];

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

function setupModules(opts: {
  toneHint: boolean;
  bridge?: boolean;
  mode?: boolean;
  stepFn?: jest.Mock;
  mockResult?: ReturnType<typeof makeMockResult>;
}) {
  if (opts.bridge !== false) process.env.LORA_APPRAISAL_BRIDGE = '1';
  else delete process.env.LORA_APPRAISAL_BRIDGE;
  if (opts.mode !== false) process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  else delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
  if (opts.toneHint) process.env.LORA_APPRAISAL_TONE_HINT = '1';
  else delete process.env.LORA_APPRAISAL_TONE_HINT;

  jest.resetModules();

  const step = opts.stepFn ?? (opts.mockResult ? jest.fn().mockReturnValue(opts.mockResult) : undefined);
  if (step) {
    jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
      AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
        step,
        reset: jest.fn(),
      })),
    }));
  }
  jest.doMock('../../../debug/sessionTrace', () => ({
    writeSessionTrace: jest.fn(),
  }));

  const { EngineOrchestrator } = require('../EngineOrchestrator');
  const { InputProcessor } = require('../../processors/InputProcessor');
  const { PromptTemplateBuilder } = require('../../prompt/PromptTemplateBuilder');
  return { EngineOrchestrator, InputProcessor, PromptTemplateBuilder };
}

function makeEngine(EO: any) {
  return new EO(0.5, {}, () => ({ generateResponse: async () => 'ok' }));
}

async function send(engine: any, IP: any, text = 'test') {
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, undefined, false, {}, undefined, signalPacket);
}

async function warmUpAndSend(engine: any, IP: any, text = 'test') {
  for (let i = 0; i < 2; i++) {
    const w = IP.process('hello');
    await engine.processMessage(w.analyzerOutputs, undefined, false, {}, undefined, w.signalPacket);
  }
  return send(engine, IP, text);
}

function getPayloads(logSpy: jest.SpyInstance) {
  return logSpy.mock.calls
    .filter((c: any[]) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
    .map((c: any[]) => JSON.parse(c[1]));
}

describe('ToneHint contract', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // 1) Flag OFF → prompt identity
  test('prompt is byte-identical when LORA_APPRAISAL_TONE_HINT is off', async () => {
    const neutralResult = makeMockResult();

    const { EngineOrchestrator: EO1, InputProcessor: IP1 } = setupModules({
      toneHint: false, bridge: true, mode: true, mockResult: neutralResult,
    });
    const e1 = makeEngine(EO1);
    const r1 = await warmUpAndSend(e1, IP1, 'I feel really terrible about this');

    const { EngineOrchestrator: EO2, InputProcessor: IP2 } = setupModules({
      toneHint: false, bridge: true, mode: true, mockResult: neutralResult,
    });
    const e2 = makeEngine(EO2);
    const r2 = await warmUpAndSend(e2, IP2, 'I feel really terrible about this');

    expect(r1.prompt).toBe(r2.prompt);
    expect(r1.prompt).not.toContain('[TONE_HINT:');
  });

  // 2) All flags ON but neutral conditions → toneHint absent
  test('neutral appraisal produces no toneHint in builder args or payload', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const neutralResult = makeMockResult();

    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupModules({
      toneHint: true, bridge: true, mode: true, mockResult: neutralResult,
    });
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const engine = makeEngine(EngineOrchestrator);
    const result = await warmUpAndSend(engine, InputProcessor, 'things are ok');

    // Builder args: no toneHint key
    const lastOpts = buildSpy.mock.calls[buildSpy.mock.calls.length - 1][2] as Record<string, unknown>;
    expect(lastOpts).not.toHaveProperty('toneHint');

    // Prompt: no marker
    expect(result.prompt).not.toContain('[TONE_HINT:');

    // Payload: no toneHint key
    const payloads = getPayloads(logSpy);
    const lastPayload = payloads[payloads.length - 1];
    expect(lastPayload).not.toHaveProperty('toneHint');
  });

  // 3) STABILIZE (collapse) → GENTLE
  test('collapse → STABILIZE produces GENTLE marker and payload', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const collapseResult = makeMockResult({ collapseEvent: true });

    const { EngineOrchestrator, InputProcessor } = setupModules({
      toneHint: true, bridge: true, mode: true, mockResult: collapseResult,
    });
    const engine = makeEngine(EngineOrchestrator);
    const result = await warmUpAndSend(engine, InputProcessor, 'I feel lost');

    expect(result.prompt).toContain('[TONE_HINT:GENTLE]');

    const payloads = getPayloads(logSpy);
    const last = payloads[payloads.length - 1];
    expect(last.toneHint).toBe('GENTLE');
    expect(last.promptProfile.guidanceMode).toBe('STABILIZE');
  });

  // 4) DE_ESCALATE (escalation override) → GENTLE
  test('escalation level >= 2 → DE_ESCALATE produces GENTLE marker', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const escalationResult = makeMockResult({ escalationLevel: 3 });

    const { EngineOrchestrator, InputProcessor } = setupModules({
      toneHint: true, bridge: true, mode: true, mockResult: escalationResult,
    });
    const engine = makeEngine(EngineOrchestrator);
    const result = await warmUpAndSend(engine, InputProcessor, 'this is terrible');

    expect(result.prompt).toContain('[TONE_HINT:GENTLE]');

    const payloads = getPayloads(logSpy);
    const last = payloads[payloads.length - 1];
    expect(last.toneHint).toBe('GENTLE');
    expect(last.promptProfile.guidanceMode).toBe('DE_ESCALATE');
  });

  // 5) interruptionLevel >= 2 with no stabilize/de-escalate → FIRM
  test('interruptionLevel >= 2 without collapse/escalation → FIRM marker', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const firmResult = makeMockResult({ interruptionLevel: 2 });

    const { EngineOrchestrator, InputProcessor } = setupModules({
      toneHint: true, bridge: true, mode: true, mockResult: firmResult,
    });
    const engine = makeEngine(EngineOrchestrator);
    const result = await warmUpAndSend(engine, InputProcessor, 'message');

    expect(result.prompt).toContain('[TONE_HINT:FIRM]');

    const payloads = getPayloads(logSpy);
    const last = payloads[payloads.length - 1];
    expect(last.toneHint).toBe('FIRM');
  });

  // 6) Stability horizon: first 2 messages must have no toneHint
  test('first 2 messages have no toneHint even with collapse', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const collapseResult = makeMockResult({ collapseEvent: true });

    const { EngineOrchestrator, InputProcessor } = setupModules({
      toneHint: true, bridge: true, mode: true, mockResult: collapseResult,
    });
    const engine = makeEngine(EngineOrchestrator);

    await send(engine, InputProcessor, 'I feel lost');
    await send(engine, InputProcessor, 'still lost');

    const payloads = getPayloads(logSpy);
    expect(payloads[0]).not.toHaveProperty('toneHint');
    expect(payloads[1]).not.toHaveProperty('toneHint');
  });

  // 7) No appraisal leakage in builder args
  test('builder args contain no appraisal-related keys', async () => {
    const collapseResult = makeMockResult({ collapseEvent: true });

    const { EngineOrchestrator, InputProcessor, PromptTemplateBuilder } = setupModules({
      toneHint: true, bridge: true, mode: true, mockResult: collapseResult,
    });
    const buildSpy = jest.spyOn(PromptTemplateBuilder, 'build');
    const engine = makeEngine(EngineOrchestrator);
    await warmUpAndSend(engine, InputProcessor, 'I feel lost');

    for (const call of buildSpy.mock.calls) {
      for (const arg of call) {
        if (arg && typeof arg === 'object') {
          for (const key of APPRAISAL_FORBIDDEN_KEYS) {
            expect(arg).not.toHaveProperty(key);
          }
        }
      }
    }
  });

  // 8) Golden replay hashes unaffected
  test('golden replay hashes unchanged', () => {
    jest.resetModules();
    jest.unmock('../../../appraisal-bridge/AppraisalBridgeRunner');
    jest.unmock('../../../debug/sessionTrace');

    const path = require('path');
    const { runReplayFromFile } = require('../../../appraisal-bridge/replay/runReplay');
    const fixturesDir = path.join(__dirname, '..', '..', '..', 'appraisal-bridge', 'replay', 'fixtures');

    const GOLDEN: Record<string, { file: string; hash: string }> = {
      calm_baseline_50: { file: 'calm_baseline_50.json', hash: '48225cb02b2b85c891ad515c5dfebe14363f27beaa472f853bd595413a4486ee' },
      escalation_burst_30: { file: 'escalation_burst_30.json', hash: '7527ad065d2839d652b55e919f1a841b326f23a4b9b5de1b3307cbdf32bf850f' },
      oscillation_100: { file: 'oscillation_100.json', hash: '12ad623e950e28f0cbaf726641e8345f5278164bb85fd7a39b6123f8cc85afb3' },
      recovery_80: { file: 'recovery_80.json', hash: 'b1a665d175ad9d7d6bd7fd1707a9dd0e7765e35cdb9157ed7559c0272162c31e' },
    };

    for (const [name, { file, hash }] of Object.entries(GOLDEN)) {
      const result = runReplayFromFile(path.join(fixturesDir, file));
      expect(result.hash).toBe(hash);
    }
  });
});
