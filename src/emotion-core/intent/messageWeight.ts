/**
 * Message weight classifier — adaptive routing primitive.
 *
 * Classifies a user message into one of three weight classes that drive
 * model selection (Haiku vs Sonnet) for latency optimisation:
 *
 *   trivial      — greetings, acks, thanks. Already handled by the
 *                  perspective-skip path; can also route to Haiku safely.
 *   lightweight  — factual / educational / technical queries with no
 *                  emotional or decision content. Safe for Haiku.
 *   substantive  — anything emotional, decision-laden, multi-clause, or
 *                  uncertain. Stays on Sonnet (default — preserve quality).
 *
 * Bias:
 *   False negatives (substantive → Haiku) cost quality, so we ONLY return
 *   `lightweight` when we have positive evidence AND zero negative cues.
 *   Anything ambiguous defaults to `substantive` (no quality regression).
 *
 * This file is pure regex — no LLM, no I/O, < 1ms per call.
 */

export type MessageWeight = 'trivial' | 'lightweight' | 'substantive';

export interface MessageWeightClassification {
  weight: MessageWeight;
  /** Why we landed here — used for telemetry / debugging only. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Trivial detector — same shape as EngineOrchestrator.isTrivialMessage so the
// two paths stay aligned. Kept here to avoid a circular import.
// ---------------------------------------------------------------------------

const TRIVIAL_GREETINGS =
  /^(hi|hey|hello|hii|hiii|hlo|hnji|yo|sup|howdy|good\s*(morning|evening|afternoon|night)|namaste|hola)\b/;
const TRIVIAL_THANKS =
  /^(thanks?|thank\s*you|thx|ty|shukriya|dhanyavaad|great|awesome|perfect|cool|nice|good|ok|okay|fine|alright|got\s*it|understood|makes?\s*sense)\b/;
const TRIVIAL_AGREEMENT =
  /^(yes|yeah|yep|yup|sure|haan|ha|hmm|hm|mm|right|true|correct|exactly|agreed|absolutely)\b/;
const TRIVIAL_FAREWELL =
  /^(bye|goodbye|good\s*bye|see\s*you|take\s*care|later|gn|good\s*night)\b/;
const TRIVIAL_FILLER = /^(lol|lmao|haha|hehe|ha+|wow|oh|ooh|ahh?|hmm+)\s*$/;
const SUBSTANTIVE_SHORT_WORDS =
  /^(explain|elaborate|deeper|more|expand|continue|analyse|analyze|why|how)$/;

function isTrivial(normalized: string): boolean {
  const t = normalized.trim();
  if (
    t.length <= 8 &&
    !t.includes('?') &&
    !t.includes('why') &&
    !t.includes('how') &&
    !SUBSTANTIVE_SHORT_WORDS.test(t)
  ) {
    return true;
  }
  if (TRIVIAL_GREETINGS.test(t)) return true;
  if (TRIVIAL_THANKS.test(t) && t.length < 40) return true;
  if (TRIVIAL_AGREEMENT.test(t) && t.length < 25) return true;
  if (TRIVIAL_FAREWELL.test(t)) return true;
  if (TRIVIAL_FILLER.test(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Negative cues — if ANY of these match, force `substantive`.
//
// These are the patterns where Sonnet's depth genuinely matters: emotional
// content, identity / self-reflection, decisions with stakes, relationship
// or life-direction questions. Routing these to Haiku would be a quality
// regression.
// ---------------------------------------------------------------------------

const EMOTIONAL_VOCAB =
  /\b(feel(?:ing|s)?|felt|sad|anxious|anxiety|worried|worry|scared|afraid|angry|furious|frustrated|stressed|overwhelmed|depressed|lonely|hopeless|empty|numb|hurt|hurting|broken|guilty|ashamed|shame|stuck|lost|exhausted|burnt\s*out|burnout|crying|panic|panicked|miserable|devastated|grieving|grief|trauma|triggered|insecure)\b/i;

const DECISION_VOCAB =
  /\b(should\s+i|what\s+should|do\s+i\s+(?:need|have)|i'?m\s+(?:thinking|considering|planning|debating|torn|stuck|unsure)|i\s+(?:want|need|wish)\s+to|i\s+don'?t\s+know\s+(?:what|if|whether)|help\s+me\s+decide|decide|choosing|choice|dilemma|on\s+the\s+fence|two\s+minds)\b/i;

const RELATIONSHIP_VOCAB =
  /\b(relationship|girlfriend|boyfriend|partner|wife|husband|spouse|ex|breakup|broke\s+up|cheated|divorce|crush|dating|family|mother|father|mom|dad|parents?|brother|sister|friend(?:ship)?|coworker|boss|manager)\b/i;

const SELF_REFLECTION_VOCAB =
  /\b(my\s+life|my\s+future|my\s+career|my\s+purpose|my\s+goal|find\s+myself|who\s+am\s+i|i\s+am\s+(?:not|just|a|an)|i'?ve\s+been|always\s+(?:been|feel)|never\s+(?:been|feel|felt))\b/i;

// ---------------------------------------------------------------------------
// Positive cues — patterns that mark a message as factual / educational /
// technical with no personal stakes.
// ---------------------------------------------------------------------------

const FACTUAL_OPENERS =
  /^(what\s+(?:is|are|does|do)\b|how\s+(?:does|do)\s+(?:a\b|an\b|the\b|you\b|\w+\s+(?:work|works)\b)|define\s+|describe\s+(?:the|a|an)\s+|explain\s+(?:the|how|what)\b|when\s+(?:did|was|were)\b|where\s+(?:is|are|was|were)\b|who\s+(?:is|was|were|invented|created)\b|tell\s+me\s+about\s+|give\s+me\s+(?:an?\s+)?(?:example|examples|list|recipe|definition|overview)\b|list\s+|name\s+(?:a|an|the|some|five|three|two|ten)\b|translate\s+|convert\s+|calculate\s+|compute\s+|spell\s+|pronounce\s+|summarize\s+|summarise\s+)/i;

const TECHNICAL_HINTS =
  /\b(function|variable|class|method|loop|array|string|integer|boolean|api|http|json|sql|regex|algorithm|recursion|database|server|client|kernel|thread|stack|heap|byte|bit|cpu|gpu|ram|tcp|udp|dns|css|html|javascript|typescript|python|rust|golang|java|c\+\+|node\.?js|react|linux|docker|kubernetes|git|github|npm|webpack)\b/i;

const CODE_BLOCK = /```|`[a-zA-Z_][a-zA-Z0-9_]*`/;

const HARD_LENGTH_LIMIT = 280;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a user message into a routing weight class.
 *
 * Pure function. Bias toward `substantive` — the safe default. Only returns
 * `lightweight` when we have positive cues AND zero negative cues.
 */
export function classifyMessageWeight(
  rawText: string,
): MessageWeightClassification {
  const text = (rawText ?? '').trim();
  if (text.length === 0) {
    return { weight: 'substantive', reason: 'empty' };
  }

  const normalized = text.toLowerCase();

  if (isTrivial(normalized)) {
    return { weight: 'trivial', reason: 'trivial_pattern' };
  }

  // Length gate: long messages are almost always substantive (multi-clause,
  // explanation, or rant). Cheap early exit.
  if (text.length > HARD_LENGTH_LIMIT) {
    return { weight: 'substantive', reason: 'long_message' };
  }

  // Hard negatives — any one of these locks us to substantive.
  if (EMOTIONAL_VOCAB.test(text)) {
    return { weight: 'substantive', reason: 'emotional_vocab' };
  }
  if (DECISION_VOCAB.test(text)) {
    return { weight: 'substantive', reason: 'decision_vocab' };
  }
  if (RELATIONSHIP_VOCAB.test(text)) {
    return { weight: 'substantive', reason: 'relationship_vocab' };
  }
  if (SELF_REFLECTION_VOCAB.test(text)) {
    return { weight: 'substantive', reason: 'self_reflection' };
  }

  // Positive cues — at least one must match for lightweight routing.
  if (CODE_BLOCK.test(text)) {
    return { weight: 'lightweight', reason: 'code_block' };
  }
  if (FACTUAL_OPENERS.test(text)) {
    return { weight: 'lightweight', reason: 'factual_opener' };
  }
  if (TECHNICAL_HINTS.test(text) && text.length < 200) {
    return { weight: 'lightweight', reason: 'technical_short' };
  }

  // No positive evidence → default to substantive. Quality first.
  return { weight: 'substantive', reason: 'no_positive_cues' };
}
