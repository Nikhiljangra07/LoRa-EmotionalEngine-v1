import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import type { EmotionalState } from '../../types/analysis.types';
import { EngineOrchestrator } from '../EngineOrchestrator';

describe('EngineOrchestrator — Architectural Invariants', () => {
  test('ending empty session is safe', () => {
    const engine = new EngineOrchestrator(0.5);
    expect(() => engine.endSession()).not.toThrow();
  });

  test('ETV remains within [0,1]', async () => {
    const engine = new EngineOrchestrator(0.95);
    const analyzerOutputs: AnalyzerOutputs = {
      expressionStrength: { score: 0.6, confidence: 0.7 },
      valence: { score: 0.1, confidence: 0.6 },
      arousal: { score: 0.5, confidence: 0.6 },
    };

    const emotionalState: EmotionalState = {
      dominant: 'JOY',
      arousal: 'HIGH',
      valence: 'POSITIVE',
      confidence: 0.9,
    };

    await engine.processMessage(analyzerOutputs, emotionalState);

    const { newETV } = engine.endSession();
    expect(newETV).toBeGreaterThanOrEqual(0);
    expect(newETV).toBeLessThanOrEqual(1);
  });

  test('deterministic execution for same inputs', async () => {
    const a = new EngineOrchestrator(0.5);
    const b = new EngineOrchestrator(0.5);

    const analyzerOutputs: AnalyzerOutputs = {
      expressionStrength: { score: 0.6, confidence: 0.7 },
      valence: { score: 0.1, confidence: 0.6 },
      arousal: { score: 0.5, confidence: 0.6 },
    };

    const state: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'MEDIUM',
      valence: 'NEUTRAL',
      confidence: 0.7,
    };

    const r1 = await a.processMessage(analyzerOutputs, state);
    const r2 = await b.processMessage(analyzerOutputs, state);

    expect(r1.eiv.value).toBe(r2.eiv.value);
  });
});
