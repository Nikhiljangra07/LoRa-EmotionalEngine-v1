/**
 * Build a lightweight EmotionalFingerprint from data already available
 * in the request flow — no extra LLM call needed.
 *
 * Maps EngineOrchestrator signals → EmotionalFingerprint for retrieval.
 */

import type { EmotionalFingerprint } from '../types/session-fingerprint';
import type { EkmanEmotion, Undertone, ContextCategory, RelationalTone } from '../types/vocabularies';

export interface CurrentSignals {
  /** EIV value for this turn (0–1) */
  eiv: number;
  /** Dominant emotion from appraisal bridge or analyzers */
  ekmanDominant?: string;
  /** Arousal level (0–1) */
  arousal?: number;
  /** Valence (-1 to 1) */
  valence?: number;
  /** User's message text (for context category heuristic) */
  userMessage: string;
  /** Session turn count (for relational tone heuristic) */
  turnCount: number;
}

// ── Ekman mapping ──

const VALID_EKMAN: Set<string> = new Set([
  'joy', 'anger', 'fear', 'sadness', 'disgust', 'surprise',
]);

function mapEkman(dominant?: string, valence?: number): EkmanEmotion {
  if (dominant && VALID_EKMAN.has(dominant)) {
    return dominant as EkmanEmotion;
  }
  // Fallback from valence
  if (valence !== undefined) {
    if (valence < -0.3) return 'sadness';
    if (valence > 0.3) return 'joy';
  }
  return 'sadness'; // Conservative default
}

// ── Undertone mapping ──

function mapUndertones(
  eiv: number,
  valence?: number,
  arousal?: number,
): [Undertone] | [Undertone, Undertone] {
  const undertones: Undertone[] = [];

  // Intensity-based
  if (eiv > 0.7) undertones.push('urgency');
  else if (eiv < 0.3) undertones.push('resignation');

  // Valence-based
  if (valence !== undefined) {
    if (valence < -0.5) undertones.push('dread');
    else if (valence < -0.2) undertones.push('tension');
    else if (valence > 0.3) undertones.push('hope');
  }

  // Arousal-based
  if (arousal !== undefined && arousal > 0.7 && !undertones.includes('urgency')) {
    undertones.push('tension');
  }

  // Ensure at least 1, max 2
  if (undertones.length === 0) undertones.push('tension');
  return undertones.slice(0, 2) as [Undertone] | [Undertone, Undertone];
}

// ── Context category heuristic ──

const CONTEXT_SIGNALS: Record<ContextCategory, string[]> = {
  relationship: ['boyfriend', 'girlfriend', 'breakup', 'love', 'partner', 'marriage', 'husband', 'wife', 'dating', 'ex'],
  career: ['job', 'salary', 'work', 'boss', 'career', 'promotion', 'resign', 'interview', 'company'],
  family: ['mother', 'father', 'parent', 'sister', 'brother', 'family', 'mom', 'dad', 'child', 'kid'],
  health: ['doctor', 'medicine', 'anxiety', 'depression', 'therapy', 'medication', 'panic', 'sleep', 'mental'],
  finance: ['money', 'debt', 'invest', 'loan', 'budget', 'savings', 'rent', 'business', 'profit'],
  identity: ['who am i', 'purpose', 'meaning', 'lost', 'confused', 'identity', 'faith', 'believe'],
  social: ['friend', 'people', 'social', 'lonely', 'group', 'community'],
  education: ['study', 'exam', 'college', 'school', 'degree', 'course', 'learn'],
  creative: ['art', 'music', 'write', 'create', 'design', 'project'],
  existential: ['life', 'death', 'why', 'point', 'universe', 'god'],
};

function mapContextCategory(message: string): ContextCategory {
  const lower = message.toLowerCase();
  let best: ContextCategory = 'relationship'; // default
  let bestCount = 0;

  for (const [category, signals] of Object.entries(CONTEXT_SIGNALS)) {
    const count = signals.filter(s => lower.includes(s)).length;
    if (count > bestCount) {
      bestCount = count;
      best = category as ContextCategory;
    }
  }

  return best;
}

// ── Relational tone heuristic ──

function mapRelationalTone(turnCount: number, eiv: number): RelationalTone {
  if (turnCount <= 2) return 'open'; // New session, user is sharing
  if (eiv > 0.7) return 'confrontational';
  if (eiv < 0.2) return 'avoidant';
  return 'collaborative';
}

// ── Main builder ──

/**
 * Build an EmotionalFingerprint from current request signals.
 * This is a lightweight heuristic — no LLM call, runs in <1ms.
 */
export function buildCurrentFingerprint(signals: CurrentSignals): EmotionalFingerprint {
  return {
    primary: mapEkman(signals.ekmanDominant, signals.valence),
    undertones: mapUndertones(signals.eiv, signals.valence, signals.arousal),
    intensity: signals.eiv,
    contextCategory: mapContextCategory(signals.userMessage),
    relationalTone: mapRelationalTone(signals.turnCount, signals.eiv),
  };
}
