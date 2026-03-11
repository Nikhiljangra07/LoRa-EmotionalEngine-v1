/**
 * Rule-based appraisal mapper for the Appraisal Lab.
 *
 * Maps each ISEAR row to a full appraisal vector based on the emotion
 * label alone (deterministic, no ML). This is a Layer 1 skeleton only.
 *
 * Mapping policy (from spec):
 *   ANGER:   NEG, HIGH, OTHER,     HIGH, HIGH, HIGH
 *   FEAR:    NEG, HIGH, SITUATION,  LOW,  LOW,  HIGH
 *   DISGUST: NEG, MED,  OTHER,     MED,  HIGH, HIGH  (GoalRelevance: spec says MED → mapped to HIGH, binary dimension)
 *   SADNESS: NEG, LOW,  SITUATION,  LOW,  HIGH, HIGH
 *   JOY:     POS, MED,  SELF,      HIGH, HIGH, HIGH
 *
 * Dimension order: Valence, Arousal, Agency, Control, Certainty, GoalRelevance
 *
 * Notes:
 *   - Agency "SITUATIONAL" from spec is mapped to "SITUATION" (locked type value).
 *   - GoalRelevance for DISGUST: spec says "MED" but the type is binary (LOW|HIGH).
 *     Mapped to "HIGH" since disgust typically involves goal-relevant stimuli.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import { Emotion, AppraisalVector, AppraisalRow } from '../types';
import { ISEARRow } from './isear_loader';

// ============================================================
// Deterministic mapping table
// ============================================================

/**
 * Fixed appraisal vector for each emotion.
 * These are qualitative defaults for the Layer 1 skeleton.
 */
const APPRAISAL_MAP: Record<string, AppraisalVector> = {
  ANGER: {
    valence:       "NEG",
    arousal:       "HIGH",
    agency:        "OTHER",
    control:       "HIGH",
    certainty:     "HIGH",
    goalRelevance: "HIGH",
  },
  FEAR: {
    valence:       "NEG",
    arousal:       "HIGH",
    agency:        "SITUATION",
    control:       "LOW",
    certainty:     "LOW",
    goalRelevance: "HIGH",
  },
  DISGUST: {
    valence:       "NEG",
    arousal:       "MED",
    agency:        "OTHER",
    control:       "MED",
    certainty:     "HIGH",
    goalRelevance: "HIGH",
  },
  SADNESS: {
    valence:       "NEG",
    arousal:       "LOW",
    agency:        "SITUATION",
    control:       "LOW",
    certainty:     "HIGH",
    goalRelevance: "HIGH",
  },
  JOY: {
    valence:       "POS",
    arousal:       "MED",
    agency:        "SELF",
    control:       "HIGH",
    certainty:     "HIGH",
    goalRelevance: "HIGH",
  },
};

// ============================================================
// Public API
// ============================================================

/**
 * Get the fixed appraisal vector for a given emotion.
 *
 * @param emotion - One of the 5 ISEAR target emotions.
 * @returns The corresponding AppraisalVector.
 * @throws If the emotion has no mapping defined.
 */
export function getAppraisalMapping(emotion: Emotion): AppraisalVector {
  const mapping = APPRAISAL_MAP[emotion];
  if (!mapping) {
    throw new Error(`No appraisal mapping defined for emotion: ${emotion}`);
  }
  // Return a copy to prevent mutation
  return { ...mapping };
}

/**
 * Map a single ISEARRow to a full AppraisalRow.
 *
 * @param row - An ISEARRow with id, text, and emotion.
 * @returns An AppraisalRow with the deterministic appraisal vector.
 */
export function mapToAppraisalRow(row: ISEARRow): AppraisalRow {
  return {
    id: row.id,
    text: row.text,
    emotion: row.emotion,
    appraisals: getAppraisalMapping(row.emotion),
  };
}

/**
 * Map an array of ISEARRows to AppraisalRows.
 *
 * @param rows - Array of ISEARRow objects.
 * @returns Array of AppraisalRow objects with deterministic appraisal vectors.
 */
export function mapAllToAppraisalRows(rows: ISEARRow[]): AppraisalRow[] {
  return rows.map(mapToAppraisalRow);
}
