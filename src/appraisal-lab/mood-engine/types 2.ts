export enum EmotionFamily {
  JOY = "JOY",
  ANGER = "ANGER",
  FEAR = "FEAR",
  SADNESS = "SADNESS",
  SURPRISE = "SURPRISE",
  DISGUST = "DISGUST",
}

export enum MoodCategory {
  POSITIVE = "POSITIVE",
  IRRITABLE = "IRRITABLE",
  ANXIOUS = "ANXIOUS",
  MELANCHOLIC = "MELANCHOLIC",
  ALERT = "ALERT",
  AVERSIVE = "AVERSIVE",
  NEUTRAL = "NEUTRAL",
}

export type FamilyVector = Record<EmotionFamily, number>;
export type MoodVector = Record<MoodCategory, number>;

export interface MoodInputs {
  familyWeights: FamilyVector;
  pressureVector: FamilyVector;
  deltaMessageSeconds: number;
  escalationLevel?: number;
  isShock?: boolean;
}

export interface MoodOutputs {
  moodCategory: MoodCategory;
  moodVector: MoodVector;
  moodDominance: number;
  moodConfidence: number;
  reasons: string[];
}

export interface MoodState {
  moodEMA: FamilyVector;
  moodCategory: MoodCategory;
  prevMoodCategory: MoodCategory;
  lastDominantFamily: EmotionFamily;
  cooldownSeconds: number;
  n: number;
}
