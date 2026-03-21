import type {
  FactAnchor,
  AnchorType,
  AnchorTemplate,
  AnchorSlot,
  AnchorSourceType,
} from './factAnchorTypes';
import { QUARANTINE_THRESHOLD } from './factAnchorTypes';
import { extractStructuredFact } from './factTemplates';
import { MIN_CONFIDENCE } from './anchorRanking';

const SESSION_ANCHOR_CAP = 3;
const MAX_ANCHORS_PER_MESSAGE = 2;

const REMEMBER_INTENT_RE = /\b(?:remember that|save that|don'?t forget)\b/i;

/** Update verbs for deployment_plan: change/move/reschedule/shift/update/push (it )?to DATE */
const DEPLOYMENT_UPDATE_VERB_RE = /\b(?:change|move|reschedule|shift|update|push)\s+(?:it\s+)?to\s+/i;

// ---------------------------------------------------------------------------
// Goal patterns
// ---------------------------------------------------------------------------

const GOAL_RE = /\b(?:my goal is|i want to|i am trying to)\b/i;

const GOAL_SLOT_MAP: Array<[RegExp, AnchorSlot]> = [
  [/\b(?:exercise|workout|gym|run(?:ning)?|fitness|train(?:ing)?)\b/i, 'exercise'],
  [/\b(?:diet|eat(?:ing)? (?:healthy|better|clean)|nutrition|lose weight)\b/i, 'diet'],
  [/\b(?:career|job|promotion|work|profession)\b/i, 'career_change'],
  [/\b(?:learn|study|course|class|education|read(?:ing)?|skill)\b/i, 'learning'],
  [/\b(?:hobby|paint(?:ing)?|music|craft|garden(?:ing)?|cook(?:ing)?)\b/i, 'hobby'],
];

// ---------------------------------------------------------------------------
// Preference patterns
// ---------------------------------------------------------------------------

const PREF_POSITIVE_RE = /\b(?:i (?:really )?(?:like|love|enjoy|prefer))\b/i;
const PREF_NEGATIVE_RE = /\b(?:i (?:really )?(?:hate|dislike|can'?t stand|detest))\b/i;

// ---------------------------------------------------------------------------
// Date event patterns
// ---------------------------------------------------------------------------

const DATE_EVENT_SLOTS: Array<[RegExp, AnchorSlot]> = [
  [/\binterview\b/i, 'job_interview'],
  [/\bexam\b/i, 'exam'],
  [/\bmeeting\b/i, 'meeting'],
  [/\bbirthday\b/i, 'birthday'],
  [/\bappointment\b/i, 'appointment'],
  [/\bwedding\b/i, 'wedding'],
  [/\b(?:travel|trip|vacation|flight)\b/i, 'travel'],
  [/\bdeadline\b/i, 'deadline'],
  [/\b(?:therapy|therapy session)\b/i, 'therapy_session'],
  [/\bgraduation\b/i, 'graduation'],
];

const DATE_INDICATOR_RE = /\b(?:tomorrow|next week|next month|next year|on \w+|this (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

// ---------------------------------------------------------------------------
// Person role patterns
// ---------------------------------------------------------------------------

const PERSON_ROLE_MAP: Array<[RegExp, AnchorSlot]> = [
  [/\bmy (?:best )?friend\b/i, 'friend'],
  [/\bmy therapist\b/i, 'therapist'],
  [/\bmy (?:mom|dad|mother|father|brother|sister|parent|family)\b/i, 'family_member'],
  [/\bmy (?:manager|boss|supervisor)\b/i, 'manager'],
  [/\bmy (?:partner|wife|husband|girlfriend|boyfriend|spouse)\b/i, 'partner'],
  [/\bmy (?:colleague|coworker|co-worker)\b/i, 'colleague'],
  [/\bmy doctor\b/i, 'doctor'],
  [/\bmy mentor\b/i, 'mentor'],
];

// ---------------------------------------------------------------------------
// Base confidence scores
// ---------------------------------------------------------------------------

const BASE_CONFIDENCE: Record<AnchorType, number> = {
  goal: 0.75,
  preference: 0.70,
  date_event: 0.80,
  person: 0.65,
  deployment_plan: 0.80,
  financial_commitment: 0.80,
  project_stage: 0.70,
  identity: 0.90,
  business: 0.75,
  context: 0.70,
};

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function tryGoal(message: string): { template: AnchorTemplate; slot: AnchorSlot } | null {
  if (!GOAL_RE.test(message)) return null;
  for (const [re, slot] of GOAL_SLOT_MAP) {
    if (re.test(message)) {
      return { template: 'goal_active', slot };
    }
  }
  return null;
}

function tryPreference(message: string): { template: AnchorTemplate; slot: AnchorSlot } | null {
  if (PREF_NEGATIVE_RE.test(message)) {
    return { template: 'preference_negative', slot: 'general_negative' };
  }
  if (PREF_POSITIVE_RE.test(message)) {
    return { template: 'preference_positive', slot: 'general_positive' };
  }
  return null;
}

function tryDateEvent(message: string): { template: AnchorTemplate; slot: AnchorSlot } | null {
  if (!DATE_INDICATOR_RE.test(message)) return null;
  for (const [re, slot] of DATE_EVENT_SLOTS) {
    if (re.test(message)) {
      return { template: 'upcoming_event', slot };
    }
  }
  return null;
}

function tryPersonRole(message: string): { template: AnchorTemplate; slot: AnchorSlot } | null {
  for (const [re, slot] of PERSON_ROLE_MAP) {
    if (re.test(message)) {
      return { template: 'person_role', slot };
    }
  }
  return null;
}

function anchorTypeFromTemplate(template: AnchorTemplate): AnchorType {
  if (template === 'goal_active' || template === 'goal_completed' || template === 'goal_objective') return 'goal';
  if (template === 'preference_positive' || template === 'preference_negative') return 'preference';
  if (template === 'person_role') return 'person';
  if (template === 'deployment_plan') return 'deployment_plan';
  if (template === 'financial_commitment') return 'financial_commitment';
  if (template === 'project_stage') return 'project_stage';
  if (template === 'identity_user_name') return 'identity';
  return 'date_event';
}

// ---------------------------------------------------------------------------
// Identity: user_name (onboarding — captured once, reused across sessions)
// ---------------------------------------------------------------------------

// Explicit phrases ("my name is Nikhil") OR a bare name response (just "Nikhil").
const USER_NAME_RE = /\b(my name is|call me|i am|i'm|this is)\s+([A-Za-z]{2,20})\b/i;

// Bare name: entire message is 1–2 words, each starting uppercase, no digits/punctuation.
// Matches "Nikhil", "Nikhil J", but not "hello", "yes", "ok", "no", "hey", "hi", "thanks".
const BARE_NAME_RE = /^([A-Z][a-z]{1,19})(?:\s+[A-Z][a-z]{1,19})?$/;
const NOT_A_NAME = new Set([
  'yes', 'no', 'ok', 'okay', 'hi', 'hey', 'hello', 'thanks', 'sure', 'bye',
  'maybe', 'please', 'sorry', 'right', 'wrong', 'true', 'false', 'fine',
  'good', 'great', 'cool', 'nice', 'test', 'testing', 'done', 'help',
  // greetings & slang
  'yo', 'sup', 'bruh', 'bro', 'dude', 'mate', 'fam', 'ayo', 'heya', 'hiya',
  'howdy', 'wassup', 'whatup', 'ciao',
  // filler & reactions
  'yup', 'yep', 'ya', 'nah', 'nope', 'hm', 'hmm', 'ah', 'oh', 'ugh',
  'lol', 'haha', 'damn', 'shit', 'fuck', 'wow', 'whoa',
  // common question words (prevent "What" / "How" as bare name)
  'what', 'whats', 'how', 'why', 'who', 'when', 'where',
  // time greetings
  'morning', 'evening', 'night', 'afternoon',
  // common English words that get capitalized and misidentified as names
  'not', 'never', 'nothing', 'none', 'just', 'only', 'also', 'very',
  'well', 'much', 'more', 'less', 'most', 'some', 'any', 'all',
  'going', 'preparing', 'working', 'looking', 'trying', 'waiting',
  'thinking', 'feeling', 'getting', 'making', 'coming', 'leaving',
  'starting', 'running', 'talking', 'asking', 'telling', 'reading',
  'actually', 'really', 'basically', 'honestly', 'literally', 'totally',
  'like', 'love', 'hate', 'want', 'need', 'know', 'think', 'feel',
  'today', 'tomorrow', 'yesterday', 'always', 'sometimes', 'everything',
  'something', 'anything', 'everyone', 'someone', 'anyone', 'nobody',
]);

function tryUserName(message: string): string | null {
  const trimmed = message.trim();

  const m = trimmed.match(USER_NAME_RE);
  if (m && m[2]) {
    const name = m[2].trim();
    if (name.length >= 2) return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  const bare = trimmed.match(BARE_NAME_RE);
  if (bare && !NOT_A_NAME.has(trimmed.toLowerCase())) {
    return bare[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractFactAnchor(
  userId: string,
  message: string,
  sessionId: string,
  emotionVec: number[],
  timestamp: number,
  sessionAnchorCount: number,
): FactAnchor | null {
  if (sessionAnchorCount >= SESSION_ANCHOR_CAP) return null;

  const userName = tryUserName(message);
  if (userName) {
    const type: AnchorType = 'identity';
    const slot: AnchorSlot = 'user_name';
    const baseConfidence = BASE_CONFIDENCE[type];
    const status = baseConfidence < QUARANTINE_THRESHOLD ? 'quarantined' : 'confirmed';
    const anchor: FactAnchor = {
      anchorId: `${userId}-${sessionId}-${timestamp}-user_name`,
      userId,
      type,
      summary: { template: 'identity_user_name', slot },
      value: userName,
      salience: baseConfidence,
      extractionConfidence: baseConfidence,
      sourceType: 'explicit',
      priority: 2,
      status,
      emotionVecAtCreation: [...emotionVec],
      sessionId,
      createdAt: timestamp,
      reinforceCount: 1,
      appearsInSessions: 1,
      lastSeenSessionId: sessionId,
    };
    return anchor;
  }

  const structured = extractStructuredFact(message);
  // Use structured extraction unless it's goal/objective and legacy tryGoal would give a more specific slot
  if (structured && !(structured.type === 'goal' && structured.slot === 'objective' && tryGoal(message))) {
      const template: AnchorTemplate =
        structured.type === 'goal' ? 'goal_objective' : structured.type;
      const type = anchorTypeFromTemplate(template);
      const baseConfidence = BASE_CONFIDENCE[type];
      let confidence: number;
      let sourceType: AnchorSourceType;
      let priority: number;
      if (type === 'deployment_plan' && DEPLOYMENT_UPDATE_VERB_RE.test(message)) {
        confidence = 1.0;
        sourceType = 'update';
        priority = 3;
      } else if (type === 'deployment_plan') {
        confidence = 0.9;
        sourceType = 'explicit';
        priority = 2;
      } else {
        confidence = baseConfidence;
        sourceType = 'explicit';
        priority = 2;
      }
      if (confidence < MIN_CONFIDENCE) return null;
      const status = baseConfidence < QUARANTINE_THRESHOLD ? 'quarantined' : 'confirmed';
      const anchor: FactAnchor = {
        anchorId: `${userId}-${sessionId}-${timestamp}`,
        userId,
        type,
        summary: { template, slot: structured.slot as AnchorSlot },
        value: structured.value,
        salience: baseConfidence,
        extractionConfidence: baseConfidence,
        confidence,
        sourceType,
        priority,
        status,
        emotionVecAtCreation: [...emotionVec],
        sessionId,
        createdAt: timestamp,
        reinforceCount: 1,
        appearsInSessions: 1,
        lastSeenSessionId: sessionId,
      };
      return anchor;
  }

  const hasRememberIntent = REMEMBER_INTENT_RE.test(message);

  let match: { template: AnchorTemplate; slot: AnchorSlot } | null = null;

  match = tryDateEvent(message);
  if (!match) match = tryGoal(message);
  if (!match) match = tryPreference(message);
  if (!match && hasRememberIntent) match = tryPersonRole(message);
  if (!match && !hasRememberIntent) {
    const personMatch = tryPersonRole(message);
    if (personMatch) {
      match = personMatch;
    }
  }

  if (!match) return null;

  const type = anchorTypeFromTemplate(match.template);
  const baseConfidence = BASE_CONFIDENCE[type];
  if (baseConfidence < MIN_CONFIDENCE) return null;
  const status = baseConfidence < QUARANTINE_THRESHOLD ? 'quarantined' : 'confirmed';

  const anchor: FactAnchor = {
    anchorId: `${userId}-${sessionId}-${timestamp}`,
    userId,
    type,
    summary: {
      template: match.template,
      slot: match.slot,
    },
    salience: baseConfidence,
    extractionConfidence: baseConfidence,
    confidence: baseConfidence,
    sourceType: 'explicit',
    priority: 2,
    status,
    emotionVecAtCreation: [...emotionVec],
    sessionId,
    createdAt: timestamp,
    reinforceCount: 1,
    appearsInSessions: 1,
    lastSeenSessionId: sessionId,
  };

  if (type === 'person') {
    anchor.entityRole = match.slot;
  }

  return anchor;
}
