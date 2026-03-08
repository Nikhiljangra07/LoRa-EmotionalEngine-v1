import { createPressureState, updatePressureState } from "..";

describe("pressure-engine", () => {
  test("no input: activation=0 keeps pressure at pressureAfterDecay", () => {
    const state = createPressureState(5);
    const result = updatePressureState(state, {
      pressureAfterDecay: 4.2,
      gain: 99,
      activation: 0,
      deltaMessageSeconds: 1,
    });

    expect(result.outputs.pressure).toBe(4.2);
    expect(result.outputs.deltaPressure).toBeCloseTo(-0.8, 10);
    expect(result.outputs.isShock).toBe(false);
  });

  test("steady build: constant activation and delta increase smoothly", () => {
    let state = createPressureState(0);
    const pressures: number[] = [];
    const increments: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      const result = updatePressureState(state, {
        pressureAfterDecay: state.pressure,
        gain: 1.0,
        activation: 0.4,
        deltaMessageSeconds: 2,
      });
      state = result.state;
      pressures.push(result.outputs.pressure);
      increments.push(result.outputs.deltaPressure);
    }

    expect(pressures[1]).toBeGreaterThan(pressures[0]);
    expect(pressures[4]).toBeGreaterThan(pressures[3]);
    expect(increments[2]).toBeCloseTo(increments[3], 10);
  });

  test("burst amplification: gain 1.3 yields larger increment than 1.0", () => {
    const baseState = createPressureState(2);

    const neutral = updatePressureState(baseState, {
      pressureAfterDecay: baseState.pressure,
      gain: 1.0,
      activation: 0.5,
      deltaMessageSeconds: 1,
    });

    const amplified = updatePressureState(baseState, {
      pressureAfterDecay: baseState.pressure,
      gain: 1.3,
      activation: 0.5,
      deltaMessageSeconds: 1,
    });

    expect(amplified.outputs.deltaPressure).toBeGreaterThan(
      neutral.outputs.deltaPressure
    );
  });

  test("silence cooling: gain 0.8 yields lower increment", () => {
    const baseState = createPressureState(2);

    const neutral = updatePressureState(baseState, {
      pressureAfterDecay: baseState.pressure,
      gain: 1.0,
      activation: 0.5,
      deltaMessageSeconds: 1,
    });

    const cooled = updatePressureState(baseState, {
      pressureAfterDecay: baseState.pressure,
      gain: 0.8,
      activation: 0.5,
      deltaMessageSeconds: 1,
    });

    expect(cooled.outputs.deltaPressure).toBeLessThan(neutral.outputs.deltaPressure);
  });

  test("shock spike: large activation jump sets isShock and lifts pressure jump", () => {
    let state = createPressureState(1);

    const first = updatePressureState(state, {
      pressureAfterDecay: state.pressure,
      gain: 1,
      activation: 0.1,
      deltaMessageSeconds: 1,
    });
    state = first.state;

    const second = updatePressureState(state, {
      pressureAfterDecay: state.pressure,
      gain: 1,
      activation: 1.0,
      deltaMessageSeconds: 1,
    });

    expect(second.outputs.isShock).toBe(true);
    expect(second.outputs.deltaPressure).toBeGreaterThan(first.outputs.deltaPressure);
  });

  test("slope sanity: deltaMessageSeconds=0 returns slope=0 and finite outputs", () => {
    const state = createPressureState(0);
    const result = updatePressureState(state, {
      pressureAfterDecay: 1,
      gain: 1,
      activation: 0.3,
      deltaMessageSeconds: 0,
    });

    expect(result.outputs.slope).toBe(0);
    expect(Number.isFinite(result.outputs.pressure)).toBe(true);
    expect(Number.isFinite(result.outputs.deltaPressure)).toBe(true);
    expect(Number.isFinite(result.outputs.volatility)).toBe(true);
  });

  test("volatility: alternating activation is noisier than steady activation", () => {
    let steadyState = createPressureState(0);
    let altState = createPressureState(0);

    let steadyVolatility = 0;
    let altVolatility = 0;

    for (let i = 0; i < 25; i += 1) {
      const steady = updatePressureState(steadyState, {
        pressureAfterDecay: steadyState.pressure,
        gain: 1,
        activation: 0.5,
        deltaMessageSeconds: 1,
      });
      steadyState = steady.state;
      steadyVolatility = steady.outputs.volatility;

      const alternatingActivation = i % 2 === 0 ? 0.1 : 0.9;
      const alt = updatePressureState(altState, {
        pressureAfterDecay: altState.pressure,
        gain: 1,
        activation: alternatingActivation,
        deltaMessageSeconds: 1,
      });
      altState = alt.state;
      altVolatility = alt.outputs.volatility;
    }

    expect(altVolatility).toBeGreaterThan(steadyVolatility);
  });
});
