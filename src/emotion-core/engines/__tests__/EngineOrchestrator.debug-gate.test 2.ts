import { writeSessionTrace } from '../../../debug/sessionTrace';
import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';

jest.mock('../../../debug/sessionTrace', () => ({
  writeSessionTrace: jest.fn(),
}));

jest.mock('../../debug/debugGate', () => ({
  debugEnabled: false,
}));

const analyzerOutputs: AnalyzerOutputs = {
  expressionStrength: { score: 0.5, confidence: 0.7 },
  valence: { score: 0.1, confidence: 0.6 },
  arousal: { score: 0.4, confidence: 0.6 },
};

describe('EngineOrchestrator — debug gate', () => {
  test('writeSessionTrace is NOT called when debug is disabled', async () => {
    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({ generateResponse: async () => 'ok' })
    );

    await engine.processMessage(analyzerOutputs);

    expect(writeSessionTrace).not.toHaveBeenCalled();
  });

  test('console.log audit lines are suppressed when debug is disabled', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const { EngineOrchestrator } = require('../EngineOrchestrator');
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({ generateResponse: async () => 'ok' })
    );

    await engine.processMessage(analyzerOutputs);

    const auditCalls = consoleSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('[LoRa::Audit]')
    );

    expect(auditCalls.length).toBe(0);

    consoleSpy.mockRestore();
  });
});
