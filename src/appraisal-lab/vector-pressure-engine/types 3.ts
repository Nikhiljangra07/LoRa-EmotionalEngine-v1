export type Family = "JOY" | "ANGER" | "FEAR" | "SADNESS" | "SURPRISE" | "DISGUST";

export type FamilyVector = Record<Family, number>;

export interface VectorPressureInput {
  pressureAfterDecayByFamily: FamilyVector;
  familyWeights: FamilyVector;
  confidence: number;
  gain: number;
  deltaMessageSeconds: number;
}

export interface VectorPressureState {
  pressureByFamily: FamilyVector;
  prevPressureByFamily: FamilyVector;
  prevWeights: FamilyVector;
  deltasTotal: number[];
  volatilityWindowSize: number;
}

export interface VectorPressureOutput {
  pressureByFamily: FamilyVector;
  deltaPressureByFamily: FamilyVector;
  dominantFamily: Family;
  totalPressure: number;
  volatilityTotal: number;
  isShock: boolean;
}

export interface VectorPressureUpdateResult {
  state: VectorPressureState;
  output: VectorPressureOutput;
}
