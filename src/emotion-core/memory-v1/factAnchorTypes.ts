export type AnchorType =
  | 'date_event'
  | 'person'
  | 'preference'
  | 'goal';

export type AnchorTemplate =
  | 'upcoming_event'
  | 'past_event'
  | 'recurring_event'
  | 'person_role'
  | 'preference_positive'
  | 'preference_negative'
  | 'goal_active'
  | 'goal_completed';

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
  | 'general_negative';

export type AnchorSummaryTemplate = {
  template: AnchorTemplate;
  slot: AnchorSlot;
};

export type FactAnchorStatus =
  | 'quarantined'
  | 'confirmed';

export interface FactAnchor {
  anchorId: string;
  userId: string;
  type: AnchorType;

  summary: AnchorSummaryTemplate;

  date?: string;

  entityRole?: AnchorSlot;

  salience: number;
  extractionConfidence: number;

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
