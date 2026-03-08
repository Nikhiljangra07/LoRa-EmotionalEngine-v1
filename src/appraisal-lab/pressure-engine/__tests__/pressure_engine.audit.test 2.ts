import * as PressureEngine from "..";
import { createPressureState, updatePressureState } from "..";

function lcgNext(seed: number): number {
  return (seed * 48271) % 2147483647;
}

describe("pressure-engine audit", () => {
  test("public API contract exports functions, constants, and output shape", () => {
    expect(typeof PressureEngine.createPressureState).toBe("function");
    expect(typeof PressureEngine.updatePressureState).toBe("function");
    expect(typeof PressureEngine.K_UP).toBe("number");
    expect(typeof PressureEngine.SHOCK_THRESHOLD).toBe("number");
    expect(typeof PressureEngine.SHOCK_GAIN).toBe("number");
    expect(typeof PressureEngine.WINDOW_N).toBe("number");

    const state = createPressureState(1);
    const result = updatePressureState(state, {
      pressureAfterDecay: 1,
      gain: 1,
      activation: 0.3,
      deltaMessageSeconds: 1,
    });

    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("outputs");
    expect(result.outputs).toHaveProperty("pressure");
    expect(result.outputs).toHaveProperty("deltaPressure");
    expect(result.outputs).toHaveProperty("slope");
    expect(result.outputs).toHaveProperty("volatility");
    expect(result.outputs).toHaveProperty("isShock");
  });

  test("update order sanity uses pressureAfterDecay base and then shock/accumulation", () => {
    const noShockState = {
      ...createPressureState(0),
      prevActivation: 1,
    };
    const noShock = updatePressureState(noShockState, {
      pressureAfterDecay: 100,
      gain: 1,
      activation: 1,
      deltaMessageSeconds: 10,
    });
    expect(noShock.outputs.pressure).toBeGreaterThanOrEqual(100);
    expect(noShock.outputs.isShock).toBe(false);

    const shockState = {
      ...createPressureState(0),
      prevActivation: 0,
    };
    const shock = updatePressureState(shockState, {
      pressureAfterDecay: 100,
      gain: 1,
      activation: 1,
      deltaMessageSeconds: 10,
    });
    expect(shock.outputs.isShock).toBe(true);
    expect(shock.outputs.pressure).toBeGreaterThan(noShock.outputs.pressure);
  });

  test("delta and slope correctness including delta_t=0 behavior", () => {
    const state = createPressureState(10);
    const result = updatePressureState(state, {
      pressureAfterDecay: 9,
      gain: 1,
      activation: 0.5,
      deltaMessageSeconds: 2,
    });
    expect(result.outputs.deltaPressure).toBeCloseTo(
      result.outputs.pressure - state.prevPressure,
      12
    );
    expect(result.outputs.slope).toBeCloseTo(result.outputs.deltaPressure / 2, 12);

    const zeroDeltaT = updatePressureState(state, {
      pressureAfterDecay: 9,
      gain: 1,
      activation: 0.5,
      deltaMessageSeconds: 0,
    });
    expect(zeroDeltaT.outputs.slope).toBe(0);
    expect(Number.isFinite(zeroDeltaT.outputs.slope)).toBe(true);
  });

  test("volatility is higher for alternating activation than steady", () => {
    let steadyState = createPressureState(0);
    let alternatingState = createPressureState(0);
    let volatilityLow = 0;
    let volatilityHigh = 0;

    for (let i = 0; i < 30; i += 1) {
      const steady = updatePressureState(steadyState, {
        pressureAfterDecay: steadyState.pressure,
        gain: 1,
        activation: 0.5,
        deltaMessageSeconds: 1,
      });
      steadyState = steady.state;
      volatilityLow = steady.outputs.volatility;

      const alternating = updatePressureState(alternatingState, {
        pressureAfterDecay: alternatingState.pressure,
        gain: 1,
        activation: i % 2 === 0 ? 0 : 1,
        deltaMessageSeconds: 1,
      });
      alternatingState = alternating.state;
      volatilityHigh = alternating.outputs.volatility;
    }

    expect(volatilityHigh).toBeGreaterThan(volatilityLow);
  });

  test("finite outputs and non-negative pressure for 5k deterministic steps", () => {
    let state = createPressureState(10);
    let seed = 987654321;

    for (let i = 0; i < 5000; i += 1) {
      seed = lcgNext(seed);
      const normalized = seed / 2147483647;
      const activation = normalized * 2 - 0.5;

      const result = updatePressureState(state, {
        pressureAfterDecay: state.pressure,
        gain: [0.8, 1.0, 1.3][i % 3],
        activation,
        deltaMessageSeconds: [0, 0.001, 1, 10, 90][i % 5],
      });
      state = result.state;

      expect(Number.isFinite(result.outputs.pressure)).toBe(true);
      expect(Number.isFinite(result.outputs.deltaPressure)).toBe(true);
      expect(Number.isFinite(result.outputs.slope)).toBe(true);
      expect(Number.isFinite(result.outputs.volatility)).toBe(true);
      expect(result.outputs.pressure).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("hardening_against_invalid_inputs", () => {
  it("handles NaN inputs without propagating NaN", () => {
    const state = createPressureState(10);

    const { outputs } = updatePressureState(state, {
      pressureAfterDecay: Number.NaN,
      gain: Number.NaN,
      activation: Number.NaN,
      deltaMessageSeconds: Number.NaN,
    });

    expect(Number.isFinite(outputs.pressure)).toBe(true);
    expect(Number.isFinite(outputs.deltaPressure)).toBe(true);
    expect(Number.isFinite(outputs.slope)).toBe(true);
    expect(Number.isFinite(outputs.volatility)).toBe(true);
    expect(outputs.pressure).toBeGreaterThanOrEqual(0);
  });

  it("handles Infinity inputs without propagating Infinity", () => {
    const state = createPressureState(10);

    const { outputs } = updatePressureState(state, {
      pressureAfterDecay: Number.POSITIVE_INFINITY,
      gain: Number.NEGATIVE_INFINITY,
      activation: Number.POSITIVE_INFINITY,
      deltaMessageSeconds: Number.POSITIVE_INFINITY,
    });

    expect(Number.isFinite(outputs.pressure)).toBe(true);
    expect(Number.isFinite(outputs.deltaPressure)).toBe(true);
    expect(Number.isFinite(outputs.slope)).toBe(true);
    expect(Number.isFinite(outputs.volatility)).toBe(true);
    expect(outputs.pressure).toBeGreaterThanOrEqual(0);
  });
});

it("handles negative deltaMessageSeconds safely", () => {
  const state = createPressureState(5);

  const { outputs } = updatePressureState(state, {
    pressureAfterDecay: 5,
    gain: 1,
    activation: 0.5,
    deltaMessageSeconds: -10,
  });

  expect(outputs.slope).toBe(0);
  expect(Number.isFinite(outputs.pressure)).toBe(true);
  expect(outputs.pressure).toBeGreaterThanOrEqual(0);
});

it("does_not_apply_decay_internally_activation_zero_equals_pressureAfterDecay", () => {
  const state = createPressureState(20);

  const { outputs } = updatePressureState(state, {
    pressureAfterDecay: 15,
    gain: 1.3,
    activation: 0,
    deltaMessageSeconds: 100,
  });

  expect(outputs.pressure).toBeCloseTo(15, 8);
});

it("does_not_increase_pressure_without_activation_or_shock", () => {
  const state = createPressureState(10);

  const { outputs } = updatePressureState(state, {
    pressureAfterDecay: 8,
    gain: 10,
    activation: 0,
    deltaMessageSeconds: 10,
  });

  expect(outputs.pressure).toBeLessThanOrEqual(8);
});
