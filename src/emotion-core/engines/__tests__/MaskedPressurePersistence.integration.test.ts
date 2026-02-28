export {};

/**
 * Integration test: masked pressure persistence gate.
 *
 * When bridge ON and LPI returns maskedPressure=true for 2+ of last 4 turns:
 * - Prompt contains "Masked pressure: PERSISTENT"
 * - questionBudgetHint is clamped (ONE or ZERO if CRITICAL)
 * - maskedPressurePersistent in decision log
 *
 * Bridge OFF never shows these (covered by structuralDifferentiation.invariant).
 */

const MOCK_NEUTRAL = Object.freeze({
  timestamp: 1_000_000,
  family: Object.freeze({ dominantFamily: 'NEUTRAL', weights: Object.freeze({}), confidence: 0.3 }),
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

const LPI_MASKED = { raw: 0.5, smoothed: 0.55, maskedPressure: true, components: {} };
const LPI_CALM = { raw: 0.1, smoothed: 0.2, maskedPressure: false, components: {} };

const origBridge = process.env.LORA_APPRAISAL_BRIDGE;
const origMode = process.env.LORA_APPRAISAL_BRIDGE_MODE;
const origFlags = [
  'LORA_APPRAISAL_PACING_HINT',
  'LORA_INTERVENTION_QUESTION_BUDGET',
  'LORA_INTERVENTION_ACTION_HINT',
  'LORA_GUIDANCE_DWELL_LOCK',
] as const;
const origEnv: Record<string, string | undefined> = {};
for (const k of origFlags) origEnv[k] = process.env[k];

function restoreEnv() {
  if (origBridge === undefined) delete process.env.LORA_APPRAISAL_BRIDGE;
  else process.env.LORA_APPRAISAL_BRIDGE = origBridge;
  if (origMode === undefined) delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
  else process.env.LORA_APPRAISAL_BRIDGE_MODE = origMode;
  for (const k of origFlags) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

function setupBridgeOn(maskedPressureReturnCount: number) {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_APPRAISAL_PACING_HINT = '1';
  process.env.LORA_INTERVENTION_QUESTION_BUDGET = '1';
  process.env.LORA_INTERVENTION_ACTION_HINT = '1';

  let lpiCallCount = 0;
  jest.resetModules();

  jest.doMock('../../../appraisal-bridge/AppraisalBridgeRunner', () => ({
    AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
      step: jest.fn().mockReturnValue(MOCK_NEUTRAL),
      reset: jest.fn(),
    })),
  }));
  jest.doMock('../../../appraisal-bridge/latentPressureIndex', () => {
    const actual = jest.requireActual('../../../appraisal-bridge/latentPressureIndex');
    return {
      ...actual,
      LatentPressureTracker: jest.fn().mockImplementation(() => ({
        step: jest.fn().mockImplementation(() => {
          lpiCallCount++;
          return lpiCallCount <= maskedPressureReturnCount ? LPI_MASKED : LPI_CALM;
        }),
        reset: jest.fn(),
        get currentSmoothed() { return 0.5; },
      })),
    };
  });
  jest.doMock('../../../debug/sessionTrace', () => ({ writeSessionTrace: jest.fn() }));

  const { EngineOrchestrator } = require('../EngineOrchestrator');
  const { InputProcessor } = require('../../processors/InputProcessor');
  return { EngineOrchestrator, InputProcessor };
}

async function runSequence(
  engine: any,
  InputProcessorClass: any,
  messages: string[],
): Promise<{ prompts: string[]; decisions: any[] }> {
  const decisions: any[] = [];
  jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    const tag = args[0];
    if (typeof tag === 'string' && tag.includes('[LoRa::MessageDecision]')) {
      try {
        const payload = typeof args[1] === 'string' ? JSON.parse(args[1]) : args[1];
        decisions.push(payload);
      } catch { /* ignore */ }
    }
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  const prompts: string[] = [];
  for (const msg of messages) {
    const { analyzerOutputs, signalPacket } = InputProcessorClass.process(msg);
    const result = await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket,
    );
    prompts.push(result.prompt ?? '');
  }

  jest.restoreAllMocks();
  return { prompts, decisions };
}

describe('Masked pressure persistence gate — integration', () => {
  afterEach(() => {
    restoreEnv();
  });

  test('bridge ON + 2-of-4 maskedPressure: prompt contains PERSISTENT, decision has maskedPressurePersistent', async () => {
    const { EngineOrchestrator, InputProcessor } = setupBridgeOn(4);

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const messages = [
      'hello',
      "It's fine. Whatever.",
      "Doesn't matter. Just tired.",
      "I guess it's okay.",
      "Forget it.",
    ];

    const { prompts, decisions } = await runSequence(engine, InputProcessor, messages);

    const withPersistent = decisions.filter((d) => d.maskedPressurePersistent === true);
    expect(withPersistent.length).toBeGreaterThanOrEqual(1);

    const promptsWithPersistent = prompts.filter((p) => p.includes('Masked pressure: PERSISTENT'));
    expect(promptsWithPersistent.length).toBeGreaterThanOrEqual(1);

    const lastWithPersistent = [...decisions].reverse().find((d: any) => d.maskedPressurePersistent === true);
    if (lastWithPersistent) {
      expect(['ONE', 'ZERO']).toContain(lastWithPersistent.questionBudgetHint);
    }
  });
});
