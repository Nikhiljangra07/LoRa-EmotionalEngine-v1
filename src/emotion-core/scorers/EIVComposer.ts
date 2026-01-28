import { MASTER_CONSTANTS } from "../config/master.constants";

export type EIVInputs = {
  es: { score: number; confidence: number };
  valence: { score: number; confidence: number };
  arousal: { arousal: number; confidence: number };
};

const CONSTANTS = MASTER_CONSTANTS.eivCompositionConstants;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const clampConfidence = (value: number): number =>
  clamp(value, CONSTANTS.CONF.MIN, CONSTANTS.CONF.MAX);

const confidenceWeightedBase = (
  arousal: number,
  arousalConf: number,
  valenceMagnitude: number,
  valenceConf: number
) => {
  const wAr = clampConfidence(arousalConf);
  const wVal = clampConfidence(valenceConf);
  const denominator = wAr + wVal + CONSTANTS.EPS;
  const base = (wAr * arousal + wVal * valenceMagnitude) / denominator;
  const baseConf = (wAr * arousalConf + wVal * valenceConf) / denominator;
  return { base, baseConf };
};

const computeESGain = (
  base: number,
  esScore: number,
  esConfidence: number
) => {
  const scale =
    base < CONSTANTS.BASE_FLOOR_GATE
      ? CONSTANTS.LOW_BASE_GAIN_SCALE
      : 1;
  return 1 + CONSTANTS.ES_GAIN_MAX_DELTA * scale * esScore * esConfidence;
};

export const composeEIV = (inputs: EIVInputs) => {
  const { es, valence, arousal } = inputs;
  const { base, baseConf } = confidenceWeightedBase(
    arousal.arousal,
    arousal.confidence,
    Math.abs(valence.score),
    valence.confidence
  );

  const gain = computeESGain(base, es.score, es.confidence);
  const eiv = clamp(base * gain, CONSTANTS.CLAMP.MIN, CONSTANTS.CLAMP.MAX);

  return {
    value: eiv,
    base,
    baseConfidence: baseConf,
    gain,
  };
};
