/**
 * Core type definitions for the Appraisal Lab module.
 * All types used across the module are defined here.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

// ============================================================
// Emotion labels (exactly 6, locked)
// ============================================================

export type Emotion =
  | "JOY"
  | "ANGER"
  | "FEAR"
  | "SADNESS"
  | "DISGUST"
  | "SURPRISE";

// ============================================================
// Appraisal dimension bins (exactly 6 dimensions, locked)
// ============================================================

export type Valence = "NEG" | "NEU" | "POS";
export type Arousal = "LOW" | "MED" | "HIGH";
export type Agency = "SELF" | "OTHER" | "SITUATION";
export type Control = "LOW" | "MED" | "HIGH";
export type Certainty = "LOW" | "HIGH";
export type GoalRelevance = "LOW" | "HIGH";

// ============================================================
// Data structures
// ============================================================

/** A complete appraisal vector across all six dimensions. */
export interface AppraisalVector {
  valence: Valence;
  arousal: Arousal;
  agency: Agency;
  control: Control;
  certainty: Certainty;
  goalRelevance: GoalRelevance;
}

/** A single labeled row in the dataset. */
export interface AppraisalRow {
  id: string;
  text: string;
  emotion: Emotion;
  appraisals: AppraisalVector;
}

// ============================================================
// Model structures
// ============================================================

/** Complete likelihood table for Naive Bayes classification. */
export interface LikelihoodTable {
  priors: Record<Emotion, number>;
  conditionals: {
    valence: Record<Emotion, Record<Valence, number>>;
    arousal: Record<Emotion, Record<Arousal, number>>;
    agency: Record<Emotion, Record<Agency, number>>;
    control: Record<Emotion, Record<Control, number>>;
    certainty: Record<Emotion, Record<Certainty, number>>;
    goalRelevance: Record<Emotion, Record<GoalRelevance, number>>;
  };
}

/** Full posterior distribution over all emotions. */
export interface PosteriorDistribution {
  distribution: Record<Emotion, number>;
  predicted: Emotion;
  confidence: number;
}

/** 6×6 confusion matrix for evaluation. */
export interface ConfusionMatrix {
  matrix: Record<Emotion, Record<Emotion, number>>;
  labels: Emotion[];
}

/** Holdout evaluation results. */
export interface EvaluationResult {
  accuracy: number;
  confusionMatrix: ConfusionMatrix;
  averageMaxProbability: number;
  totalSamples: number;
}
