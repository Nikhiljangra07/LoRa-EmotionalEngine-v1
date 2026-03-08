import {
  SHOCK_THRESHOLD,
  createPressureState,
  updatePressureState,
} from "..";

function lcgNext(seed: number): number {
  return (seed * 48271) % 2147483647;
}

describe("pressure-engine stress2", () => {
  test("50,000 deterministic updates remain stable", () => {
    let state = createPressureState(10);
    let seed = 246813579;
    const deltas = [0, 0.001, 1, 10, 90, 300, 3600];
    const gains = [0.8, 1.0, 1.3];

    for (let i = 0; i < 50000; i += 1) {
      seed = lcgNext(seed);
      const normalized = seed / 2147483647;
      const activation = normalized * 2 - 0.5;

      const result = updatePressureState(state, {
        pressureAfterDecay: state.pressure,
        gain: gains[i % gains.length],
        activation,
        deltaMessageSeconds: deltas[i % deltas.length],
      });
      state = result.state;

      if (i % 1000 === 0) {
        expect(Number.isFinite(result.outputs.pressure)).toBe(true);
        expect(Number.isFinite(result.outputs.deltaPressure)).toBe(true);
        expect(Number.isFinite(result.outputs.slope)).toBe(true);
        expect(Number.isFinite(result.outputs.volatility)).toBe(true);
        expect(result.outputs.pressure).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("extreme activation values remain finite and non-negative", () => {
    const activations = [-1e6, 1e6, 1e-12, 0];
    let state = createPressureState(1);

    for (const activation of activations) {
      const result = updatePressureState(state, {
        pressureAfterDecay: state.pressure,
        gain: 1,
        activation,
        deltaMessageSeconds: 1,
      });
      state = result.state;

      expect(Number.isFinite(result.outputs.pressure)).toBe(true);
      expect(Number.isFinite(result.outputs.deltaPressure)).toBe(true);
      expect(Number.isFinite(result.outputs.slope)).toBe(true);
      expect(Number.isFinite(result.outputs.volatility)).toBe(true);
      expect(result.outputs.pressure).toBeGreaterThanOrEqual(0);
    }
  });

  test("shock threshold boundary behavior is explicit", () => {
    const baseState = {
      ...createPressureState(0),
      prevActivation: 0,
    };

    const atThreshold = updatePressureState(baseState, {
      pressureAfterDecay: 0,
      gain: 1,
      activation: SHOCK_THRESHOLD,
      deltaMessageSeconds: 1,
    });
    expect(atThreshold.outputs.isShock).toBe(false);

    const aboveThreshold = updatePressureState(baseState, {
      pressureAfterDecay: 0,
      gain: 1,
      activation: SHOCK_THRESHOLD + 1e-12,
      deltaMessageSeconds: 1,
    });
    expect(aboveThreshold.outputs.isShock).toBe(true);
  });
});
