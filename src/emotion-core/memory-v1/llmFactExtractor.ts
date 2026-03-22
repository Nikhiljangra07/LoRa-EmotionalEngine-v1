import Anthropic from '@anthropic-ai/sdk';
import type {
  FactAnchor,
  AnchorType,
  AnchorSlot,
  AnchorTemplate,
} from './factAnchorTypes';
import { QUARANTINE_THRESHOLD } from './factAnchorTypes';

const HAIKU_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 200;
const TIMEOUT_MS = 5000;

const EXTRACTION_PROMPT = `Extract key facts from the user message as a JSON array. Each fact: {"type":"...","slot":"...","value":"..."}.

Categories and slots:
- business: business_type, location_type, channel, industry, challenge
- context: occupation, situation, decision, topic
- goal: objective, career_change, learning
- person: friend, family_member, partner, manager, colleague
- preference: general_positive, general_negative
- identity: user_name

Rules:
- Extract ONLY concrete facts, not emotions or opinions
- value must be a short English label (2-5 words max), even if the message is in another language
- user_name: ONLY extract when the user explicitly introduces themselves (e.g. "I'm John", "my name is X", "call me Y"). Do NOT extract random nouns, adjectives, genres, or common words as user_name.
- Do NOT extract the AI assistant's words or responses as facts — only extract from the USER's own statements.
- Return [] if nothing factual
- Respond with ONLY the JSON array, nothing else`;

interface LLMFact {
  type: string;
  slot: string;
  value: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set([
  'business', 'context', 'goal', 'person', 'preference',
  'date_event', 'deployment_plan', 'financial_commitment',
  'project_stage', 'identity',
]);

const VALID_SLOTS: Readonly<Record<string, ReadonlySet<string>>> = {
  business: new Set(['business_type', 'location_type', 'channel', 'industry', 'challenge']),
  context: new Set(['occupation', 'situation', 'decision', 'topic']),
  goal: new Set(['objective', 'exercise', 'diet', 'career_change', 'learning', 'hobby']),
  person: new Set(['friend', 'therapist', 'family_member', 'manager', 'partner', 'colleague', 'doctor', 'mentor']),
  preference: new Set(['general_positive', 'general_negative']),
  identity: new Set(['user_name']),
  date_event: new Set(['job_interview', 'exam', 'meeting', 'birthday', 'appointment', 'wedding', 'travel', 'deadline', 'therapy_session', 'graduation']),
  deployment_plan: new Set(['launch_date']),
  financial_commitment: new Set(['money_amount']),
  project_stage: new Set(['stage']),
};

function templateForType(type: string): AnchorTemplate {
  switch (type) {
    case 'business': return 'business_context';
    case 'context': return 'general_context';
    case 'goal': return 'goal_objective';
    case 'person': return 'person_role';
    case 'preference': return 'preference_positive';
    case 'identity': return 'identity_user_name';
    case 'date_event': return 'upcoming_event';
    case 'deployment_plan': return 'deployment_plan';
    case 'financial_commitment': return 'financial_commitment';
    case 'project_stage': return 'project_stage';
    default: return 'general_context';
  }
}

const COMMON_WORDS: ReadonlySet<string> = new Set([
  'hello', 'hi', 'hey', 'hlo', 'hloo', 'yes', 'no', 'ok', 'okay', 'sure',
  'thanks', 'thank', 'bye', 'good', 'bad', 'great', 'nice', 'fine', 'cool',
  'functional', 'comedy', 'drama', 'horror', 'action', 'romance', 'thriller',
  'student', 'teacher', 'doctor', 'engineer', 'manager', 'worker', 'user',
  'noted', 'understood', 'clear', 'ready', 'done', 'start', 'stop', 'help',
  'question', 'answer', 'problem', 'solution', 'topic', 'subject', 'point',
  // greetings & slang
  'yo', 'sup', 'bruh', 'bro', 'dude', 'mate', 'fam', 'ayo', 'heya', 'hiya',
  'howdy', 'wassup', 'whatup', 'ciao',
  // filler & reactions
  'yup', 'yep', 'ya', 'nah', 'nope', 'hm', 'hmm', 'ah', 'oh', 'ugh',
  'lol', 'haha', 'damn', 'shit', 'fuck', 'fucked', 'fucking', 'wow', 'whoa',
  // common question words
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

function isPlausibleName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 30) return false;
  if (trimmed.split(/\s+/).length > 4) return false;
  if (COMMON_WORDS.has(trimmed.toLowerCase())) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('No API key');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Language-agnostic fact extraction via Claude Haiku.
 * Returns structured FactAnchor[] — no raw transcript is stored.
 * Fails silently on timeout/error, returning [].
 */
export async function extractFactsViaLLM(
  userId: string,
  message: string,
  sessionId: string,
  emotionVec: number[],
  timestamp: number,
): Promise<FactAnchor[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await getClient().messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: EXTRACTION_PROMPT,
        messages: [{ role: 'user', content: message }],
      },
      { signal: controller.signal },
    );

    clearTimeout(timer);

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    if (!text || text === '[]') return [];

    let facts: LLMFact[];
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      facts = JSON.parse(cleaned);
    } catch {
      return [];
    }

    if (!Array.isArray(facts)) return [];

    const anchors: FactAnchor[] = [];
    for (const f of facts) {
      if (!f.type || !f.slot || !f.value) continue;
      if (typeof f.value !== 'string' || f.value.length > 80) continue;
      if (!VALID_TYPES.has(f.type)) continue;
      if (!VALID_SLOTS[f.type]?.has(f.slot)) continue;
      if (f.slot === 'user_name' && !isPlausibleName(f.value)) continue;

      const baseConfidence = 0.75;
      const status = baseConfidence < QUARANTINE_THRESHOLD ? 'quarantined' : 'confirmed';

      anchors.push({
        anchorId: `${userId}-${sessionId}-${timestamp}-llm-${f.slot}`,
        userId,
        type: f.type as AnchorType,
        summary: { template: templateForType(f.type), slot: f.slot as AnchorSlot },
        value: f.value.slice(0, 80),
        salience: baseConfidence,
        extractionConfidence: baseConfidence,
        confidence: baseConfidence,
        sourceType: 'inferred',
        priority: 1,
        status,
        emotionVecAtCreation: [...emotionVec],
        sessionId,
        createdAt: timestamp,
        reinforceCount: 1,
        appearsInSessions: 1,
        lastSeenSessionId: sessionId,
      });
    }

    if (anchors.length > 0) {
      console.log('[LoRa::LLMExtraction] extracted', { userId, count: anchors.length, slots: anchors.map(a => a.summary.slot) });
    }

    return anchors;
  } catch {
    clearTimeout(timer);
    return [];
  }
}
