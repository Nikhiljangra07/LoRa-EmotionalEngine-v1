export interface PressureInputs {
  pressureAfterDecay: number;
  gain: number;
  activation: number;
  deltaMessageSeconds: number;
}

export interface PressureOutputs {
  pressure: number;
  deltaPressure: number;
  slope: number;
  volatility: number;
  isShock: boolean;
}

export interface PressureState {
  pressure: number;
  prevPressure: number;
  prevActivation: number;
  deltas: number[];
}
