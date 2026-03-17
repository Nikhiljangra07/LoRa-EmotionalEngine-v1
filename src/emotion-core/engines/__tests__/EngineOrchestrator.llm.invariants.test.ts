import { EngineOrchestrator } from '../EngineOrchestrator';
import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import type { EmotionalState } from '../../types/analysis.types';
import type { SignalPacket } from '../../types/SignalPacket.types';
import { DecisionLogger } from '../../logging/DecisionLogger';
import { MASTER_CONSTANTS } from '../../config/master.constants';

/** Long non-question text that won't trigger cooldown recovery (not short, no '?', no quick patterns). */
const longStatement: SignalPacket = {
  messageText: 'I have been thinking about the overall situation and reflecting on everything that has happened recently in my life and career trajectory',
  sentences: [],
  layer1Health: { degraded: false, reason: 'ok' },
};

const analyzerOutputs: AnalyzerOutputs = {
  expressionStrength: { score: 0.6, confidence: 0.7 },
  valence: { score: 0.1, confidence: 0.6 },
  arousal: { score: 0.5, confidence: 0.6 },
};

const emotionalState: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'MEDIUM',
  valence: 'NEUTRAL',
  confidence: 0.7,
};

describe('EngineOrchestrator — LLM Runtime Hardening', () => {
  test('emotional output is identical with and without LLM', async () => {
    const successEngine = new EngineOrchestrator(
      0.5,
      { maxAttempts: 1 },
      () => ({
        generateResponse: async () => 'LLM_OK',
      }),
      { userId: 'test-llm-success' },
    );

    const failureEngine = new EngineOrchestrator(
      0.5,
      { maxAttempts: 1 },
      () => ({
        generateResponse: async () => {
          throw new Error('LLM failed');
        },
      }),
      { userId: 'test-llm-failure' },
    );

    const withLlm = await successEngine.processMessage(
      analyzerOutputs,
      emotionalState
    );
    const withoutLlm = await failureEngine.processMessage(
      analyzerOutputs,
      emotionalState
    );

    expect(withLlm.eiv.value).toBe(withoutLlm.eiv.value);
    expect(withLlm.prompt).toBe(withoutLlm.prompt);
  });

  test('degradation behavior is unchanged by LLM availability', async () => {
    const spy = jest
      .spyOn(DecisionLogger, 'logMessageDecision')
      .mockImplementation(() => {});

    const lowConfidenceOutputs: AnalyzerOutputs = {
      expressionStrength: {
        score: 0.4,
        confidence:
          MASTER_CONSTANTS.layer1.degradation.confidenceThreshold - 0.01,
      },
      valence: { score: 0.1, confidence: 0.6 },
      arousal: { score: 0.3, confidence: 0.6 },
    };

    const successEngine = new EngineOrchestrator(
      0.5,
      { maxAttempts: 1 },
      () => ({
        generateResponse: async () => 'LLM_OK',
      }),
      { userId: 'test-degrade-success' },
    );
    await successEngine.processMessage(
      lowConfidenceOutputs,
      emotionalState
    );
    const successSummary = spy.mock.calls[0][0].analyzerSummary;

    const failureEngine = new EngineOrchestrator(
      0.5,
      { maxAttempts: 1 },
      () => ({
        generateResponse: async () => {
          throw new Error('LLM failed');
        },
      }),
      { userId: 'test-degrade-failure' },
    );
    await failureEngine.processMessage(
      lowConfidenceOutputs,
      emotionalState
    );
    const failureSummary = spy.mock.calls[1][0].analyzerSummary;

    expect(successSummary).toEqual(failureSummary);
    spy.mockRestore();
  });

  test('retry logic is bounded and deterministic', async () => {
    let calls = 0;
    const engine = new EngineOrchestrator(
      0.5,
      { maxAttempts: 2, cooldownMs: 60000 },
      () => ({
        generateResponse: async () => {
          calls += 1;
          throw new Error('LLM failed');
        },
      }),
      { userId: 'test-retry-bounded' },
    );

    const first = await engine.processMessage(
      analyzerOutputs,
      emotionalState
    );
    expect(calls).toBe(2);
    expect(first.llmOutput).toBe(
      'Connection interrupted. State your question again and I will address it directly.'
    );

    // Second call during cooldown: use a long non-question statement so recovery
    // logic does not trigger (no '?', not short, not past 50% of cooldown).
    await engine.processMessage(analyzerOutputs, emotionalState, false, {}, undefined, longStatement);
    // Cooldown is active and recovery criteria not met — LLM should not be called again.
    expect(calls).toBe(2);
  });
});
