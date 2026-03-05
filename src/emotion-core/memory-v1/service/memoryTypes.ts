export interface EmotionSignal {
  valence: number;
  arousal: number;
  expressionStrength: number;
  inferenceReliability: number;
}

export type EmotionBand = 'B0' | 'B1' | 'B2' | 'B3' | 'B4';

export interface EmotionalMetrics {
  etv: number;
  eiv: number;
  band?: EmotionBand;
}

export interface MemorySaveInput {
  userId: string;
  messageId: string;
  content: string;
  timestamp: number;
  emotion: EmotionSignal;
  metrics: EmotionalMetrics;
  sessionId?: string;
  emotionVec?: number[];
}

export interface RetrieveContextOpts {
  emotionVec?: number[];
  nowMs?: number;
  band?: EmotionBand;
}

export interface AnchorRecord {
  anchorId: string;
  contentSummary: string;
  /** When set, anchor has a structured value (e.g. launch_date = 2026-03-23). Used for "Known facts" in prompt. */
  slotValue?: string;
  timestamp: number;
  emotion: EmotionSignal;
  metrics: EmotionalMetrics;
}

export interface SemanticRecord {
  schemaId: string;
  salienceWeight: number;
  episodeCount: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface MemoryContextResult {
  anchors: AnchorRecord[];
  semantic: SemanticRecord[];
  degraded: { falkor: boolean; chroma: boolean };
}

const CONTENT_SUMMARY_MAX = 240;

export function contentSummary(content: string): string {
  return content.length <= CONTENT_SUMMARY_MAX
    ? content
    : content.slice(0, CONTENT_SUMMARY_MAX);
}

export function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return val < min ? min : val > max ? max : val;
}

export function validateEmotionSignal(raw: EmotionSignal): EmotionSignal {
  return {
    valence: clamp(raw.valence, -1, 1),
    arousal: clamp(raw.arousal, 0, 1),
    expressionStrength: clamp(raw.expressionStrength, 0, 1),
    inferenceReliability: clamp(raw.inferenceReliability, 0, 1),
  };
}

export function validateMetrics(raw: EmotionalMetrics): EmotionalMetrics {
  const out: EmotionalMetrics = {
    etv: clamp(raw.etv, 0, 100),
    eiv: clamp(raw.eiv, 0, 100),
  };
  if (raw.band !== undefined) {
    out.band = raw.band;
  }
  return out;
}

const TEMPLATE_LABELS: Record<string, string> = {
  upcoming_event: 'Upcoming event',
  past_event: 'Past event',
  recurring_event: 'Recurring event',
  person_role: 'Person role',
  preference_positive: 'Preference (positive)',
  preference_negative: 'Preference (negative)',
  goal_active: 'Active goal',
  goal_completed: 'Completed goal',
  goal_objective: 'Goal',
  deployment_plan: 'Deployment plan',
  financial_commitment: 'Financial',
  project_stage: 'Project stage',
};

const SLOT_LABELS: Record<string, string> = {
  job_interview: 'job interview',
  exam: 'exam',
  meeting: 'meeting',
  birthday: 'birthday',
  appointment: 'appointment',
  wedding: 'wedding',
  travel: 'travel',
  deadline: 'deadline',
  therapy_session: 'therapy session',
  graduation: 'graduation',
  friend: 'friend',
  therapist: 'therapist',
  family_member: 'family member',
  manager: 'manager',
  partner: 'partner',
  colleague: 'colleague',
  doctor: 'doctor',
  mentor: 'mentor',
  exercise: 'exercise',
  diet: 'diet',
  career_change: 'career change',
  learning: 'learning',
  hobby: 'hobby',
  general_positive: 'general (positive)',
  general_negative: 'general (negative)',
  launch_date: 'launch date',
  money_amount: 'amount',
  stage: 'stage',
  objective: 'objective',
};

export function anchorSummaryLabel(template: string, slot: string): string {
  const tLabel = TEMPLATE_LABELS[template] ?? template;
  const sLabel = SLOT_LABELS[slot] ?? slot;
  return `${tLabel}: ${sLabel}`;
}
