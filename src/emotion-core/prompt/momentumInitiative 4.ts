import { MASTER_CONSTANTS } from "../config/master.constants";
import type { GuidanceMode } from "../contracts/GuidanceMode";

export function allowMomentumInitiative(params: {
  momentumConfidence: number;
  valence: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  arousal: "LOW" | "MEDIUM" | "HIGH";
  guidanceMode: GuidanceMode;
}): boolean {
  return (
    params.momentumConfidence >=
      MASTER_CONSTANTS.momentum.initiative.confidenceMinInclusive &&
    params.valence === "POSITIVE" &&
    params.arousal !== "LOW" &&
    params.guidanceMode === "ENERGY_MATCH"
  );
}
