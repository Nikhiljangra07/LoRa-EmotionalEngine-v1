import { K_UP, SHOCK_GAIN, SHOCK_THRESHOLD, WINDOW_N } from "./constants";
import type { PressureInputs, PressureOutputs, PressureState } from "./types";

function asFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function computeVolatility(deltas: number[]): number {
  if (deltas.length < 2) {
    return 0;
  }

  let sumSquaredDiffs = 0;
  for (let i = 1; i < deltas.length; i += 1) {
    const diff = deltas[i] - deltas[i - 1];
    sumSquaredDiffs += diff * diff;
  }

  const mssd = sumSquaredDiffs / (deltas.length - 1);
  return asFinite(mssd, 0);
}

function nextRingBuffer(previous: number[], nextDelta: number): number[] {
  if (previous.length < WINDOW_N) {
    return [...previous, nextDelta];
  }

  return [...previous.slice(1), nextDelta];
}

export function createPressureState(initialPressure: number = 0): PressureState {
  const safeInitialPressure = asFinite(initialPressure, 0);
  return {
    pressure: safeInitialPressure,
    prevPressure: safeInitialPressure,
    prevActivation: 0,
    deltas: [],
  };
}

export function updatePressureState(
  state: PressureState,
  inputs: PressureInputs
): { state: PressureState; outputs: PressureOutputs } {
  const prevPressure = asFinite(state.prevPressure, 0);
  const prevActivation = asFinite(state.prevActivation, 0);

  const pressureAfterDecay = asFinite(inputs.pressureAfterDecay, prevPressure);
  const gain = asFinite(inputs.gain, 0);
  const activation = asFinite(inputs.activation, 0);
  const deltaMessageSeconds = asFinite(inputs.deltaMessageSeconds, 0);

  let pressure = pressureAfterDecay + gain * K_UP * activation;
  const deltaActivation = activation - prevActivation;
  const shock = Math.max(0, deltaActivation - SHOCK_THRESHOLD) * SHOCK_GAIN;
  pressure += shock;
  pressure = asFinite(pressure, prevPressure);
  // Guardrail boundary: prevent negative pressure drift under extreme negative activations.
  pressure = Math.max(0, pressure);

  const deltaPressure = asFinite(pressure - prevPressure, 0);
  const slope =
    deltaMessageSeconds > 0
      ? asFinite(deltaPressure / deltaMessageSeconds, 0)
      : 0;

  const deltas = nextRingBuffer(state.deltas, deltaPressure);
  const volatility = computeVolatility(deltas);
  const isShock = shock > 0;

  const nextState: PressureState = {
    pressure,
    prevPressure: pressure,
    prevActivation: activation,
    deltas,
  };

  return {
    state: nextState,
    outputs: {
      pressure,
      deltaPressure,
      slope,
      volatility,
      isShock,
    },
  };
}
