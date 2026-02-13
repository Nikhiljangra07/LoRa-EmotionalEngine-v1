/**
 * Schema constants and validation for the Appraisal Lab module.
 * Enumerates all valid values for emotions and appraisal dimensions.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import {
  Emotion, Valence, Arousal, Agency, Control, Certainty, GoalRelevance,
  AppraisalRow,
} from './types';

// ============================================================
// Canonical value arrays
// ============================================================

export const EMOTIONS: readonly Emotion[] = [
  "JOY", "ANGER", "FEAR", "SADNESS", "DISGUST", "SURPRISE",
] as const;

export const VALENCE_BINS: readonly Valence[] = ["NEG", "NEU", "POS"] as const;
export const AROUSAL_BINS: readonly Arousal[] = ["LOW", "MED", "HIGH"] as const;
export const AGENCY_BINS: readonly Agency[] = ["SELF", "OTHER", "SITUATION"] as const;
export const CONTROL_BINS: readonly Control[] = ["LOW", "MED", "HIGH"] as const;
export const CERTAINTY_BINS: readonly Certainty[] = ["LOW", "HIGH"] as const;
export const GOAL_RELEVANCE_BINS: readonly GoalRelevance[] = ["LOW", "HIGH"] as const;

/** All dimension bin arrays indexed by dimension name. */
export const DIMENSION_BINS = {
  valence: VALENCE_BINS,
  arousal: AROUSAL_BINS,
  agency: AGENCY_BINS,
  control: CONTROL_BINS,
  certainty: CERTAINTY_BINS,
  goalRelevance: GOAL_RELEVANCE_BINS,
} as const;

/** Dimension names as a typed tuple. */
export const DIMENSION_NAMES = [
  "valence", "arousal", "agency", "control", "certainty", "goalRelevance",
] as const;

export type DimensionName = (typeof DIMENSION_NAMES)[number];

// ============================================================
// Validation
// ============================================================

/** Validate that a row conforms to the schema. Returns true if valid. */
export function validateRow(row: AppraisalRow): boolean {
  if (!row.id || typeof row.id !== "string") return false;
  if (!row.text || typeof row.text !== "string") return false;
  if (!(EMOTIONS as readonly string[]).includes(row.emotion)) return false;
  if (!row.appraisals) return false;
  if (!(VALENCE_BINS as readonly string[]).includes(row.appraisals.valence)) return false;
  if (!(AROUSAL_BINS as readonly string[]).includes(row.appraisals.arousal)) return false;
  if (!(AGENCY_BINS as readonly string[]).includes(row.appraisals.agency)) return false;
  if (!(CONTROL_BINS as readonly string[]).includes(row.appraisals.control)) return false;
  if (!(CERTAINTY_BINS as readonly string[]).includes(row.appraisals.certainty)) return false;
  if (!(GOAL_RELEVANCE_BINS as readonly string[]).includes(row.appraisals.goalRelevance)) return false;
  return true;
}
