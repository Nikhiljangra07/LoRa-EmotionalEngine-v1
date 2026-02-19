/**
 * Layer-2: Ekman-6 inference configuration.
 *
 * Pure config — no side effects, no imports beyond types.
 */

export type PriorMode = "learned" | "uniform";
export type WeightMode = "linear_floor" | "tiered";

export interface Ekman6InferenceConfig {
  PRIOR_MODE: PriorMode;
  WEIGHT_MODE: WeightMode;
  PAIR_AWARE_BOOST: boolean;

  WEIGHT_FLOOR: number;
  WEIGHT_SLOPE: number;

  CONTROL_MIN_BOOST: number;
  CERTAINTY_MIN_BOOST: number;
  AROUSAL_MIN_BOOST: number;
}

export const DEFAULT_CONFIG: Ekman6InferenceConfig = {
  PRIOR_MODE: "uniform",
  WEIGHT_MODE: "linear_floor",
  PAIR_AWARE_BOOST: true,

  WEIGHT_FLOOR: 0.30,
  WEIGHT_SLOPE: 0.70,

  CONTROL_MIN_BOOST: 0.45,
  CERTAINTY_MIN_BOOST: 0.45,
  AROUSAL_MIN_BOOST: 0.35,
};
