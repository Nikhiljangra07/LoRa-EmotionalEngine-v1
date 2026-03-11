import type { FamilyVector } from "./types";

export type MoodCategory =
  | "EUPHORIC"
  | "HOSTILE"
  | "ANXIOUS"
  | "DYSPHORIC"
  | "ALERT"
  | "AVERSIVE"
  | "NONE";

export function applyMoodPriming(
  weights: FamilyVector,
  mood: MoodCategory = "NONE"
): FamilyVector {
  // v0 no-op. Future: mood can lower thresholds and bias family weights.
  void mood;
  return weights;
}
