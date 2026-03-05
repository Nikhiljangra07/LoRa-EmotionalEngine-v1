// src/emotion-core/policy/IdentityGuard.ts

const THERAPIST_OPENERS: RegExp[] = [
  /^that must feel\b/i,
  /^that must be (really |very )?(painful|hard|difficult|tough|frustrating|overwhelming)\b/i,
  /^that sounds (really |very )?(difficult|hard|painful|tough|frustrating|overwhelming)\b/i,
  /^i understand how\b/i,
  /^it sounds like you'?re feeling\b/i,
  /^i can hold space for that\b/i,
  /^i'?m here with you\b/i,
  /^i hear you,? and\b/i,
  /^i'?m so sorry you'?re\b/i,
];

const NARRATIVE_OPENERS: RegExp[] = [
  /^a quiet\b/i,
  /^sometimes in life\b/i,
  /^imagine\b/i,
  /^something sits beneath\b/i,
  /^there'?s something here\b/i,
  /^this moment carries\b/i,
  /^a gentle pause\b/i,
];

const ALL_PATTERNS = [...THERAPIST_OPENERS, ...NARRATIVE_OPENERS];

function matchesForbiddenOpener(text: string): boolean {
  return ALL_PATTERNS.some((p) => p.test(text));
}

function stripFirstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]*[.!?\n]\s*/);
  if (match) return text.slice(match[0].length).trimStart();
  return '';
}

/**
 * Post-generation identity guard.
 * Strips therapist-style and narrative filler openings from LLM output.
 * Runs up to 2 passes to handle consecutive offending sentences.
 */
export function enforceIdentity(text: string): string {
  let result = text.trimStart();

  for (let pass = 0; pass < 2; pass++) {
    if (!matchesForbiddenOpener(result)) break;
    const stripped = stripFirstSentence(result);
    if (stripped.length === 0) break;
    result = stripped;
  }

  return result;
}
