export type HarnessEvent = {
  tsSeconds: number;
  activation: number;
  valence: number;
  arousal: number;
  expressionStrength: number;
  pattern: {
    capsRatio?: number;
    punctuationHits?: number;
    repetitionScore?: number;
    questionMarks?: number;
    emojiCount?: number;
  };
  substituteEvidence?: {
    validationSeekingScore?: number;
    topicShiftScore?: number;
    positiveReframeScore?: number;
  };
};

export type HarnessStepTrace = {
  i: number;
  tsSeconds: number;
  harnessTags: string[];
  time: {
    deltaMessageSeconds: number;
    deltaSessionSeconds: number;
    pressureAfterDecay: number;
    gain: number;
  };
  pressure: {
    inputs: {
      pressureAfterDecay: number;
      gain: number;
      activation: number;
      deltaMessageSeconds: number;
    };
    outputs: {
      pressure: number;
      deltaPressure: number;
      slope: number;
      volatility: number;
      isShock: boolean;
    };
  };
  escalation: {
    inputs: {
      slope: number;
      volatility: number;
      isShock: boolean;
      gain: number;
      deltaMessageSeconds: number;
    };
    outputs: {
      escalationLevel: number;
      escalationScore: number;
      reasons: string[];
    };
  };
  collapse: {
    inputs: {
      escalationLevel: number;
      escalationScore: number;
      pressure: number;
      pressureSlope: number;
      volatility: number;
      isShock: boolean;
      deltaMessageSeconds: number;
    };
    outputs: {
      collapseEvent: boolean;
      collapseDirection: string;
      reasons: string[];
    };
  };
  postClarity: {
    inputs: {
      collapseEvent: boolean;
      collapseDirection: string;
      escalationLevel: number;
      escalationScore: number;
      pressure: number;
      pressureSlope: number;
      valence: number;
      deltaMessageSeconds: number;
      repetitionScore: number;
      gain: number;
      validationSeekingScore: number;
      topicShiftScore: number;
      positiveReframeScore: number;
    };
    outputs: {
      postModeActive: boolean;
      recoveryPath: "SPIRAL" | "SUBSTITUTE" | "UNKNOWN";
      reasons: string[];
      agencyDeficit: number;
    };
  };
};

export type HarnessRunResult = {
  steps: HarnessStepTrace[];
  summary: {
    maxEscLevel: number;
    maxEscScore: number;
    collapseCount: number;
    firstCollapseIndex: number | null;
    everPostMode: boolean;
    everSubstitute: boolean;
  };
};

export type HarnessScenario = {
  name: string;
  events: HarnessEvent[];
};
