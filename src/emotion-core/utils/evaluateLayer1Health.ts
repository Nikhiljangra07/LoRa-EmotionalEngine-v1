import type { Layer1Health } from "../types/SignalPacket.types";

export const evaluateLayer1Health = (confidences: {
  es?: number;
  valence?: number;
  arousal?: number;
  ambiguity?: number;
}): Layer1Health => {
  for (const [key, value] of Object.entries(confidences)) {
    if (value !== undefined && value < 0.3) {
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
