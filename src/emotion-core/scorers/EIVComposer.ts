import { MASTER_CONSTANTS } from "../config/master.constants";
import type { EnhancedEIVSignals } from "../processors/EIVComponentAssembler";

export type EIVInputs = {
  es: { score: number; confidence: number };
  valence: { score: number; confidence: number };
  arousal: { score: number; confidence: number };
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

/**
 * NOTE (LoRa v1):
 * EIV is composed from ES + Valence + Arousal:
 * EIV = base(arousal, |valence|) × ES_gain, with confidence weighting.
 *
 * Do NOT replace this with direct aggregation from EIVComponents.
 * The legacy path is preserved for callers without enhanced signals.
 *
 * When enhanced signals are available (v1.1), uses the recalibrated formula:
 * EIV = (w_s * |semanticScore|) + (w_a * arousalScore) + (w_r * repetitionWeight) + (w_c * capsWeight)
 */
const EIV_ENHANCED = MASTER_CONSTANTS.eiv.enhancedWeights;

export const composeEIV = (inputs: EIVInputs, enhanced?: EnhancedEIVSignals) => {
  if (enhanced) {
    const raw =
      EIV_ENHANCED.semanticScore * Math.abs(enhanced.semanticScore) +
      EIV_ENHANCED.arousalScore * enhanced.arousalScore +
      EIV_ENHANCED.repetitionWeight * enhanced.repetitionWeight +
      EIV_ENHANCED.capsWeight * enhanced.capsWeight;
    const eiv = clamp(raw, CONSTANTS.CLAMP.MIN, CONSTANTS.CLAMP.MAX);
    return {
      value: eiv,
      base: raw,
      baseConfidence: 1,
      gain: 1,
    };
  }

  const { es, valence, arousal } = inputs;
  const { base, baseConf } = confidenceWeightedBase(
    arousal.score,
    arousal.confidence,
    Math.abs(valence.score),
    valence.confidence
  );

  const baseIntensity = clamp(base, CONSTANTS.CLAMP.MIN, CONSTANTS.CLAMP.MAX);
  const gain = computeESGain(baseIntensity, es.score, es.confidence);
  const eiv = clamp(
    baseIntensity * gain,
    CONSTANTS.CLAMP.MIN,
    CONSTANTS.CLAMP.MAX
  );

  return {
    value: eiv,
    base: baseIntensity,
    baseConfidence: baseConf,
    gain,
  };
};
