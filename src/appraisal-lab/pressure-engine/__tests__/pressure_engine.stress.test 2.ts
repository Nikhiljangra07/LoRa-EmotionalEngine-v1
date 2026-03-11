import { createPressureState, updatePressureState } from "..";

function lcgNext(seed: number): number {
  // Park-Miller LCG with 31-bit modulus.
  return (seed * 48271) % 2147483647;
}

describe("pressure-engine stress", () => {
  test("50k deterministic update loop remains finite", () => {
    let state = createPressureState(10);
    let seed = 123456789;

    for (let i = 0; i < 50000; i += 1) {
      seed = lcgNext(seed);
      const normalized = seed / 2147483647; // [0, 1)
      const activation = normalized * 2 - 0.5; // deterministic sweep including negatives

      const result = updatePressureState(state, {
        pressureAfterDecay: state.pressure,
        gain: 1.0 + (i % 5) * 0.05,
        activation,
        deltaMessageSeconds: (i % 7) + 1,
      });
      state = result.state;

      expect(Number.isFinite(result.outputs.pressure)).toBe(true);
      expect(Number.isFinite(result.outputs.deltaPressure)).toBe(true);
      expect(Number.isFinite(result.outputs.slope)).toBe(true);
      expect(Number.isFinite(result.outputs.volatility)).toBe(true);
    }
  });

  test("extreme activation values stay finite", () => {
    let state = createPressureState(0);
    const activations = [-1e6, -1, -1e-9, 0, 1e-9, 1, 1e6];

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
    }
  });

  test("micro-float timing and activation remain stable", () => {
    let state = createPressureState(1);

    for (let i = 0; i < 500; i += 1) {
      const result = updatePressureState(state, {
        pressureAfterDecay: state.pressure,
        gain: 1,
        activation: i % 2 === 0 ? 1e-12 : -1e-12,
        deltaMessageSeconds: 1e-9,
      });
      state = result.state;

      expect(Number.isFinite(result.outputs.pressure)).toBe(true);
      expect(Number.isFinite(result.outputs.deltaPressure)).toBe(true);
      expect(Number.isFinite(result.outputs.slope)).toBe(true);
      expect(Number.isFinite(result.outputs.volatility)).toBe(true);
    }
  });
});
