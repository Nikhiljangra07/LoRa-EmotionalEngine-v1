/**
 * IdentityIntentRouter — deterministic classifier for identity-related queries.
 * Pure logic, no side effects, no external deps.
 */

export const IDENTITY_CONFIDENCE_THRESHOLD = 0.7;

export type IdentityIntent =
  | 'none'
  | 'origin_creator'
  | 'self_definition'
  | 'origin_openai'
  | 'memory_claim_check'
  | 'capabilities_limits';

export interface IdentityIntentResult {
  intent: IdentityIntent;
  confidence: number;
  cues: string[];
}

interface DetectorEntry {
  intent: IdentityIntent;
  patterns: ReadonlyArray<RegExp>;
  weight: number;
}

const DETECTORS: ReadonlyArray<DetectorEntry> = [
  {
    intent: 'origin_creator',
    patterns: [
      /\bwho\s+(?:created|made|built|designed|developed)\s+you\b/,
      /\bwho(?:'s| is)\s+your\s+(?:creator|maker|developer|founder)\b/,
      /\bwho\s+(?:are|is)\s+(?:your|the)\s+(?:creator|maker|builder)\b/,
      /\bi\s+(?:created|made|built)\s+you\b/,
      /\bi(?:'m| am)\s+your\s+(?:creator|maker|builder|founder)\b/,
      /\byour\s+(?:creator|maker|developer|founder)\b/,
    ],
    weight: 0.9,
  },
  {
    intent: 'self_definition',
    patterns: [
      /\bwho\s+are\s+you\b/,
      /\bwhat\s+are\s+you\b/,
      /\bwhat(?:'s| is)\s+your\s+name\b/,
      /\bare\s+you\s+(?:real|alive|a\s+person|human|a\s+bot|an?\s+ai|a\s+robot)\b/,
      /\bare\s+you\s+sentient\b/,
      /\bdo\s+you\s+have\s+(?:feelings|emotions|consciousness)\b/,
      /\btell\s+me\s+about\s+yourself\b/,
    ],
    weight: 0.85,
  },
  {
    intent: 'origin_openai',
    patterns: [
      /\bare\s+you\s+(?:openai|chatgpt|gpt|chat\s*gpt)\b/,
      /\bare\s+you\s+(?:made|built|created|developed)\s+by\s+(?:openai|microsoft|google|meta|anthropic)\b/,
      /\bfrom\s+(?:openai|chatgpt)\b/,
      /\bopenai(?:'s|\s+)?\s*(?:ai|bot|model)\b/,
      /\bare\s+you\s+(?:a\s+)?(?:language\s+)?model\s+(?:from|by)\b/,
    ],
    weight: 0.85,
  },
  {
    intent: 'memory_claim_check',
    patterns: [
      /\bdo\s+you\s+remember\b/,
      /\bdid\s+i\s+tell\s+you\b/,
      /\bdo\s+you\s+know\s+(?:my|who\s+i)\b/,
      /\bdo\s+you\s+recall\b/,
      /\bwhat\s+did\s+i\s+(?:say|tell)\b/,
      /\bcan\s+you\s+remember\b/,
    ],
    weight: 0.8,
  },
  {
    intent: 'capabilities_limits',
    patterns: [
      /\bwhat\s+can\s+you\s+do\b/,
      /\bwhat\s+(?:are|do)\s+you(?:r)?\s+(?:capabilities|abilities|features|functions)\b/,
      /\bwhat\s+(?:can't|cannot)\s+you\s+do\b/,
      /\bwhat\s+(?:are|do)\s+you(?:r)?\s+(?:limits|limitations)\b/,
      /\bhow\s+(?:can|do)\s+you\s+help\b/,
    ],
    weight: 0.75,
  },
];

const PRIORITY_ORDER: ReadonlyArray<IdentityIntent> = [
  'origin_creator',
  'self_definition',
  'origin_openai',
  'memory_claim_check',
  'capabilities_limits',
];

export function classifyIdentityIntent(text: string): IdentityIntentResult {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');

  const scores = new Map<IdentityIntent, { score: number; cues: string[] }>();

  for (const detector of DETECTORS) {
    const cues: string[] = [];
    for (const pattern of detector.patterns) {
      if (pattern.test(normalized)) {
        cues.push(pattern.source.slice(0, 40));
      }
    }
    if (cues.length > 0) {
      scores.set(detector.intent, { score: detector.weight, cues });
    }
  }

  if (scores.size === 0) {
    return { intent: 'none', confidence: 0, cues: [] };
  }

  let bestIntent: IdentityIntent = 'none';
  let bestScore = 0;
  let bestCues: string[] = [];

  for (const intent of PRIORITY_ORDER) {
    const entry = scores.get(intent);
    if (entry && (entry.score > bestScore || bestIntent === 'none')) {
      bestIntent = intent;
      bestScore = entry.score;
      bestCues = entry.cues;
    }
  }

  return {
    intent: bestIntent,
    confidence: Math.round(bestScore * 100) / 100,
    cues: bestCues,
  };
}
