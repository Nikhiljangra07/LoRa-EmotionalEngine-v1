export {};

function makeMockResult(overrides: {
  collapseEvent?: boolean;
  escalationLevel?: number;
  pressureScalar?: number;
} = {}) {
  return Object.freeze({
    timestamp: 1_000_000,
    family: Object.freeze({
      dominantFamily: 'SADNESS',
      weights: Object.freeze({ JOY: 0.1, ANGER: 0.1, FEAR: 0.1, SADNESS: 0.4, SURPRISE: 0.1, DISGUST: 0.2 }),
      confidence: 0.7,
    }),
    pressure: Object.freeze({
      scalar: overrides.pressureScalar ?? 0.3,
      slope: 0.01,
      volatility: 0.05,
      isShock: false,
      byFamily: Object.freeze({}),
    }),
    mood: Object.freeze({ category: 'NEUTRAL', dominance: 0.5, confidence: 0.6 }),
    escalation: Object.freeze({
      level: overrides.escalationLevel ?? 0,
      score: 0.1,
      flags: Object.freeze({ warmedUp: false, isFlapping: false, enteredCritical: false }),
    }),
    collapse: Object.freeze({ event: overrides.collapseEvent ?? false, severity: 0, direction: 'NONE' }),
    postClarity: Object.freeze({ active: false, agencyDeficit: 0, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
    intervention: Object.freeze({ toneMode: 'NEUTRAL', pacingMode: 'NORMAL', validationMode: 'STANDARD', actionMode: 'NONE', interruptionLevel: 0 as const, guardrails: Object.freeze([]) }),
  });
}

const ENV_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_APPRAISAL_PACING_HINT',
  'LORA_DRIFT_MONITOR',
] as const;
const origEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) origEnv[k] = process.env[k];

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

function setupModules(opts: { drift: boolean; stepFn: jest.Mock }) {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_APPRAISAL_PACING_HINT = '1';
  if (opts.drift) process.env.LORA_DRIFT_MONITOR = '1';
  else delete process.env.LORA_DRIFT_MONITOR;

  jest.resetModules();

  jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
    AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
      step: opts.stepFn,
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

async function sendMessage(engine: any, IP: any, text = 'test message') {
  const { analyzerOutputs, signalPacket } = IP.process(text);
  return engine.processMessage(analyzerOutputs, undefined, false, {}, undefined, signalPacket);
}

describe('DriftMonitor', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  // A) Flag off → no console.warn even with oscillation
  test('no warning when LORA_DRIFT_MONITOR is off', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      return callIdx % 2 === 0
        ? makeMockResult({ collapseEvent: true })
        : makeMockResult();
    });

    const { EngineOrchestrator, InputProcessor } = setupModules({ drift: false, stepFn });
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    for (let i = 0; i < 12; i++) {
      await sendMessage(engine, InputProcessor);
    }

    const driftCalls = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    expect(driftCalls).toHaveLength(0);
  });

  // B) Rapid guidanceMode flips → warning logged once
  test('warning logged once on rapid guidanceMode oscillation', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      // Alternating collapse/neutral produces STABILIZE ↔ CALM_NEUTRAL flips
      return callIdx % 2 === 0
        ? makeMockResult({ collapseEvent: true })
        : makeMockResult();
    });

    const { EngineOrchestrator, InputProcessor } = setupModules({ drift: true, stepFn });
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    for (let i = 0; i < 10; i++) {
      await sendMessage(engine, InputProcessor);
    }

    const driftCalls = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    expect(driftCalls.length).toBeGreaterThanOrEqual(1);
  });

  // C) Sustained oscillation → still only one warning (no repeated spam)
  test('sustained oscillation produces only one warning before reset', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      return callIdx % 2 === 0
        ? makeMockResult({ collapseEvent: true })
        : makeMockResult();
    });

    const { EngineOrchestrator, InputProcessor } = setupModules({ drift: true, stepFn });
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // Send 20 messages of oscillation
    for (let i = 0; i < 20; i++) {
      await sendMessage(engine, InputProcessor);
    }

    const driftCalls = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    // Only one warning (driftWarningActive suppresses duplicates)
    expect(driftCalls).toHaveLength(1);
  });

  // D) Window stabilizes → warning resets, can fire again
  test('warning resets after window stabilizes', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      // Oscillate for first 10, then stabilize for 12, then oscillate again
      if (callIdx <= 10) {
        return callIdx % 2 === 0
          ? makeMockResult({ collapseEvent: true })
          : makeMockResult();
      }
      if (callIdx <= 22) {
        return makeMockResult(); // stable
      }
      // Oscillate again
      return callIdx % 2 === 0
        ? makeMockResult({ collapseEvent: true })
        : makeMockResult();
    });

    const { EngineOrchestrator, InputProcessor } = setupModules({ drift: true, stepFn });
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // Phase 1: oscillate (triggers first warning)
    for (let i = 0; i < 10; i++) {
      await sendMessage(engine, InputProcessor);
    }
    // Phase 2: stabilize (fills window with uniform values, resets warning)
    for (let i = 0; i < 12; i++) {
      await sendMessage(engine, InputProcessor);
    }
    // Phase 3: oscillate again (should trigger second warning)
    for (let i = 0; i < 10; i++) {
      await sendMessage(engine, InputProcessor);
    }

    const driftCalls = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    expect(driftCalls.length).toBe(2);
  });

  // E) Escalation-only oscillation triggers warning
  test('escalation level oscillation triggers warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      // Alternate escalation 0 ↔ 3 (guidance stays DE_ESCALATE vs VALIDATING,
      // but escalation transitions >= 3 should trigger)
      return callIdx % 2 === 0
        ? makeMockResult({ escalationLevel: 3 })
        : makeMockResult({ escalationLevel: 0 });
    });

    const { EngineOrchestrator, InputProcessor } = setupModules({ drift: true, stepFn });
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    for (let i = 0; i < 10; i++) {
      await sendMessage(engine, InputProcessor);
    }

    const driftCalls = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    expect(driftCalls.length).toBeGreaterThanOrEqual(1);
  });

  // F) Pacing-only oscillation triggers warning
  test('pacing hint oscillation triggers warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      // Alternate high pressure (SLOW) ↔ low pressure (undefined/NORMAL)
      return callIdx % 2 === 0
        ? makeMockResult({ pressureScalar: 3.0 })
        : makeMockResult({ pressureScalar: 0.1 });
    });

    const { EngineOrchestrator, InputProcessor } = setupModules({ drift: true, stepFn });
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    for (let i = 0; i < 10; i++) {
      await sendMessage(engine, InputProcessor);
    }

    const driftCalls = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[DRIFT_MONITOR]'),
    );
    expect(driftCalls.length).toBeGreaterThanOrEqual(1);
  });

  // G) driftDetected appears in decision payload exactly once per unstable window
  test('driftDetected in payload only once per unstable window, reappears after reset', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    let callIdx = 0;
    const stepFn = jest.fn(() => {
      callIdx++;
      // Phase 1 (1–10): oscillate
      if (callIdx <= 10) {
        return callIdx % 2 === 0
          ? makeMockResult({ collapseEvent: true })
          : makeMockResult();
      }
      // Phase 2 (11–22): stable
      if (callIdx <= 22) {
        return makeMockResult();
      }
      // Phase 3 (23+): oscillate again
      return callIdx % 2 === 0
        ? makeMockResult({ collapseEvent: true })
        : makeMockResult();
    });

    const { EngineOrchestrator, InputProcessor } = setupModules({ drift: true, stepFn });
    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    // Phase 1: oscillate → should trigger driftDetected once
    for (let i = 0; i < 10; i++) {
      await sendMessage(engine, InputProcessor);
    }

    const getPayloads = () =>
      logSpy.mock.calls
        .filter((c) => typeof c[0] === 'string' && c[0].includes('[LoRa::MessageDecision]'))
        .map((c) => JSON.parse(c[1]));

    const phase1Payloads = getPayloads();
    const phase1Drift = phase1Payloads.filter((p: any) => p.driftDetected === true);
    expect(phase1Drift).toHaveLength(1);

    // Subsequent unstable messages should NOT have driftDetected
    const phase1NonDrift = phase1Payloads.filter((p: any) => p.driftDetected === undefined);
    expect(phase1NonDrift.length).toBe(phase1Payloads.length - 1);

    // Phase 2: stabilize (resets driftWarningActive)
    logSpy.mockClear();
    for (let i = 0; i < 12; i++) {
      await sendMessage(engine, InputProcessor);
    }
    const phase2Payloads = getPayloads();
    const phase2Drift = phase2Payloads.filter((p: any) => p.driftDetected === true);
    expect(phase2Drift).toHaveLength(0);

    // Phase 3: oscillate again → driftDetected should appear again
    logSpy.mockClear();
    for (let i = 0; i < 10; i++) {
      await sendMessage(engine, InputProcessor);
    }
    const phase3Payloads = getPayloads();
    const phase3Drift = phase3Payloads.filter((p: any) => p.driftDetected === true);
    expect(phase3Drift).toHaveLength(1);
  });
});
