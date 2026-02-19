/**
 * Layer-2: Deterministic 13→7 emotion collapse map.
 * Maps crowd-enVent fine-grained emotions to Ekman-6 + Neutral.
 *
 * Fully isolated — no imports from runtime or Layer-1.
 */

export type CollapsedEmotion =
  | "ANGER"
  | "FEAR"
  | "SADNESS"
  | "DISGUST"
  | "JOY"
  | "SURPRISE"
  | "NEUTRAL";

const COLLAPSE_MAP: Record<string, CollapsedEmotion> = {
  anger: "ANGER",
  fear: "FEAR",
  sadness: "SADNESS",
  shame: "SADNESS",
  guilt: "SADNESS",
  disgust: "DISGUST",
  joy: "JOY",
  pride: "JOY",
  relief: "JOY",
  trust: "JOY",
  surprise: "SURPRISE",
  "no-emotion": "NEUTRAL",
  boredom: "NEUTRAL",
};

export const COLLAPSED_EMOTIONS: CollapsedEmotion[] = [
  "ANGER",
  "DISGUST",
  "FEAR",
  "JOY",
  "NEUTRAL",
  "SADNESS",
  "SURPRISE",
];

export function collapseEmotion(raw: string): CollapsedEmotion {
  const key = raw.trim().toLowerCase();
  const mapped = COLLAPSE_MAP[key];
  if (!mapped) {
    throw new Error(`Unknown emotion label: "${raw}"`);
  }
  return mapped;
}
