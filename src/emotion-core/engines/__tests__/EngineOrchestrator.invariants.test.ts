import { EngineOrchestrator } from '../EngineOrchestrator';

describe('EngineOrchestrator — Architectural Invariants', () => {
  test('ending empty session is safe', () => {
    const engine = new EngineOrchestrator(0.5);
    expect(() => engine.endSession()).not.toThrow();
  });

  test('ETV remains within [0,1]', async () => {
    const engine = new EngineOrchestrator(0.95);

    await engine.processMessage(
      { linguisticScore: 1, punctuationScore: 1, capitalizationScore: 1, emojiScore: 1 },
      { dominant: 'JOY', arousal: 'HIGH', valence: 'POSITIVE', confidence: 0.9 }
    );

    const { newETV } = engine.endSession();
    expect(newETV).toBeGreaterThanOrEqual(0);
    expect(newETV).toBeLessThanOrEqual(1);
  });

  test('deterministic execution for same inputs', async () => {
    const a = new EngineOrchestrator(0.5);
    const b = new EngineOrchestrator(0.5);

    const inputs = {
      linguisticScore: 0.4,
      punctuationScore: 0.2,
      capitalizationScore: 0.3,
      emojiScore: 0.1,
    };

    const state = {
      dominant: 'NEUTRAL',
      arousal: 'MEDIUM',
      valence: 'NEUTRAL',
      confidence: 0.7,
    };

    const r1 = await a.processMessage(inputs, state);
    const r2 = await b.processMessage(inputs, state);

    expect(r1.eiv.value).toBe(r2.eiv.value);
  });
});
