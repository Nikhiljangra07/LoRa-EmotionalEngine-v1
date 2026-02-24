import { AppraisalBridgeRunner } from '../AppraisalBridgeRunner';
import { makeSnapshot } from './helpers';

describe('AppraisalBridgeRunner — no clock access', () => {
  test('step() never calls Date.now()', () => {
    const originalDateNow = Date.now;
    const spy = jest.fn(() => {
      throw new Error('Date.now() called inside bridge step()');
    });
    Date.now = spy;

    try {
      const runner = new AppraisalBridgeRunner();
      for (let i = 0; i < 10; i++) {
        runner.step(
          makeSnapshot({
            messageIndex: i,
            timestampMs: 1_000_000 + i * 30_000,
            deltaMessageSeconds: 30,
            eivValue: 0.3 + i * 0.02,
          })
        );
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Date.now = originalDateNow;
    }
  });
});
