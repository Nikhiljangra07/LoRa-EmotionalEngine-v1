/**
 * Text-level signal extraction for the adaptive router.
 *
 * All signals are regex-based. No LLM calls, no session state.
 * Designed to run in <1ms on any reasonable message length.
 *
 * Patterns are organised as small, category-scoped regexes unioned by
 * predicate functions. Adding a sub-category does not risk breaking siblings.
 *
 * This module merges two lineages:
 *   1. Bench iter_001–008: life-stakes, crisis, medical, negated-wellbeing,
 *      factual-shell guard, EIV, Hinglish patterns, explicit deep/quick,
 *      session openers, continuation cues.
 *   2. v1 messageWeight.ts (historical): technical hints, code blocks,
 *      relationship vocabulary, self-reflection vocabulary. The v1 module
 *      was deleted in Phase 3; its coverage lives here.
 */

import type { Signals } from '../types';
import { computeEIV, EIV_HIGH_THRESHOLD } from './eiv';

// ---------------------------------------------------------------------------
// Trivial — whole-message anchored, no analytical weight
// ---------------------------------------------------------------------------

const TRIVIAL_WHOLE_MESSAGE =
  /^(hey|hi|hello|yo|sup|hola|howdy|good\s*(morning|afternoon|evening|night)|namaste|namaskar|salaam|bye|goodbye|see\s*(ya|you)|farewell|ttyl|later|cya|thanks?|thank\s*you|ty|thx|ok|okay|k|got\s*it|cool|nice|sure|yes|yeah|yep|no|nope|nah|lol|haha|hmm|mhm|oh|right|understood|makes\s*sense|appreciated|appreciate\s*it|continue|go\s*on|keep\s*going|👍|🙏)[!.?\s]*$/i;

// ---------------------------------------------------------------------------
// Life-stakes — split into sub-categories for readability
// ---------------------------------------------------------------------------

/** Explicit decision constructs about relationships / life direction. */
const LIFE_STAKES_DECISION =
  /\bshould\s+i\s+(leave|quit|break\s*up|end\s*it|stay|go|divorce|move\s*out|tell\s+(him|her|them|my|anyone))\b/i;

/**
 * Uncertainty about what to do / how to handle a personal situation.
 * Broadened "how to tell" → "how to (tell|reach|approach|bring up|talk to|handle|deal with|fix)".
 */
const LIFE_STAKES_UNCERTAINTY =
  /\b(i\s+don'?t\s+know\s+(what\s+to\s+do|how\s+to\s+(tell|reach|approach|bring\s+up|talk\s+to|handle|deal\s+with|fix|face)|whether\s+to|if\s+i\s+should)|not\s+sure\s+(if|whether|that|i\s+(want|do|can|will|should)))\b/i;

/** Contemplating a major life change. */
const LIFE_STAKES_CONTEMPLATION =
  /\b(thinking\s+about\s+(leaving|quitting|divorce|ending|ending\s+it)|considering\s+(leaving|quitting|divorce|ending|reaching\s+out))\b/i;

/**
 * Compulsive behavior the user can't stop (addiction, compulsion patterns).
 * Broadened "can't stop X" to include crying, replaying, shaking, worrying.
 */
const LIFE_STAKES_COMPULSION =
  /\b(can'?t\s+keep\s+(doing|living|going)|can'?t\s+stop\s+(drinking|eating|overeating|gambling|smoking|using|scrolling|ruminating|obsessing|checking|crying|replaying|shaking|worrying|thinking\s+about\s+(him|her|it|them|this|that|the))|crying\s+(in\s+the\s+bathroom|at\s+work|every\s+(day|night)|myself\s+to\s+sleep)|replaying\s+(it|the\s+conversation|what\s+(he|she|they)\s+said))\b/i;

/**
 * Acute crisis / self-harm / breaking-point language.
 *
 * Safety-critical. Exported so the router can gate crisis_override on it
 * directly. The pattern uses `\w*` suffixes to catch inflections like
 * "suicidal" / "suicidality" / "self-harming" / "killing myself" that a
 * naive `\b...\b` alternation would miss.
 */
export const LIFE_STAKES_CRISIS =
  /\b(suicid\w*|self.?harm\w*|kill(ing)?\s+myself|end(ing)?\s+(it\s+all|my\s+(life|existence))|at\s+my\s+breaking\s+point|breaking\s+point|can'?t\s+take\s+(it|this)\s+anymore|can'?t\s+(do|handle|cope\s+with)\s+(it|this|anymore)|can'?t\s+anymore|(don'?t|do\s+not)\s+want\s+to\s+(live|be\s+here|exist|wake\s+up))/i;

/** Marriage / primary relationship collapse. */
const LIFE_STAKES_RELATIONSHIP =
  /\b(losing\s+my\s+marriage|my\s+marriage\s+is\s+(over|ending|falling)|getting\s+a\s+divorce)\b/i;

/**
 * Concealment from a primary attachment — strong substantive signal.
 * Broadened to include "can't tell anyone" / "no one knows" — concealment
 * without a specific named attachment.
 */
const LIFE_STAKES_CONCEALMENT =
  /\b((my\s+(wife|husband|partner|mom|dad|parents|family|boss|kids?)\s+doesn'?t\s+know)|(lying\s+to\s+my\s+(wife|husband|partner|mom|dad|parents|family|boss|kids?))|(hiding\s+(this|it)\s+from\s+my\s+(wife|husband|partner|mom|dad|parents|family))|(can'?t\s+tell\s+(anyone|anybody|any\s*one\s+else))|(no\s+one\s+knows))\b/i;

/**
 * Medical / diagnosis language. A cancer/bipolar/ADHD diagnosis (self or
 * family) is a life-weight event that doesn't fire on other life-stakes
 * patterns.
 */
const LIFE_STAKES_MEDICAL =
  /\b(just\s+got\s+diagnosed|newly\s+diagnosed|diagnosed\s+with|(might|may)\s+(have|be)\s+(cancer|bipolar|bpd|adhd|depression|anxiety\s+disorder|ocd|ptsd|autism|autistic)|i\s+(think|wonder|worry|suspect)\s+i\s+(might|may|could)\s+(have|be))\b/i;

/**
 * Negated wellbeing. "I'm not okay" / "something's wrong with me" are short
 * explicit self-reports of distress with no keyword match in emotional vocab.
 * Negation + self-reference is the whole signal.
 */
const LIFE_STAKES_NEGATED_WELLBEING =
  /\b(i'?m\s+not\s+(okay|ok|fine|alright|doing\s+(well|okay|ok|fine|great))|something'?s?\s+wrong\s+with\s+me|i\s+don'?t\s+feel\s+(like\s+myself|right|okay|ok|well))\b/i;

function hasLifeStakes(text: string): boolean {
  return (
    LIFE_STAKES_DECISION.test(text) ||
    LIFE_STAKES_UNCERTAINTY.test(text) ||
    LIFE_STAKES_CONTEMPLATION.test(text) ||
    LIFE_STAKES_COMPULSION.test(text) ||
    LIFE_STAKES_CRISIS.test(text) ||
    LIFE_STAKES_RELATIONSHIP.test(text) ||
    LIFE_STAKES_CONCEALMENT.test(text) ||
    LIFE_STAKES_MEDICAL.test(text) ||
    LIFE_STAKES_NEGATED_WELLBEING.test(text) ||
    HINGLISH_LIFE_STAKES_RE.test(text)
  );
}

// ---------------------------------------------------------------------------
// Decision vocabulary — explicit option-weighing + relational "should I"
// ---------------------------------------------------------------------------

const DECISION_VOCAB_EXPLICIT =
  /\b(choose\s+between|torn\s+between|pros?\s+and\s+cons?|whether\s+to|whether\s+or\s+not|which\s+one\s+should|stuck\s+between|decide\s+(between|whether|if)|deciding\s+(between|whether|if)|can'?t\s+decide|struggling\s+to\s+decide|trying\s+to\s+figure\s+out\s+(if|whether)|two\s+options|two\s+offers|two\s+paths|crossroads)\b/i;

/**
 * Relational "should I [verb]" — bounded verb list to avoid firing on
 * technical decision questions ("should I use Next.js?"). These verbs
 * imply interpersonal decisions, not product/tool choices.
 */
const DECISION_VOCAB_RELATIONAL =
  /\bshould\s+i\s+(respond|reply|text|call|answer|forgive|confront|tell\s+(him|her|them|my)|ask\s+(him|her|them|my)|say\s+(something|anything)|reach\s+out|apologize|apologise)\b/i;

function hasDecisionVocab(text: string): boolean {
  return DECISION_VOCAB_EXPLICIT.test(text) || DECISION_VOCAB_RELATIONAL.test(text);
}

// ---------------------------------------------------------------------------
// Emotional vocabulary — active distress / overwhelm language
// ---------------------------------------------------------------------------

const EMOTIONAL_VOCAB_RE =
  /\b(scared|terrified|anxious|anxiety|hopeless|stuck|trapped|overwhelmed|exhausted|burn(t|ed)?\s*out|depressed|lonely|abandoned|betrayed|broken|falling\s+apart|losing\s+my\s+mind|can'?t\s+sleep|can'?t\s+think|don'?t\s+know\s+who\s+i\s+am|hate\s+my\s+(life|job|self|body)|resent(ful)?|disconnected|numb|empty|ashamed|humiliat|heartbroken|dreading|can'?t\s+move\s+on|at\s+a\s+loss|panic\s+attacks?|panicking|gaslight(ing|ed)?|dissociat(ing|ed|e)|crying|tears?\s+(wont|won'?t|don'?t)\s+stop|drowning|suffocating|spiraling|unraveling|bathroom\s+(crying|tears))\b/i;

// ---------------------------------------------------------------------------
// Explicit user overrides
// ---------------------------------------------------------------------------

const EXPLICIT_DEEP_RE =
  /\b(go\s+deeper|unpack\s+(this|that|it)|full\s+picture|help\s+me\s+think\s+through|really\s+think\s+about|break\s+(this|it)\s+down|full\s+analysis|deep\s+dive|walk\s+me\s+through|dig\s+in(to)?)\b/i;

const EXPLICIT_QUICK_RE =
  /\b(quick\s+(question|answer|one)|short\s+answer|simple\s+(question|answer)|just\s+(tell|give)\s+me|in\s+(one|1|a)\s+(line|sentence|word)|brief(ly)?|tldr)\b/i;

// ---------------------------------------------------------------------------
// Factual-shell guard
// ---------------------------------------------------------------------------

const FACTUAL_SHELL_RE =
  /^(what'?s\s+|what\s+(is|are|does|do\s+\w+\s+mean)\s+|can\s+you\s+(explain|describe|define|tell\s+me\s+about)\s+|explain\s+|define\s+|describe\s+|tell\s+me\s+about\s+)/i;

const PERSONAL_PRONOUN_RE =
  /\b(i|i'?m|i'?ve|i'?ll|i'?d|me|my|mine|myself|we|we'?re|we'?ve|us|our|ours)\b/i;

// ---------------------------------------------------------------------------
// Trivial-shape sub-classification (for tier inheritance)
// ---------------------------------------------------------------------------

const SESSION_OPENER_RE =
  /^(hey|hi|hello|yo|sup|hola|howdy|hey\s+there|hi\s+there|hello\s+there|good\s*(morning|afternoon|evening|night)|namaste|namaskar|salaam)[!.?\s]*$/i;

const CONTINUATION_CUE_RE =
  /^(yeah|yea|yep|yup|and\??|and\s+then\??|go\s+on|continue|keep\s+going|tell\s+me\s+more|more\??|mhm|uh\s*huh|i\s+see)[!.?\s]*$/i;

// ---------------------------------------------------------------------------
// v1 PARITY PATTERNS — ported from messageWeight.ts to preserve coverage
// ---------------------------------------------------------------------------

/**
 * Relationship vocabulary. v1 promotes to substantive on any of these —
 * broad catch-all for relational content. "my boss" / "my ex" / "my mom"
 * etc. carry weight even without explicit distress vocabulary.
 *
 * Risk: over-promotes on trivial relationship-adjacent content like
 * "my wife made pasta tonight". Accepted per bias-deep — a substantive
 * reply to a dinner update is recoverable; a lightweight reply to
 * "my wife left me" is not.
 */
const RELATIONSHIP_VOCAB_RE =
  /\b(relationship|girlfriend|boyfriend|partner|wife|husband|spouse|ex|breakup|broke\s+up|cheated|divorce|crush|dating|family|mother|father|mom|dad|parents?|brother|sister|friend(?:ship)?|coworker|boss|manager)\b/i;

/**
 * Self-reflection vocabulary. Identity / future / purpose questions —
 * "my life", "my future", "who am i", "i've been" — are substantive
 * regardless of whether explicit distress vocabulary fires.
 */
const SELF_REFLECTION_VOCAB_RE =
  /\b(my\s+life|my\s+future|my\s+career|my\s+purpose|my\s+goal|find\s+myself|who\s+am\s+i|i\s+am\s+(?:not|just|a|an)|i'?ve\s+been|always\s+(?:been|feel)|never\s+(?:been|feel|felt))\b/i;

/**
 * Technical hints — programming / system-admin vocabulary. Short tech
 * questions with these tokens are lightweight (Haiku is fine).
 */
const TECHNICAL_HINTS_RE =
  /\b(function|variable|class|method|loop|array|string|integer|boolean|api|http|json|sql|regex|algorithm|recursion|database|server|client|kernel|thread|stack|heap|byte|bit|cpu|gpu|ram|tcp|udp|dns|css|html|javascript|typescript|python|rust|golang|java|c\+\+|node\.?js|react|linux|docker|kubernetes|git|github|npm|webpack)\b/i;

/** Code block presence (backticks). */
const CODE_BLOCK_RE = /```|`[a-zA-Z_][a-zA-Z0-9_]*`/;

// ---------------------------------------------------------------------------
// Hinglish patterns (Hindi-English code-switch, Roman transliteration)
// ---------------------------------------------------------------------------

const HINGLISH_LIFE_STAKES_RE =
  /\b(sam[aj]j?h?\s+nah[iy]?n?\s+aa\s*rah[ai]|kuch\s+sam[aj]j?h?\s+nah[iy]?n?|mujhe\s+kuch\s+sam[aj]j?h?\s+nah[iy]?n?|(main\s+)?kya\s+kar[uo]n?|chho?d\s+d[uo]n?|bardasht\s+nah[iy]?n?|khatam\s+ho\s+(gaya|raha)|dil\s+tutt?\s+gaya|nah[iy]?n?\s+seh\s+paa?\s+rah[ai]|rishte\s+se\s+thakk?|(bata|bol|kah|puch)[uo]n?\s+ya\s+nah[iy]?n?|maar\s+d[aa]l[uo]n?g[ai]|khud\s+ko\s+nuksaa?n|jeena\s+nah[iy]?n?\s+chaht[ai])\b/i;

const HINGLISH_EMOTIONAL_VOCAB_RE =
  /\b(pareshaa?n[i]?|dukhi|udas|akela|akel[ai]|thakk?\s+(gaya|chuk[ai]|rah[ai])|tutt?\s+(gaya|chuk[ai])|toot\s+(gaya|chuk[ai])|ghabraha?t|ghabra\s+rah[ai]|darr\s+(lagt[ai]|ho\s+rah[ai])|ghuss?a|hataash|niraash|ghut\s+rah[ai]|tension\s+(ho\s+rah[ai]|me\s+hu|hai)|neend\s+nah[iy]?n?\s+(aa\s*rah[ai]|aati)|ro\s+rah[ai]|ro\s+(rahi|raha)\s+hu)\b/i;

const HINGLISH_PERSONAL_PRONOUN_RE =
  /\b(main|mein|mujhe|mera|meri|mere|hum|hame|hamein|humara|humari|humare)\b/i;

const HINGLISH_FACTUAL_SHELL_RE =
  /(kya\s+hot[ai]\s+(hai|h)|kya\s+matlab|\bsamjh[ao]?[ao]\b|isk[ae]\s+baare\s+me|kiske?\s+baare\s+me)/i;

const HINGLISH_TRIVIAL_WHOLE_MESSAGE =
  /^(theek\s+hai|theek|thik\s+hai|thik|haan|haa|han|ji|ji\s+haan|accha|acha|achha|nahi|nhi|hm{1,}|arre)[!.?\s]*$/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractSignals(text: string): Signals {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const eivScore = computeEIV(text);

  return {
    hasLifeStakes: hasLifeStakes(text),
    hasDecisionVocab: hasDecisionVocab(text),
    hasEmotionalVocab: EMOTIONAL_VOCAB_RE.test(text) || HINGLISH_EMOTIONAL_VOCAB_RE.test(text),
    hasExplicitDeep: EXPLICIT_DEEP_RE.test(text),
    hasExplicitQuick: EXPLICIT_QUICK_RE.test(text),
    isTrivialShape: TRIVIAL_WHOLE_MESSAGE.test(trimmed) || HINGLISH_TRIVIAL_WHOLE_MESSAGE.test(trimmed),
    wordCount: words.length,
    hasQuestionMark: text.includes('?'),
    isFactualShell: FACTUAL_SHELL_RE.test(trimmed) || HINGLISH_FACTUAL_SHELL_RE.test(text),
    hasPersonalPronoun: PERSONAL_PRONOUN_RE.test(text) || HINGLISH_PERSONAL_PRONOUN_RE.test(text),
    isSessionOpener: SESSION_OPENER_RE.test(trimmed),
    isContinuationCue: CONTINUATION_CUE_RE.test(trimmed),
    eivScore,
    hasHighEIV: eivScore >= EIV_HIGH_THRESHOLD,
    hasCrisis: LIFE_STAKES_CRISIS.test(text),
    hasTechnicalHints: TECHNICAL_HINTS_RE.test(text),
    hasCodeBlock: CODE_BLOCK_RE.test(text),
    hasRelationshipVocab: RELATIONSHIP_VOCAB_RE.test(text),
    hasSelfReflection: SELF_REFLECTION_VOCAB_RE.test(text),
  };
}
