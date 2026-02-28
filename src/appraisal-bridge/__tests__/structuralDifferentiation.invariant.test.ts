export {};

/**
 * Structural Differentiation Invariant Test
 *
 * Verifies that when Appraisal Bridge is OFF:
 *   - maskedPressure never appears in decision log
 *   - volatilityTrend never appears in decision log
 *   - escalationTrend never appears in decision log
 *   - ekmanInfluenceApplied never appears in decision log
 *   - gradientEscalation never appears in decision log
 *
 * And that when Appraisal Bridge is ON:
 *   - At least some of these new signals appear after sufficient turns
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
  'LORA_INTERVENTION_ACTION_HINT',
  'LORA_INTERVENTION_INTERRUPT_HINT',
  'LORA_INTERVENTION_STEP_HINT',
  'LORA_INTERVENTION_QUESTION_BUDGET',
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

function setAllFlags() {
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_APPRAISAL_PACING_HINT = '1';
  process.env.LORA_VALIDATION_INTENSITY = '1';
  process.env.LORA_APPRAISAL_TONE_HINT = '1';
  process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';
  process.env.LORA_INTERVENTION_PACING_HINT = '1';
  process.env.LORA_INTERVENTION_TONE_HINT = '1';
  process.env.LORA_INTERVENTION_ACTION_HINT = '1';
  process.env.LORA_INTERVENTION_INTERRUPT_HINT = '1';
  process.env.LORA_INTERVENTION_STEP_HINT = '1';
  process.env.LORA_INTERVENTION_QUESTION_BUDGET = '1';
}

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

const MOCK_DISTRESSED = Object.freeze({
  timestamp: 1_000_000,
  family: Object.freeze({ dominantFamily: 'ANGER', weights: Object.freeze({ ANGER: 0.7 }), confidence: 0.75 }),
  pressure: Object.freeze({ scalar: 2.5, slope: 0.8, volatility: 0.6, isShock: false, byFamily: Object.freeze({}) }),
  mood: Object.freeze({ category: 'AGITATED', dominance: 0.3, confidence: 0.7 }),
  escalation: Object.freeze({ level: 2, score: 0.8, flags: Object.freeze({ warmedUp: true, isFlapping: false, enteredCritical: false }) }),
  collapse: Object.freeze({ event: false, severity: 0, direction: 'NONE' }),
  postClarity: Object.freeze({ active: false, agencyDeficit: 0.4, isRelapse: false, recoveryPath: 'UNKNOWN' as const }),
  intervention: Object.freeze({
    toneMode: 'DE_ESCALATE',
    pacingMode: 'SLOW',
    validationMode: 'SUPPORTIVE',
    actionMode: 'ENCOURAGE_PAUSE',
    interruptionLevel: 2 as const,
    guardrails: Object.freeze([]),
  }),
});

function loadModules(stepFn: jest.Mock) {
  jest.resetModules();
  jest.doMock('../AppraisalBridgeRunner', () => ({
    AppraisalBridgeRunner: jest.fn().mockImplementation(() => ({
      step: stepFn,
      reset: jest.fn(),
    })),
  }));
  jest.doMock('../../debug/sessionTrace', () => ({
    writeSessionTrace: jest.fn(),
  }));
  const { EngineOrchestrator } = require('../../emotion-core/engines/EngineOrchestrator');
  const IP = require('../../emotion-core/processors/InputProcessor').InputProcessor;
  return { EngineOrchestrator, InputProcessor: IP };
}

const LOW_NEUTRAL = { dominant: 'NEUTRAL', arousal: 'LOW', valence: 'NEUTRAL', confidence: 0.5 };
const HIGH_NEGATIVE = { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.8 };

async function runSequence(
  engine: any,
  InputProcessorClass: any,
  messages: string[],
  emotionalOverrides: Record<number, any> = {},
): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < messages.length; i++) {
    const override = emotionalOverrides[i] ?? LOW_NEUTRAL;
    const { analyzerOutputs, signalPacket } = InputProcessorClass.process(messages[i]);
    const result = await engine.processMessage(analyzerOutputs, override, false, {}, undefined, signalPacket);
    results.push(result);
  }
  return results;
}

describe('Structural Differentiation — Bridge OFF guarantees', () => {
  let loggedDecisions: any[];

  beforeEach(() => {
    loggedDecisions = [];
    jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      const tag = args[0];
      if (typeof tag === 'string' && tag.includes('[LoRa::MessageDecision]')) {
        try {
          const payload = typeof args[1] === 'string' ? JSON.parse(args[1]) : args[1];
          loggedDecisions.push(payload);
        } catch { /* ignore */ }
      }
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  test('bridge OFF: no navigation signals in prompt or logs', async () => {
    clearFlags();
    const stepFn = jest.fn().mockReturnValue(MOCK_NEUTRAL);
    const { EngineOrchestrator, InputProcessor } = loadModules(stepFn);

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const messages = [
      "I'm behind again.", "It's fine.", "Whatever.",
      "Stop sugarcoating it.", "I'm failing.", "Why does this keep happening?",
    ];
    const results = await runSequence(engine, InputProcessor, messages);

    for (const r of results) {
      if (r.prompt) {
        expect(r.prompt).not.toContain('Masked pressure');
        expect(r.prompt).not.toContain('Volatility trend');
        expect(r.prompt).not.toContain('Escalation trend');
      }
    }

    for (const log of loggedDecisions) {
      expect(log.lpi).toBeUndefined();
      expect(log.volatilityTrend).toBeUndefined();
      expect(log.gradientEscalation).toBeUndefined();
      expect(log.ekmanInfluenceApplied).toBeUndefined();
    }
  });

  test('bridge ON: navigation signals appear in prompt for elevated states', async () => {
    clearFlags();
    setAllFlags();

    let callCount = 0;
    const stepFn = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount >= 4 ? MOCK_DISTRESSED : MOCK_NEUTRAL;
    });
    const { EngineOrchestrator, InputProcessor } = loadModules(stepFn);

    const engine = new EngineOrchestrator(0.5, {}, () => ({
      generateResponse: async () => 'ok',
    }));

    const messages = [
      "Hello.", "I'm behind.", "It's fine.",
      "I'm furious!", "This is terrible!", "Stop asking.",
    ];

    const results = await runSequence(engine, InputProcessor, messages, {
      3: HIGH_NEGATIVE,
      4: HIGH_NEGATIVE,
      5: HIGH_NEGATIVE,
    });

    const allPrompts = results.map(r => r.prompt || '').join('\n');
    const hasEscalationInPrompt =
      allPrompts.includes('Escalation:') || allPrompts.includes('SIGNAL CONTEXT');

    expect(hasEscalationInPrompt).toBe(true);

    const hasVolatilityTrend = loggedDecisions.some(d => d.volatilityTrend !== undefined);
    const hasGradientEscalation = loggedDecisions.some(d => d.gradientEscalation !== undefined);

    expect(hasVolatilityTrend || hasGradientEscalation).toBe(true);
  });
});
