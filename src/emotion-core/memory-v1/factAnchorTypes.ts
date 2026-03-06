export type AnchorType =
  | 'date_event'
  | 'person'
  | 'preference'
  | 'goal'
  | 'deployment_plan'
  | 'financial_commitment'
  | 'project_stage';

export type AnchorTemplate =
  | 'upcoming_event'
  | 'past_event'
  | 'recurring_event'
  | 'person_role'
  | 'preference_positive'
  | 'preference_negative'
  | 'goal_active'
  | 'goal_completed'
  | 'deployment_plan'
  | 'financial_commitment'
  | 'project_stage'
  | 'goal_objective';

export type AnchorSlot =
  | 'job_interview'
  | 'exam'
  | 'meeting'
  | 'birthday'
  | 'appointment'
  | 'wedding'
  | 'travel'
  | 'deadline'
  | 'therapy_session'
  | 'graduation'
  | 'friend'
  | 'therapist'
  | 'family_member'
  | 'manager'
  | 'partner'
  | 'colleague'
  | 'doctor'
  | 'mentor'
  | 'exercise'
  | 'diet'
  | 'career_change'
  | 'learning'
  | 'hobby'
  | 'general_positive'
  | 'general_negative'
  | 'launch_date'
  | 'money_amount'
  | 'stage'
  | 'objective';

export type AnchorSummaryTemplate = {
  template: AnchorTemplate;
  slot: AnchorSlot;
};

export type FactAnchorStatus =
  | 'quarantined'
  | 'confirmed';

/** Source of the fact: explicit statement, update verb, or vague/inferred. */
export type AnchorSourceType = 'explicit' | 'update' | 'inferred';

export interface FactAnchor {
  anchorId: string;
  userId: string;
  type: AnchorType;

  summary: AnchorSummaryTemplate;

  /** Normalized value for structured anchors (e.g. launch_date, money_amount). No raw transcript. */
  value?: string | number;

  date?: string;

  entityRole?: AnchorSlot;

  salience: number;
  extractionConfidence: number;

  /** 0–1 reliability for ranking; falls back to extractionConfidence when absent (legacy). */
  confidence?: number;
  /** How the fact was stated: explicit, update verb, or inferred. */
  sourceType?: AnchorSourceType;
  /** Ranking weight: update=3, explicit=2, inferred=1. */
  priority?: number;

  status: FactAnchorStatus;

  emotionVecAtCreation: number[];

  sessionId: string;

  createdAt: number;

  expiresAt?: number;

  reinforceCount: number;
  appearsInSessions: number;
  lastSeenSessionId: string;
}

export const MAX_ANCHORS_CONFIRMED = 15;
export const MAX_ANCHORS_QUARANTINED = 10;
export const MAX_ANCHORS_IN_PROMPT = 3;

export const QUARANTINE_THRESHOLD = 0.60;
