import type { Layer1Health } from "../types/SignalPacket.types";
import { MASTER_CONSTANTS } from "../config/master.constants";

export const evaluateLayer1Health = (confidences: {
  es?: number;
  valence?: number;
  arousal?: number;
  ambiguity?: number;
}): Layer1Health => {
  for (const [key, value] of Object.entries(confidences)) {
    if (
      value !== undefined &&
      value <
        MASTER_CONSTANTS.layer1.degradation
          .confidenceThreshold
    ) {
      return {
        degraded: true,
        reason: "low_layer1_confidence",
        failingAnalyzer: key,
      };
    }
  }

  return {
    degraded: false,
    reason: "layer1_confidence_ok",
  };
};
