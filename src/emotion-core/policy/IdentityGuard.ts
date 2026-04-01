// src/emotion-core/policy/IdentityGuard.ts

import { increment as opIncrement } from '../../server/analytics/operationalCounters';

// ── Forbidden opener patterns ────────────────────────────────────────

const THERAPIST_OPENERS: RegExp[] = [
  /^that must feel\b/i,
  /^that must be (really |very )?(painful|hard|difficult|tough|frustrating|overwhelming)\b/i,
  /^that sounds (really |very )?(difficult|hard|painful|tough|frustrating|overwhelming)\b/i,
  /^i understand how\b/i,
  /^it sounds like you'?re feeling\b/i,
  /^it sounds like you'?re\b/i,
  /^i can hold space for that\b/i,
  /^i'?m here with you\b/i,
  /^i hear you\b/i,
  /^i'?m so sorry you'?re\b/i,
  /^it'?s understandable that\b/i,
  /^it makes sense that you'?re\b/i,
  /^that must be difficult\b/i,
  /^that must be frustrating\b/i,
  /^i'?m sorry to hear\b/i,
  /^i can see where you'?re coming from\b/i,
  /^that'?s completely (valid|normal|understandable)\b/i,
  /^your feelings are\b/i,
  /^i want you to know\b/i,
  /^take your time\b/i,
  /^let'?s take a step back\b/i,
  /^let'?s take this one step\b/i,
];

const NARRATIVE_OPENERS: RegExp[] = [
  /^a quiet\b/i,
  /^sometimes in life\b/i,
  /^imagine\b/i,
  /^something sits beneath\b/i,
  /^there'?s something here\b/i,
  /^this moment carries\b/i,
  /^a gentle pause\b/i,
  /^when something like this happens\b/i,
  /^situations like this\b/i,
  /^in moments like these\b/i,
  /^there are times\b/i,
];

const ALL_OPENER_PATTERNS = [...THERAPIST_OPENERS, ...NARRATIVE_OPENERS];

// ── Semantic detection word lists ────────────────────────────────────

const EMOTIONAL_WORDS =
  /\b(feel|feeling|feelings|emotions|emotional|emotionally|painful|hurt|hurting|difficult)\b/i;

const FACTUAL_NOUNS =
  /\b(demo|product|system|process|strategy|pitch|market|decision|data|code|team|budget|timeline|project|client|meeting|deadline|presentation|analysis|approach|outcome|result|plan|model|structure|framework|part|aspect|step|phase|component|factor|reason|cause)\b/i;

const EMOTIONAL_QUESTION_WORDS = /\b(feel|feeling|feelings|emotion|emotions|emotionally)\b/i;

const SELF_REFERENTIAL = /^I'?m\b|^I am\b/i;

const SEMANTIC_REPLACEMENT = 'The situation suggests a breakdown in the process.';

// ── Helpers ──────────────────────────────────────────────────────────

function matchesForbiddenOpener(text: string): boolean {
  return ALL_OPENER_PATTERNS.some((p) => p.test(text));
}

function stripFirstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]*[.!?\n]\s*/);
  if (match) return text.slice(match[0].length).trimStart();
  return '';
}

function extractFirstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]*[.!?\n]?/);
  return match ? match[0] : text;
}

function isEmotionalFirstFraming(sentence: string): boolean {
  if (SELF_REFERENTIAL.test(sentence)) return false;
  return EMOTIONAL_WORDS.test(sentence) && !FACTUAL_NOUNS.test(sentence);
}

function replaceFirstSentence(text: string, replacement: string): string {
  const match = text.match(/^[^.!?\n]*[.!?\n]\s*/);
  if (match) {
    const rest = text.slice(match[0].length).trimStart();
    return rest.length > 0 ? replacement + ' ' + rest : replacement;
  }
  return replacement;
}

function rewriteEmotionalQuestions(text: string): string {
  return text.replace(/[^.!?\n]*\?/g, (match) => {
    if (EMOTIONAL_QUESTION_WORDS.test(match)) {
      const leading = match.match(/^\s*/)?.[0] ?? '';
      return leading + 'What part of the situation caused that outcome?';
    }
    return match;
  });
}

// ── Main guard ───────────────────────────────────────────────────────

/**
 * Post-generation identity guard.
 *
 * Pipeline (max 2 passes):
 *   1. Strip forbidden openers (therapist + narrative phrases)
 *   2. Semantic therapist detection (emotional-first framing without factual nouns)
 *   3. Emotional question rewrite
 *
 * No LLM calls. Regex and sentence parsing only.
 */
export function enforceIdentity(text: string): string {
  let result = text.trimStart();
  if (result.length === 0) return result;

  for (let pass = 0; pass < 2; pass++) {
    const before = result;

    // 1. Forbidden opener strip
    if (matchesForbiddenOpener(result)) {
      const stripped = stripFirstSentence(result);
      if (stripped.length > 0) {
        result = stripped;
        opIncrement('identity_opener_stripped');
      }
    }

    // 2. Semantic therapist detection — only if step 1 didn't already change the text
    if (result === before) {
      const firstSentence = extractFirstSentence(result);
      if (firstSentence.length > 0 && isEmotionalFirstFraming(firstSentence)) {
        result = replaceFirstSentence(result, SEMANTIC_REPLACEMENT);
        opIncrement('identity_semantic_rewrite');
      }
    }

    // 3. Emotional question rewrite (runs every pass)
    const beforeQuestionRewrite = result;
    result = rewriteEmotionalQuestions(result);
    if (result !== beforeQuestionRewrite) opIncrement('identity_question_rewrite');

    if (result === before) break;
  }

  return result;
}
