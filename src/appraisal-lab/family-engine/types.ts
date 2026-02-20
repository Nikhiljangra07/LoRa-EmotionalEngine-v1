export enum EkmanFamily {
  JOY = "JOY",
  ANGER = "ANGER",
  FEAR = "FEAR",
  SADNESS = "SADNESS",
  SURPRISE = "SURPRISE",
  DISGUST = "DISGUST",
}

export type FamilyVector = {
  JOY: number;
  ANGER: number;
  FEAR: number;
  SADNESS: number;
  SURPRISE: number;
  DISGUST: number;
};

export interface PatternSignals {
  capsRatio: number;
  punctuationHits: number;
  emojiHits: number;
  repetitionScore: number;
  questionMarks: number;
}

export interface FamilyInputs {
  valence: number;
  arousal: number;
  expressionStrength: number;
  signals: PatternSignals;
  deltaMessageSeconds?: number;
  gain?: number;
}

export interface FamilyOutputs {
  familyWeights: FamilyVector;
  dominantFamily: EkmanFamily;
  confidence: number;
  reasons: string[];
}
