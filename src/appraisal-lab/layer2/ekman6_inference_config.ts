/**
 * Layer-2: Ekman-6 inference configuration.
 *
 * Pure config — no side effects, no imports beyond types.
 */

export type PriorMode = "uniform" | "learned" | "blend";
export type WeightMode = "linear_floor" | "tiered";

export interface Ekman6InferenceConfig {
  priorMode: PriorMode;
  priorBlendLambda: number;
  weightMode: WeightMode;
  pairAwareBoost: boolean;

  weightFloor: number;
  weightSlope: number;

  controlMinBoost: number;
  certaintyMinBoost: number;
  arousalMinBoost: number;

  // Ekman6-specific reliability gate thresholds.
  pmaxCommit: number;
  marginCommit: number;
  entropyHedge: number;
}

export const DEFAULT_CONFIG: Ekman6InferenceConfig = {
  priorMode: "blend",
  priorBlendLambda: 0.20,
  weightMode: "linear_floor",
  pairAwareBoost: true,

  weightFloor: 0.30,
  weightSlope: 0.70,

  controlMinBoost: 0.45,
  certaintyMinBoost: 0.45,
  arousalMinBoost: 0.35,

  pmaxCommit: 0.45,
  marginCommit: 0.15,
  entropyHedge: 0.80,
};
