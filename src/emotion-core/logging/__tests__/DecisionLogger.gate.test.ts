import type { MessageDecisionLog, SessionLog } from '../DecisionLogger';

const SAMPLE_MESSAGE: MessageDecisionLog = {
  messageId: 'msg-1',
  timestamp: Date.now(),
  analyzerSummary: {
    emojiUsed: false,
    capsUsed: false,
    punctuationUsed: false,
    repetitionDetected: false,
  },
  eiv: { value: 0.4, tier: 'moderate' },
  emotionalState: { arousal: 'MEDIUM', valence: 'NEUTRAL' },
  promptProfile: { relationshipStyle: 'FRIENDLY', guidanceMode: 'CALM_NEUTRAL' },
  flags: { safetyTriggered: false, ambiguityDetected: false },
};

const SAMPLE_SESSION: SessionLog = {
  sessionId: 'session-1',
  startETV: 0.5,
  endETV: 0.6,
  meanSessionEIV: 0.4,
  violationOccurred: false,
  messageCount: 3,
  endedAt: Date.now(),
};

describe('DecisionLogger gating via LORA_DECISION_LOG', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.resetModules();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('logs when LORA_DECISION_LOG is absent (default enabled)', async () => {
    delete process.env.LORA_DECISION_LOG;
    const { DecisionLogger } = await import('../DecisionLogger');

    DecisionLogger.logMessageDecision(SAMPLE_MESSAGE);
    DecisionLogger.logSessionEnd(SAMPLE_SESSION);

    const calls = logSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('[LoRa::MessageDecision]');
    expect(calls).toContain('[LoRa::SessionEnd]');
  });

  test('logs when LORA_DECISION_LOG is "1"', async () => {
    process.env.LORA_DECISION_LOG = '1';
    const { DecisionLogger } = await import('../DecisionLogger');

    DecisionLogger.logMessageDecision(SAMPLE_MESSAGE);
    DecisionLogger.logSessionEnd(SAMPLE_SESSION);

    const calls = logSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('[LoRa::MessageDecision]');
    expect(calls).toContain('[LoRa::SessionEnd]');

    delete process.env.LORA_DECISION_LOG;
  });

  test('suppresses all output when LORA_DECISION_LOG is "0"', async () => {
    process.env.LORA_DECISION_LOG = '0';
    const { DecisionLogger } = await import('../DecisionLogger');

    DecisionLogger.logMessageDecision(SAMPLE_MESSAGE);
    DecisionLogger.logSessionEnd(SAMPLE_SESSION);

    const decisionCalls = logSpy.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0].includes('[LoRa::MessageDecision]') || c[0].includes('[LoRa::SessionEnd]'))
    );
    expect(decisionCalls).toHaveLength(0);

    delete process.env.LORA_DECISION_LOG;
  });
});
