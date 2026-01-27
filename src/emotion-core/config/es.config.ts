import { MASTER_CONSTANTS } from "./master.constants";

const es = MASTER_CONSTANTS.es;

export const ES_CONFIG = {
  weights: es.weights,
  saturation: es.saturation,
  shortMessage: es.shortMessage,
  scoring: es.scoring,
  clipMin: es.clip.min,
  clipMax: es.clip.max,
};