import { updateMomentum } from "../updateMomentum";
import { INITIAL_MOMENTUM_STATE } from "../MomentumState";

describe("updateMomentum — history aggregation", () => {
  test("confidence and bias rise after consistent signals", () => {
    let momentum = INITIAL_MOMENTUM_STATE;
    const history: Array<{
      valence: number;
      arousal: number;
      confidence: number;
    }> = [];

    const signal = {
      valence: -0.3,
      arousal: 0.7,
      confidence: 0.1,
    };

    for (let i = 0; i < 3; i += 1) {
      history.push(signal);
      momentum = updateMomentum(momentum, signal, history);
    }

    expect(momentum.confidence).toBeGreaterThan(0);
    expect(momentum.valenceBias).toBeLessThan(0);
    expect(momentum.arousalBias).toBeGreaterThan(0);
  });
});
