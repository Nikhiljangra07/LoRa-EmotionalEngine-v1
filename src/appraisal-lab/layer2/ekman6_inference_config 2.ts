/**
 * Layer-2: Ekman-6 inference configuration.
 *
 * Pure config — no side effects, no imports beyond types.
 */

export type PriorMode = "uniform" | "learned" | "blend";
export type WeightMode = "linear_floor" | "tiered";

export interface RawEkman6Config {
  // New style
  pmaxCommit?: number;
  marginCommit?: number;
  entropyHedge?: number;

  // Legacy style
  PMAX_COMMIT?: number;
  MARGIN_COMMIT?: number;
  ENTROPY_HEDGE?: number;

  // Existing fields
  priorMode?: PriorMode;
  priorBlendLambda?: number;
  weightMode?: WeightMode;
  pairAwareBoost?: boolean;
  weightFloor?: number;
  weightSlope?: number;
  controlMinBoost?: number;
  certaintyMinBoost?: number;
  arousalMinBoost?: number;
}

export interface ResolvedEkman6Config {
  pmaxCommit: number;
  marginCommit: number;
  entropyHedge: number;

  priorMode: PriorMode;
  priorBlendLambda: number;
  weightMode: WeightMode;
  pairAwareBoost: boolean;

  // Existing fields retained for inference math
  weightFloor: number;
  weightSlope: number;
  controlMinBoost: number;
  certaintyMinBoost: number;
  arousalMinBoost: number;
}

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

export function normalizeEkman6Config(
  raw?: RawEkman6Config
): ResolvedEkman6Config {
  const DEFAULTS = DEFAULT_CONFIG;

  const pmax =
    raw?.pmaxCommit ??
    raw?.PMAX_COMMIT ??
    DEFAULTS.pmaxCommit;

  const margin =
    raw?.marginCommit ??
    raw?.MARGIN_COMMIT ??
    DEFAULTS.marginCommit;

  const entropy =
    raw?.entropyHedge ??
    raw?.ENTROPY_HEDGE ??
    DEFAULTS.entropyHedge;

  if (raw?.PMAX_COMMIT || raw?.MARGIN_COMMIT || raw?.ENTROPY_HEDGE) {
    console.warn("[Layer2] Legacy uppercase config detected. Please migrate to camelCase.");
  }

  return {
    pmaxCommit: pmax,
    marginCommit: margin,
    entropyHedge: entropy,
    priorMode: raw?.priorMode ?? DEFAULTS.priorMode,
    priorBlendLambda: raw?.priorBlendLambda ?? DEFAULTS.priorBlendLambda,
    weightMode: raw?.weightMode ?? DEFAULTS.weightMode,
    pairAwareBoost: raw?.pairAwareBoost ?? DEFAULTS.pairAwareBoost,
    weightFloor: raw?.weightFloor ?? DEFAULTS.weightFloor,
    weightSlope: raw?.weightSlope ?? DEFAULTS.weightSlope,
    controlMinBoost: raw?.controlMinBoost ?? DEFAULTS.controlMinBoost,
    certaintyMinBoost: raw?.certaintyMinBoost ?? DEFAULTS.certaintyMinBoost,
    arousalMinBoost: raw?.arousalMinBoost ?? DEFAULTS.arousalMinBoost,
  };
}
