import { EngineOrchestrator } from '../EngineOrchestrator';
import { EIVScorer } from '../../scorers/EIVScorer';
import { InputProcessor } from '../../processors/InputProcessor';

jest.mock('../../../debug/sessionTrace', () => ({
  writeSessionTrace: jest.fn(),
}));

describe('EngineOrchestrator — single EIV computation per message', () => {
  let calculateSpy: jest.SpyInstance;

  beforeEach(() => {
    calculateSpy = jest.spyOn(EIVScorer, 'calculate');
  });

  afterEach(() => {
    calculateSpy.mockRestore();
  });

  test('EIVScorer.calculate is called exactly once per processMessage', async () => {
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({ generateResponse: async () => 'ok' })
    );

    const { analyzerOutputs } = InputProcessor.process('I feel great today!');
    await engine.processMessage(analyzerOutputs);

    expect(calculateSpy).toHaveBeenCalledTimes(1);
  });

  test('sessionEIVs track the same value returned by processMessage', async () => {
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({ generateResponse: async () => 'ok' })
    );

    const { analyzerOutputs } = InputProcessor.process('hello');
    const result = await engine.processMessage(analyzerOutputs);

    const capturedValue = calculateSpy.mock.results[0].value.value;
    expect(result.eiv.value).toBe(capturedValue);
  });

  test('two sequential messages compute EIV exactly twice total', async () => {
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({ generateResponse: async () => 'ok' })
    );

    const { analyzerOutputs: a1 } = InputProcessor.process('hello');
    const { analyzerOutputs: a2 } = InputProcessor.process('THIS IS CRAZY!!!');

    await engine.processMessage(a1);
    await engine.processMessage(a2);

    expect(calculateSpy).toHaveBeenCalledTimes(2);
  });
});
