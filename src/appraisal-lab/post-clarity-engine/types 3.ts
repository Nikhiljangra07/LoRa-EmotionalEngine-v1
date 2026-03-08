export type CollapseDirection = "NONE" | "OUTWARD" | "INWARD" | "UNKNOWN";

export interface PostClarityInputs {
  collapseEvent: boolean;
  collapseDirection?: CollapseDirection;

  escalationLevel: number; // 0..3
  escalationScore: number; // 0..1

  pressure: number; // >= 0
  pressureSlope: number; // finite

  valence: number; // -1..1

  deltaMessageSeconds: number; // >= 0

  repetitionScore?: number; // 0..1
  gain?: number; // >=0
  validationSeekingScore?: number; // 0..1 (proxy: reassurance seeking / "tell me I'm ok")
  topicShiftScore?: number; // 0..1 (proxy: substitution / jumping targets)
  positiveReframeScore?: number; // 0..1 (proxy: narrative reframe attempt)
}

export interface PostClarityState {
  agencyDeficit: number; // 0..1

  postModeUntilSeconds: number; // remaining active window
  cooldownSeconds: number; // relapse cooldown

  relapseCount: number;

  n: number; // message counter
  spiralScore: number; // 0..1
  substituteScore: number; // 0..1
  recentRepetition: number[]; // ring buffer
  recentUrgency: number[]; // ring buffer
  recentSeeking: number[]; // ring buffer
}

export interface PostClarityOutputs {
  postModeActive: boolean;
  agencyDeficit: number;
  isRelapse: boolean;
  reasons: string[];
  recoveryPath: "SPIRAL" | "SUBSTITUTE" | "UNKNOWN";
}
