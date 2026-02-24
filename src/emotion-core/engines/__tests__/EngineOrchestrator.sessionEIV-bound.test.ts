import { EngineOrchestrator } from '../EngineOrchestrator';
import { InputProcessor } from '../../processors/InputProcessor';
import { MASTER_CONSTANTS } from '../../config/master.constants';

jest.mock('../../../debug/sessionTrace', () => ({
  writeSessionTrace: jest.fn(),
}));

const MAX = MASTER_CONSTANTS.engineDefaults.maxSessionEIVEntries;

describe('EngineOrchestrator — sessionEIVs bounded growth', () => {
  let engine: EngineOrchestrator;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    engine = new EngineOrchestrator(
      0.5,
      { maxResponseMs: 5000, maxAttempts: 1, cooldownMs: 0 },
      () => ({
        generateResponse: async () => 'ok',
      })
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test(`sessionEIVs.length never exceeds ${MAX}`, async () => {
    const internal = engine as unknown as { sessionEIVs: number[] };

    // Pre-fill to exactly the cap
    internal.sessionEIVs = Array.from({ length: MAX }, (_, i) => 0.5);

    // Push a few more via processMessage
    const overshoot = 5;
    for (let i = 0; i < overshoot; i++) {
      const { analyzerOutputs, signalPacket } = InputProcessor.process('test');
      await engine.processMessage(
        analyzerOutputs,
        undefined,
        false,
        {},
        undefined,
        signalPacket
      );
    }

    expect(internal.sessionEIVs.length).toBeLessThanOrEqual(MAX);
    expect(internal.sessionEIVs.length).toBe(MAX);
  });

  test('oldest entries are dropped when cap is exceeded', async () => {
    const internal = engine as unknown as { sessionEIVs: number[] };

    // Pre-fill: values 1..MAX (sentinel at index 0 = value 1)
    internal.sessionEIVs = Array.from({ length: MAX }, (_, i) => i + 1);

    const { analyzerOutputs, signalPacket } = InputProcessor.process('test');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

    expect(internal.sessionEIVs.length).toBe(MAX);
    // The sentinel value (1, the oldest) should have been dropped
    expect(internal.sessionEIVs[0]).toBe(2);
  });

  test('endSession mean uses the bounded entries', async () => {
    const internal = engine as unknown as { sessionEIVs: number[] };

    // Fill with known values: all 0.6
    internal.sessionEIVs = Array.from({ length: MAX }, () => 0.6);

    // Push one more via processMessage — the EIV for 'test' will be some
    // deterministic value; the mean should shift only marginally
    const { analyzerOutputs, signalPacket } = InputProcessor.process('test');
    await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

    expect(internal.sessionEIVs.length).toBe(MAX);

    const mean =
      internal.sessionEIVs.reduce((a, b) => a + b, 0) /
      internal.sessionEIVs.length;

    const { newETV } = engine.endSession();
    expect(typeof newETV).toBe('number');
    // Mean of ~2000 entries of 0.6 + 1 different value ≈ 0.6
    expect(mean).toBeCloseTo(0.6, 1);
  });
});
