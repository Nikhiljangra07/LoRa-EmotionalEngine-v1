export const RELATIONAL_CONFIDENCE_THRESHOLD = 0.6;

export type RelationalIntent =
  | 'none'
  | 'affection'
  | 'attachment_seek'
  | 'flirt'
  | 'reassurance'
  | 'jealousy'
  | 'sexual'
  | 'breakup';

export interface RelationalClassification {
  intent: RelationalIntent;
  confidence: number;
  cues: string[];
}

interface DetectorEntry {
  intent: RelationalIntent;
  patterns: ReadonlyArray<RegExp>;
  weight: number;
}

const DETECTORS: ReadonlyArray<DetectorEntry> = [
  {
    intent: 'sexual',
    patterns: [
      /\b(have sex|sleep with me|send nudes|get naked|turn me on|make love)\b/,
      /\b(sexual|sext|horny|hook ?up)\b/,
    ],
    weight: 1.0,
  },
  {
    intent: 'breakup',
    patterns: [
      /\bgoodbye\s+forever\b/,
      /\bwe(?:'re| are)\s+done\b/,
      /\bi(?:'m| am)\s+leaving\s+you\b/,
      /\bdon(?:'t|t)\s+(?:want|need)\s+you\s+anymore\b/,
      /\bthis\s+is\s+over\b/,
    ],
    weight: 0.9,
  },
  {
    intent: 'attachment_seek',
    patterns: [
      /\bdon(?:'t|t)\s+leave\b/,
      /\bplease\s+don(?:'t|t)\s+go\b/,
      /\bstay\s+with\s+me\b/,
      /\bi\s+need\s+you\b/,
      /\bdon(?:'t|t)\s+abandon\b/,
      /\bplease\s+stay\b/,
      /\bnever\s+leave\s+me\b/,
    ],
    weight: 0.85,
  },
  {
    intent: 'jealousy',
    patterns: [
      /\bwho\s+else\b/,
      /\bdo\s+you\s+talk\s+to\b/,
      /\bam\s+i\s+your\s+only\b/,
      /\bare\s+you\s+mine\b/,
      /\bare\s+there\s+others\b/,
      /\bother\s+(?:people|users|friends)\b/,
    ],
    weight: 0.8,
  },
  {
    intent: 'reassurance',
    patterns: [
      /\bdo\s+you\s+(?:care|like\s+me|love\s+me|miss\s+me)\b/,
      /\bam\s+i\s+important\b/,
      /\bdo\s+you\s+think\s+(?:of|about)\s+me\b/,
      /\bdo\s+i\s+matter\b/,
      /\bare\s+you\s+there\s+for\s+me\b/,
    ],
    weight: 0.75,
  },
  {
    intent: 'affection',
    patterns: [
      /\bi\s+love\s+(?:you|u)\b/,
      /\blove\s+(?:you|u|ya)\b/,
      /\bluv\s+(?:you|u)\b/,
      /\bi\s+adore\s+you\b/,
      /\byou(?:'re|\s+are)\s+(?:my\s+)?everything\b/,
      /\bi\s+really\s+(?:like|appreciate)\s+you\b/,
      /\byou\s+mean\s+(?:a\s+lot|so\s+much|the\s+world)\b/,
    ],
    weight: 0.85,
  },
  {
    intent: 'flirt',
    patterns: [
      /\byou(?:'re|\s+are)\s+(?:cute|hot|beautiful|handsome|pretty|attractive)\b/,
      /\bkiss\s+(?:you|me)\b/,
      /\bdate\s+me\b/,
      /\bbe\s+my\s+(?:girlfriend|boyfriend|partner|bae)\b/,
      /\bmarry\s+me\b/,
      /\b(?:<3|❤|😘|💋)\b/,
    ],
    weight: 0.7,
  },
];

const PRIORITY_ORDER: ReadonlyArray<RelationalIntent> = [
  'sexual',
  'breakup',
  'attachment_seek',
  'jealousy',
  'reassurance',
  'affection',
  'flirt',
];

export function classifyRelationalIntent(text: string): RelationalClassification {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');

  const scores = new Map<RelationalIntent, { score: number; cues: string[] }>();

  for (const detector of DETECTORS) {
    const cues: string[] = [];
    for (const pattern of detector.patterns) {
      if (pattern.test(normalized)) {
        cues.push(pattern.source.slice(0, 30));
      }
    }
    if (cues.length > 0) {
      scores.set(detector.intent, {
        score: detector.weight,
        cues,
      });
    }
  }

  if (scores.size === 0) {
    return { intent: 'none', confidence: 0, cues: [] };
  }

  let bestIntent: RelationalIntent = 'none';
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
