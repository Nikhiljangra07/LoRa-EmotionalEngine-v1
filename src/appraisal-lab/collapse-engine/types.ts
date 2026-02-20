export enum MoodCategory {
  POSITIVE = "POSITIVE",
  IRRITABLE = "IRRITABLE",
  ANXIOUS = "ANXIOUS",
  MELANCHOLIC = "MELANCHOLIC",
  ALERT = "ALERT",
  AVERSIVE = "AVERSIVE",
  NEUTRAL = "NEUTRAL",
}

export enum CollapseDirection {
  NONE = "NONE",
  OUTWARD = "OUTWARD",
  INWARD = "INWARD",
}

export interface CollapseInputs {
  escalationLevel: number;
  escalationScore: number;
  pressure: number;
  pressureSlope: number;
  moodCategory: MoodCategory;
  gain: number;
  deltaMessageSeconds: number;
  silenceFlag?: boolean;
  burstFlag?: boolean;
  negValenceHint?: number;
}

export interface CollapseOutputs {
  collapseEvent: boolean;
  collapseSeverity: number;
  collapseDirection: CollapseDirection;
  reasons: string[];
}

export interface CollapseState {
  inCollapse: boolean;
  lastEventAtN: number;
  cooldownSeconds: number;
  n: number;
}
