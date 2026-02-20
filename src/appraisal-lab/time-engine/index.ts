export { computeDeltaSeconds, computeTimeDeltas } from "./timestamp-normalizer";
export {
  TAU_LONG_SECONDS,
  TAU_SHORT_SECONDS,
  applyTimeDecay,
  exponentialDecay,
} from "./decay-engine";
export {
  DEFAULT_BASELINE_LATENCY_SECONDS,
  computeGainModifier,
  detectBurst,
  detectSilence,
} from "./latency-detector";
export {
  SESSION_THRESHOLD_SECONDS,
  applySessionDecay,
  isNewSession,
} from "./session-boundary";
export type { TimeDeltaResult, UnixTimestampSeconds } from "./types";
