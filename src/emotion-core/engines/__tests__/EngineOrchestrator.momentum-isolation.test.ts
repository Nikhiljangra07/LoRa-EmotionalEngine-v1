import { EngineOrchestrator } from '../EngineOrchestrator';
import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import { DecisionLogger } from '../../logging/DecisionLogger';

jest.mock('../../../debug/sessionTrace', () => ({
  writeSessionTrace: jest.fn(),
}));

const stubResponder = () => ({
  generateResponse: async () => 'ok',
});

const highArousalNegative: AnalyzerOutputs = {
  expressionStrength: { score: 0.9, confidence: 0.8 },
  valence: { score: -0.7, confidence: 0.8 },
  arousal: { score: 0.9, confidence: 0.8 },
};

const lowArousalPositive: AnalyzerOutputs = {
  expressionStrength: { score: 0.1, confidence: 0.6 },
  valence: { score: 0.5, confidence: 0.6 },
  arousal: { score: 0.1, confidence: 0.6 },
};

describe('EngineOrchestrator — momentum isolation across sessions', () => {
  test('two orchestrators do not share momentum state', async () => {
    const logSpy = jest.spyOn(DecisionLogger, 'logMessageDecision');

    const engineA = new EngineOrchestrator(0.5, {}, stubResponder);
    for (let i = 0; i < 5; i++) {
      await engineA.processMessage(highArousalNegative);
    }

    const engineB = new EngineOrchestrator(0.5, {}, stubResponder);
    await engineB.processMessage(lowArousalPositive);

    const logCalls = logSpy.mock.calls;
    const engineALastLog = logCalls[4][0] as {
      promptProfile: { guidanceMode: string };
    };
    const engineBLog = logCalls[5][0] as {
      promptProfile: { guidanceMode: string };
    };

    // With isolated momentum, engineB should NOT inherit engineA's
    // negative-biased momentum (which could cause DE_ESCALATE).
    // Low-arousal positive input with fresh momentum → CALM_NEUTRAL.
    expect(engineBLog.promptProfile.guidanceMode).not.toBe('DE_ESCALATE');

    logSpy.mockRestore();
  });

  test('fresh orchestrator starts with zero momentum (no legacy static bleed)', async () => {
    const engineA = new EngineOrchestrator(0.5, {}, stubResponder);
    for (let i = 0; i < 10; i++) {
      await engineA.processMessage(highArousalNegative);
    }

    const logSpy = jest.spyOn(DecisionLogger, 'logMessageDecision');
    const engineB = new EngineOrchestrator(0.5, {}, stubResponder);
    await engineB.processMessage(lowArousalPositive);

    const log = logSpy.mock.calls[0][0] as {
      promptProfile: { guidanceMode: string };
      emotionalState: { arousal: string; valence: string };
    };

    expect(log.emotionalState.valence).not.toBe('NEGATIVE');
    expect(log.promptProfile.guidanceMode).not.toBe('DE_ESCALATE');

    logSpy.mockRestore();
  });

  test('each orchestrator independently tracks EIV', async () => {
    const engineA = new EngineOrchestrator(0.5, {}, stubResponder);
    const engineB = new EngineOrchestrator(0.5, {}, stubResponder);

    const resultA = await engineA.processMessage(highArousalNegative);
    const resultB = await engineB.processMessage(lowArousalPositive);

    expect(resultA.eiv.value).not.toBe(resultB.eiv.value);
    expect(resultA.eiv.value).toBeGreaterThan(resultB.eiv.value);
  });
});
