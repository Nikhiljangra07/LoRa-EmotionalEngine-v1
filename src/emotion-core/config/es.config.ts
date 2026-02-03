import { MASTER_CONSTANTS } from "./master.constants";

const es = MASTER_CONSTANTS.expressionStrength;

// Minimal expressivity for any non-empty human utterance.
export const ES_BASELINE_FLOOR = es.baselineFloor;

export const ES_CONFIG = {
  numbers: es.numbers,
  density: es.density,
  elongation: es.elongation,
  weights: es.weights,
  saturation: es.saturation,
  shortMessage: es.shortMessage,
  scoring: es.scoring,
  clipMin: es.clip.min,
  clipMax: es.clip.max,
};