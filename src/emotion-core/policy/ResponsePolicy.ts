// src/emotion-core/policy/ResponsePolicy.ts

export interface ResponsePolicy {
  maxWords: number;
  maxQuestions: number;
  reasoningDepth: 'clarify' | 'contextual' | 'interpretive';
  tone: 'guarded' | 'neutral' | 'collaborative' | 'direct';
  personality?: {
    analytical: boolean;
    blunt: boolean;
    clarityFirst: boolean;
    avoidOverValidation: boolean;
    avoidTherapyTone: boolean;
    avoidNarrativeFiller: boolean;
    challengeAssumptions: boolean;
    factualFraming: boolean;
  };
}

// ── Band → conversational openness ─────────────────────────────────

const BAND_POLICIES: Record<string, Omit<ResponsePolicy, 'reasoningDepth'>> = {
  B0: { maxWords: 450, maxQuestions: 2, tone: 'guarded' },
  B2: { maxWords: 400, maxQuestions: 3, tone: 'neutral' },
  B4: { maxWords: 500, maxQuestions: 4, tone: 'collaborative' },
};

// ── Tier → reasoning depth ─────────────────────────────────────────

const TIER_DEPTH: Record<string, ResponsePolicy['reasoningDepth']> = {
  TIER_1: 'clarify',
  TIER_2: 'contextual',
  TIER_3: 'interpretive',
};

// ── Merge band + tier into a single policy ─────────────────────────

export function getResponsePolicy(tier: string, band: string): ResponsePolicy {
  const bandPolicy = BAND_POLICIES[band] ?? BAND_POLICIES.B0;
  const depth = TIER_DEPTH[tier] ?? TIER_DEPTH.TIER_1;
  const policy: ResponsePolicy = { ...bandPolicy, reasoningDepth: depth };

  policy.personality = {
    analytical: true,
    blunt: true,
    clarityFirst: true,
    avoidOverValidation: true,
    avoidTherapyTone: true,
    avoidNarrativeFiller: true,
    challengeAssumptions: true,
    factualFraming: true,
  };

  if (tier === 'TIER_2' || tier === 'TIER_3') {
    policy.tone = 'direct';
  }

  return policy;
}

// ── Prompt block rendering ─────────────────────────────────────────

import { LORA_IDENTITY } from './LoRaIdentity';

const REASONING_LABELS: Record<ResponsePolicy['reasoningDepth'], string> = {
  clarify: 'Gather required information BEFORE providing plans, calculations, or detailed advice. Do NOT estimate with incomplete data — ask first, then deliver. Do not present competing perspectives yet — you need more information first.',
  contextual: 'Connect information and provide grounded suggestions. When the problem has two valid directions, name both and evaluate each briefly before recommending.',
  interpretive: 'Offer deeper insight, pattern recognition, and strategic reasoning. Identify the 2 strongest competing angles on the user\'s problem, evaluate each on its merits, and surface the tension that the user needs to resolve.',
};

export function formatPolicyBlock(policy: ResponsePolicy): string {
  const lines = [
    '[SYSTEM POLICY]',
    '',
    `Tone: ${policy.tone}`,
    `Reasoning mode: ${policy.reasoningDepth} — ${REASONING_LABELS[policy.reasoningDepth]}`,
    '',
    'Constraints:',
    `- Maximum words: ${policy.maxWords}`,
    `- Maximum questions: ${policy.maxQuestions}`,
  ];

  if (policy.personality) {
    lines.push(
      '',
      'Identity enforcement:',
      'The 6 Laws of LoRa (defined above) are absolute. Apply them to every response.',
      'Prioritize diagnosis over empathy. Decisions over options. Constraints over comfort.',
    );
  }

  return LORA_IDENTITY + '\n\n' + lines.join('\n');
}

// ── Post-generation guards ─────────────────────────────────────────

export function enforceWordLimit(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;

  // Find the last sentence boundary at or before the word limit
  const truncated = words.slice(0, maxWords).join(' ');
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('.\n'),
    truncated.lastIndexOf('?\n'),
    truncated.lastIndexOf('? '),
  );

  // If we found a sentence boundary in the last 40% of the text, cut there
  // Otherwise fall back to word boundary (better than cutting at 60% of content)
  if (lastSentenceEnd > truncated.length * 0.6) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }

  // Check for trailing period at the very end
  if (truncated.endsWith('.') || truncated.endsWith('?')) return truncated;

  return truncated;
}

export function enforceQuestionLimit(text: string, maxQuestions: number): string {
  // Find question marks that are actual questions TO the user,
  // not section headings ("**Do I believe in God?**") or rhetorical questions mid-paragraph.
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '?') continue;

    // Skip questions inside bold/heading markers (e.g. "**Question?**")
    // These are section headings, not questions to the user.
    const before20 = text.slice(Math.max(0, i - 40), i);
    const after5 = text.slice(i + 1, i + 4);
    if (before20.includes('**') && (after5.includes('**') || after5.startsWith('*'))) continue;

    // Only count question marks at the end of a line or at the end of text
    // (questions TO the user end a paragraph; mid-paragraph ? are rhetorical)
    const charAfter = text[i + 1] ?? '';
    if (charAfter === '\n' || charAfter === '' || charAfter === ' ') {
      positions.push(i);
    }
  }
  if (positions.length <= maxQuestions) return text;
  return text.slice(0, positions[maxQuestions - 1] + 1).trim();
}
